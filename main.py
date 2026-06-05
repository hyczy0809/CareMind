import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from my_agent.care_workflow_schema import (
    CareWorkflowRequest,
    CareWorkflowResponse,
    GuardrailCheckRequest,
    GuardrailCheckResponse,
    FollowupSummaryRequest,
    FollowupSummaryResponse,
)
from my_agent.care_workflow_service import check_guardrail, generate_followup_summary, run_care_workflow

load_dotenv()

ADK_LOAD_ERROR = None

# =========================
# 创建 FastAPI 应用
# =========================
app = FastAPI(title="CareMind API")

UPLOAD_ROOT = Path(os.environ.get("CAREMIND_UPLOAD_DIR", "uploads/medical_documents"))
DOCUMENT_INDEX_PATH = UPLOAD_ROOT.parent / "document_index.json"
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_AUDIO_BYTES = 25 * 1024 * 1024
TRANSCRIPTION_BASE_URL = os.environ.get("TRANSCRIPTION_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
TRANSCRIPTION_API_KEY = os.environ.get("TRANSCRIPTION_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("MODEL_API_KEY")
TRANSCRIPTION_MODEL = os.environ.get("TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")
SUPPORTED_DOCUMENT_TYPES = {
    "clinic_note",
    "imaging_report",
    "scale_result",
    "medication_list",
    "manual_summary",
}
DOCUMENT_TYPE_LABELS = {
    "clinic_note": "病历摘要",
    "imaging_report": "MRI / CT 检查报告",
    "scale_result": "认知量表结果",
    "medication_list": "用药清单",
    "manual_summary": "家属手动摘要",
}
SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".docx"}
SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/aac",
    "audio/mp4",
    "audio/m4a",
    "audio/mpeg",
    "audio/mp3",
    "audio/mpga",
    "audio/wav",
    "audio/webm",
    "video/mp4",
    "video/webm",
}
SUPPORTED_AUDIO_EXTENSIONS = {".aac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".wav", ".webm"}


class MedicalDocumentRecord(BaseModel):
    document_id: str
    patient_id: str
    document_type: str
    filename: str
    mime_type: str
    file_size: int
    checksum: str
    status: Literal["uploaded", "parsing", "review_required", "reviewed", "parse_failed", "deleted"]
    summary: str | None = None
    uploaded_at: str
    storage_path: str
    parse_error: str | None = None


class DeleteDocumentResponse(BaseModel):
    document_id: str
    status: Literal["deleted"]


class DocumentParseField(BaseModel):
    field: str
    label: str
    value: str
    confidence: Literal["low", "medium", "high"]
    source: Literal["filename", "user_summary", "document_type", "system_template"]
    requires_confirmation: bool = True


class DocumentReviewQuestion(BaseModel):
    id: str
    question: str
    reason: str


class DocumentParseResult(BaseModel):
    document_id: str
    status: Literal["review_required", "parse_failed"]
    extracted_fields: list[DocumentParseField]
    review_questions: list[DocumentReviewQuestion]
    followup_summary_items: list[str]
    medical_boundary: str
    parsed_at: str
    parse_error: str | None = None


class ConfirmDocumentReviewRequest(BaseModel):
    confirmed_items: list[str]
    family_note: str | None = None


class ConfirmDocumentReviewResponse(BaseModel):
    document_id: str
    status: Literal["reviewed"]
    confirmed_items: list[str]
    family_note: str | None = None
    reviewed_at: str


class AudioTranscriptionResponse(BaseModel):
    request_id: str
    transcript: str
    model: str
    language: str | None = None
    provider: Literal["openai_compatible"] = "openai_compatible"
    medical_boundary: str = "语音仅用于生成照护记录草稿，保存前请家属确认内容。"

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_document_index() -> dict[str, dict]:
    if not DOCUMENT_INDEX_PATH.exists():
        return {}
    try:
        return json.loads(DOCUMENT_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_document_index(index: dict[str, dict]) -> None:
    DOCUMENT_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    DOCUMENT_INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")


def validate_document_type(document_type: str) -> None:
    if document_type not in SUPPORTED_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported document_type")


def validate_upload_file(file: UploadFile) -> None:
    suffix = Path(file.filename or "").suffix.lower()
    mime_type = file.content_type or "application/octet-stream"
    if suffix not in SUPPORTED_EXTENSIONS and mime_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported file type")


def validate_audio_file(file: UploadFile) -> None:
    suffix = Path(file.filename or "").suffix.lower()
    mime_type = file.content_type or "application/octet-stream"
    if suffix not in SUPPORTED_AUDIO_EXTENSIONS and mime_type not in SUPPORTED_AUDIO_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio type")


async def read_upload_bytes_with_limit(file: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total_size = 0
    try:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > max_bytes:
                raise HTTPException(status_code=413, detail="File exceeds upload limit")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        await file.close()


def public_document_record(record: dict) -> MedicalDocumentRecord:
    return MedicalDocumentRecord(**record)


def normalize_summary(summary: str | None) -> str:
    return (summary or "").strip()


def document_filename_hint(filename: str) -> str:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
    return stem or filename


def build_document_parse_result(record: dict) -> dict:
    """Build a conservative review draft without interpreting medical conclusions."""
    document_id = record["document_id"]
    document_type = record["document_type"]
    filename = record["filename"]
    summary = normalize_summary(record.get("summary"))
    type_label = DOCUMENT_TYPE_LABELS.get(document_type, "复诊资料")
    fields: list[dict] = [
        {
            "field": "document_type",
            "label": "资料类型",
            "value": type_label,
            "confidence": "high",
            "source": "document_type",
            "requires_confirmation": False,
        },
        {
            "field": "file_name",
            "label": "文件名称",
            "value": document_filename_hint(filename),
            "confidence": "medium",
            "source": "filename",
            "requires_confirmation": True,
        },
    ]

    if summary:
        fields.append(
            {
                "field": "family_summary",
                "label": "家属补充摘要",
                "value": summary,
                "confidence": "high",
                "source": "user_summary",
                "requires_confirmation": True,
            }
        )

    type_specific_fields: dict[str, list[dict]] = {
        "clinic_note": [
            {
                "field": "visit_or_record_date",
                "label": "就诊/记录日期",
                "value": "待家属核对",
                "confidence": "low",
                "source": "system_template",
                "requires_confirmation": True,
            },
            {
                "field": "doctor_instruction",
                "label": "医生已说明事项",
                "value": summary or "待家属补充医生原话或资料重点",
                "confidence": "low" if not summary else "medium",
                "source": "user_summary" if summary else "system_template",
                "requires_confirmation": True,
            },
        ],
        "imaging_report": [
            {
                "field": "exam_type",
                "label": "检查类型",
                "value": "MRI/CT，需按报告原文确认",
                "confidence": "medium",
                "source": "document_type",
                "requires_confirmation": True,
            },
            {
                "field": "report_conclusion",
                "label": "报告结论原文",
                "value": summary or "待家属从报告中摘录原文",
                "confidence": "low" if not summary else "medium",
                "source": "user_summary" if summary else "system_template",
                "requires_confirmation": True,
            },
        ],
        "scale_result": [
            {
                "field": "scale_name",
                "label": "量表名称",
                "value": "待家属核对，例如 MMSE / MoCA / ADL",
                "confidence": "low",
                "source": "system_template",
                "requires_confirmation": True,
            },
            {
                "field": "score_or_level",
                "label": "分数或等级",
                "value": summary or "待家属按量表原文填写",
                "confidence": "low" if not summary else "medium",
                "source": "user_summary" if summary else "system_template",
                "requires_confirmation": True,
            },
        ],
        "medication_list": [
            {
                "field": "current_medications",
                "label": "当前用药",
                "value": summary or "待家属按药盒/处方填写药名、剂量、频次",
                "confidence": "low" if not summary else "medium",
                "source": "user_summary" if summary else "system_template",
                "requires_confirmation": True,
            },
            {
                "field": "medication_boundary",
                "label": "用药边界",
                "value": "仅整理用药清单，不建议自行停药、补药或调剂量",
                "confidence": "high",
                "source": "system_template",
                "requires_confirmation": False,
            },
        ],
        "manual_summary": [
            {
                "field": "family_observation",
                "label": "家属观察",
                "value": summary or "待家属补充近期变化、想问医生的问题或资料重点",
                "confidence": "low" if not summary else "high",
                "source": "user_summary" if summary else "system_template",
                "requires_confirmation": True,
            }
        ],
    }
    fields.extend(type_specific_fields.get(document_type, []))

    question_templates: dict[str, list[dict]] = {
        "clinic_note": [
            ("visit_date", "这份病历对应哪一次就诊或哪一天记录？", "医生看摘要时需要知道时间顺序。"),
            ("doctor_instruction", "医生当时有没有特别交代观察点或复诊时间？", "这会影响复诊沟通材料的优先级。"),
        ],
        "imaging_report": [
            ("exam_date", "检查日期是哪一天？", "影像资料需要和近期症状变化放在同一时间线上。"),
            ("original_conclusion", "报告结论原文是否已摘录完整？", "CareMind 不解释诊断结论，只帮助保留原文给医生核对。"),
            ("bring_materials", "复诊时是否需要带报告纸质版、影像片或光盘？", "医生可能需要查看原始资料。"),
        ],
        "scale_result": [
            ("scale_name", "量表名称和总分是否已经确认？", "不同量表含义不同，需避免混淆。"),
            ("scale_date", "量表完成日期是哪一天？", "便于医生判断变化趋势。"),
        ],
        "medication_list": [
            ("medication_source", "药名、剂量和服药时间是否来自医生处方或药盒？", "用药清单需要可追溯来源。"),
            ("recent_refusal", "近期有没有拒药、漏药或重复服药？", "复诊时建议把发生频率和场景告诉医生。"),
        ],
        "manual_summary": [
            ("main_question", "你最想让医生帮忙判断的问题是什么？", "复诊时间有限，问题清单需要排序。"),
            ("time_range", "这段摘要覆盖的是近几天或哪一段时间？", "便于和照护日志合并。"),
        ],
    }
    review_questions = [
        {"id": item[0], "question": item[1], "reason": item[2]}
        for item in question_templates.get(document_type, question_templates["manual_summary"])
    ]

    followup_summary_items = [
        f"已补充{type_label}：{summary}" if summary else f"已上传{type_label}，建议家属核对日期、来源和关键原文。",
        "该资料仅用于复诊沟通整理，影像、量表、诊断和用药结论仍需医生判断。",
    ]

    return {
        "document_id": document_id,
        "status": "review_required",
        "extracted_fields": fields,
        "review_questions": review_questions,
        "followup_summary_items": followup_summary_items,
        "medical_boundary": "CareMind 只做资料整理和术语辅助，不判断诊断、不决定检查、不调整用药。",
        "parsed_at": utc_now_iso(),
        "parse_error": None,
    }


@app.post("/api/documents/upload", response_model=MedicalDocumentRecord)
async def upload_medical_document(
    patient_id: str = Form(...),
    document_type: str = Form(...),
    summary: str = Form(""),
    file: UploadFile = File(...),
) -> MedicalDocumentRecord:
    """Upload a medical-adjacent document for non-diagnostic follow-up preparation."""
    validate_document_type(document_type)
    validate_upload_file(file)

    document_id = f"doc_{uuid.uuid4().hex}"
    original_filename = Path(file.filename or "document").name
    suffix = Path(original_filename).suffix.lower()
    safe_filename = f"{document_id}{suffix}"
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    storage_path = UPLOAD_ROOT / safe_filename
    checksum = hashlib.sha256()
    total_size = 0

    try:
        with storage_path.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_DOCUMENT_BYTES:
                    output.close()
                    storage_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="File exceeds 10MB limit")
                checksum.update(chunk)
                output.write(chunk)
    finally:
        await file.close()

    record = {
        "document_id": document_id,
        "patient_id": patient_id,
        "document_type": document_type,
        "filename": original_filename,
        "mime_type": file.content_type or "application/octet-stream",
        "file_size": total_size,
        "checksum": checksum.hexdigest(),
        "status": "uploaded",
        "summary": summary.strip() or None,
        "uploaded_at": utc_now_iso(),
        "storage_path": str(storage_path),
        "parse_error": None,
    }

    index = load_document_index()
    index[document_id] = record
    save_document_index(index)
    return public_document_record(record)


@app.get("/api/documents/{document_id}", response_model=MedicalDocumentRecord)
async def get_medical_document(document_id: str) -> MedicalDocumentRecord:
    """Return uploaded document metadata without exposing raw file contents."""
    record = load_document_index().get(document_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")
    return public_document_record(record)


@app.post("/api/documents/{document_id}/parse", response_model=DocumentParseResult)
async def parse_medical_document(document_id: str) -> DocumentParseResult:
    """Create a non-diagnostic review draft for an uploaded document."""
    index = load_document_index()
    record = index.get(document_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")
    if record.get("status") == "deleted":
        raise HTTPException(status_code=410, detail="Document has been deleted")

    try:
        parse_result = build_document_parse_result(record)
        record["status"] = "review_required"
        record["parse_result"] = parse_result
        record["parse_error"] = None
        index[document_id] = record
        save_document_index(index)
        return DocumentParseResult(**parse_result)
    except Exception as exc:  # pragma: no cover - defensive persistence path
        record["status"] = "parse_failed"
        record["parse_error"] = str(exc)
        index[document_id] = record
        save_document_index(index)
        return DocumentParseResult(
            document_id=document_id,
            status="parse_failed",
            extracted_fields=[],
            review_questions=[],
            followup_summary_items=[],
            medical_boundary="CareMind 只做资料整理和术语辅助，不判断诊断、不决定检查、不调整用药。",
            parsed_at=utc_now_iso(),
            parse_error="资料整理失败，请稍后重试或改为手动填写摘要。",
        )


@app.post("/api/documents/{document_id}/review", response_model=ConfirmDocumentReviewResponse)
async def confirm_document_review(
    document_id: str,
    request: ConfirmDocumentReviewRequest,
) -> ConfirmDocumentReviewResponse:
    """Persist family-confirmed document facts for follow-up preparation."""
    index = load_document_index()
    record = index.get(document_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")
    if record.get("status") == "deleted":
        raise HTTPException(status_code=410, detail="Document has been deleted")
    if not record.get("parse_result"):
        raise HTTPException(status_code=409, detail="Parse the document before review confirmation")

    reviewed_at = utc_now_iso()
    confirmed_items = [item.strip() for item in request.confirmed_items if item.strip()]
    record["status"] = "reviewed"
    record["review"] = {
        "confirmed_items": confirmed_items,
        "family_note": normalize_summary(request.family_note),
        "reviewed_at": reviewed_at,
    }
    index[document_id] = record
    save_document_index(index)
    return ConfirmDocumentReviewResponse(
        document_id=document_id,
        status="reviewed",
        confirmed_items=confirmed_items,
        family_note=normalize_summary(request.family_note) or None,
        reviewed_at=reviewed_at,
    )


@app.delete("/api/documents/{document_id}", response_model=DeleteDocumentResponse)
async def delete_medical_document(document_id: str) -> DeleteDocumentResponse:
    """Delete a previously uploaded document and mark its metadata as deleted."""
    index = load_document_index()
    record = index.get(document_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")

    storage_path = Path(record.get("storage_path", ""))
    if storage_path.exists():
        storage_path.unlink()

    record["status"] = "deleted"
    index[document_id] = record
    save_document_index(index)
    return DeleteDocumentResponse(document_id=document_id, status="deleted")


@app.post("/api/audio/transcribe", response_model=AudioTranscriptionResponse)
async def transcribe_audio_note(
    file: UploadFile = File(...),
    patient_id: str = Form("local_patient"),
    language: str = Form("zh"),
) -> AudioTranscriptionResponse:
    """Transcribe a short caregiver voice note into editable text."""
    del patient_id
    validate_audio_file(file)
    if not TRANSCRIPTION_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Transcription API key is not configured. Set TRANSCRIPTION_API_KEY, OPENAI_API_KEY, or MODEL_API_KEY.",
        )

    audio_bytes = await read_upload_bytes_with_limit(file, MAX_AUDIO_BYTES)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    filename = Path(file.filename or f"caremind_voice_{uuid.uuid4().hex}.m4a").name
    mime_type = file.content_type or "audio/m4a"
    headers = {"Authorization": f"Bearer {TRANSCRIPTION_API_KEY}"}
    data = {
        "model": TRANSCRIPTION_MODEL,
        "language": language or "zh",
        "response_format": "json",
    }
    files = {
        "file": (filename, audio_bytes, mime_type),
    }

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{TRANSCRIPTION_BASE_URL.rstrip('/')}/audio/transcriptions",
                headers=headers,
                data=data,
                files=files,
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        raise HTTPException(status_code=502, detail=f"Transcription provider error: {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Transcription request failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Transcription provider returned invalid JSON") from exc

    transcript = str(payload.get("text") or "").strip()
    if not transcript:
        raise HTTPException(status_code=422, detail="No speech was recognized from the audio")

    return AudioTranscriptionResponse(
        request_id=f"voice_{uuid.uuid4().hex}",
        transcript=transcript,
        model=TRANSCRIPTION_MODEL,
        language=language or "zh",
    )

try:
    # =========================
    # 创建共享的 Session Service
    # =========================
    from google.adk.sessions import InMemorySessionService

    # =========================
    # 导入并设置 Agent
    # =========================
    from my_agent.agent import root_agent

    # =========================
    # 设置 OpenAI 兼容路由（使用共享的 session_service）
    # =========================
    from openai_compat import setup_openai_routes

    shared_session_service = InMemorySessionService()
    setup_openai_routes(
        app=app,
        agent=root_agent,
        session_service=shared_session_service,
        app_name="my_agent"
    )
except Exception as exc:  # pragma: no cover - runtime dependency fallback
    ADK_LOAD_ERROR = str(exc)


@app.post("/api/care-workflow", response_model=CareWorkflowResponse)
async def care_workflow(request: CareWorkflowRequest) -> CareWorkflowResponse:
    """Run the typed CareMind MVP workflow used by the Expo app."""
    return run_care_workflow(request)


@app.post("/api/guardrail/check", response_model=GuardrailCheckResponse)
async def guardrail_check(request: GuardrailCheckRequest) -> GuardrailCheckResponse:
    """Run only the medical/safety boundary check before ordinary workflow."""
    return check_guardrail(request)


@app.post("/api/reports/follow-up", response_model=FollowupSummaryResponse)
async def followup_summary(request: FollowupSummaryRequest) -> FollowupSummaryResponse:
    """Generate a typed non-diagnostic follow-up summary from saved care signals."""
    return generate_followup_summary(request)


@app.get("/health")
async def health():
    """Health check for frontend integration and deployment probes."""
    return {
        "status": "ok",
        "care_workflow": True,
        "adk_available": ADK_LOAD_ERROR is None,
    }

# =========================
# 添加根路径说明
# =========================
@app.get("/")
async def root():
    """根路径，返回 API 说明"""
    return {
        "message": "CareMind API",
        "endpoints": {
            "care_workflow": "/api/care-workflow",
            "guardrail_check": "/api/guardrail/check",
            "followup_summary": "/api/reports/follow-up",
            "document_upload": "/api/documents/upload",
            "document_status": "/api/documents/{document_id}",
            "document_parse": "/api/documents/{document_id}/parse",
            "document_review": "/api/documents/{document_id}/review",
            "audio_transcribe": "/api/audio/transcribe",
            "openai_api": "/v1/chat/completions",
            "models": "/v1/models",
            "health": "/health"
        },
        "adk_available": ADK_LOAD_ERROR is None,
        "adk_load_error": ADK_LOAD_ERROR,
        "openai_compat": {
            "endpoint": "POST /v1/chat/completions",
            "headers": {
                "Content-Type": "application/json",
                "X-Session-ID": "optional session ID for multi-turn conversations",
                "X-User-ID": "optional user ID (default: 'default')"
            },
            "example": {
                "model": "my_agent",
                "messages": [
                    {"role": "user", "content": "你好，今天天气怎么样？"}
                ],
                "stream": False
            }
        }
    }


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        reload=False
    )
