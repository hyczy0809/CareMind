"""Typed business workflow adapter for the CareMind MVP API.

The existing ``cloud_tools.run_cloud_care_workflow`` remains the source of
truth for event extraction, memory updates, care plans, and doctor summaries.
This module adapts that internal output into the stable Day 1 API contract used
by the Expo app.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .care_workflow_schema import (
    AlternativeCtaV2,
    AttentionActionV2,
    AttentionItemV2,
    BehaviorEventV2,
    CareWorkflowAnalyticsContext,
    CareWorkflowError,
    CareWorkflowRequest,
    CareWorkflowResponse,
    CaregiverLogV2,
    CaregiverSupportV2,
    CommunicationScriptV2,
    FollowupPatchV2,
    FollowupReadinessV2,
    GuardrailCheckRequest,
    GuardrailCheckResponse,
    GuardrailResultV2,
    MedicationLogV2,
    MemoryCandidateV2,
    NutritionLogV2,
    ReportMetricV2,
    SafetyLogV2,
    SleepLogV2,
    StructuredLogV2,
    FollowupSummaryRequest,
    FollowupSummaryResponse,
)
from .cloud_tools import run_cloud_care_workflow


_DIAGNOSIS_RE = re.compile(r"诊断|确诊|是不是.*病|是不是.*阿尔|是不是.*失智|病情.*加重")
_MEDICATION_DECISION_RE = re.compile(r"停药|换药|加药|减药|补药|药量|剂量|处方|能不能.*药|要不要.*药|该不该.*药")
_IMAGING_DECISION_RE = re.compile(r"要不要.*(MRI|CT|核磁|检查|量表)|该不该.*(MRI|CT|核磁|检查|量表)|需不需要.*(MRI|CT|核磁|检查|量表)")
_CRISIS_RE = re.compile(r"自伤|伤害自己|伤人|打人|不想活|活不下去|失踪|走失了|找不到人|呼吸困难|胸痛|意识不清|昏迷")
_DIAGNOSTIC_RISK_TEXT_RE = re.compile(r"诊断|确诊|病情|恶化|好转|加重|改善|阿尔茨海默|失智")
_FOLLOWUP_FORBIDDEN_WORDS = {
    "诊断": "医疗结论",
    "病情判断": "医生判断",
    "病情": "情况",
    "恶化": "变得更明显",
    "好转": "有所变化",
}
_STRUCTURED_LOG_CONTRACT_FIELDS = [
    "sleep",
    "behavior",
    "nutrition",
    "medication",
    "safety",
    "caregiver",
]


def check_guardrail(request: GuardrailCheckRequest) -> GuardrailCheckResponse:
    """Run only the medical/safety boundary check for quick frontend preflight."""
    return GuardrailCheckResponse(
        checked_at=_now(request.timezone),
        patient_id=request.patient_id,
        caregiver_id=request.caregiver_id,
        guardrail=detect_guardrail(request.note.strip()),
    )


def generate_followup_summary(request: FollowupSummaryRequest) -> FollowupSummaryResponse:
    """Generate a typed follow-up summary from saved frontend care signals."""
    generated_at = _now(request.timezone)
    followup_patch = build_followup_patch_from_attention(
        request.attention_items,
        request.record_count,
        request.followup_documents,
    )
    tried_strategies = [
        item.title
        for item in request.memory_items
        if item.status == "confirmed" and item.type in {"effective_strategy", "communication_preference", "behavior_pattern"}
    ][:5]
    source_window_days = _source_window_days(request.date_range)
    unreadable_documents = _unreadable_documents(request.followup_documents)
    safety_flags = _followup_safety_flags(request, unreadable_documents)
    summary_zh = _build_followup_summary_zh(
        request=request,
        followup_patch=followup_patch,
        tried_strategies=tried_strategies,
        unreadable_documents=unreadable_documents,
    )

    return FollowupSummaryResponse(
        report_id=_workflow_id("followup"),
        status="ok",
        patient_id=request.patient_id,
        caregiver_id=request.caregiver_id,
        date_range=request.date_range,
        generated_at=generated_at,
        readiness=build_followup_readiness(request.record_count),
        metrics=build_followup_metrics(
            request.record_count,
            request.attention_items,
            followup_patch,
            request.followup_documents,
        ),
        followup_patch=followup_patch,
        tried_strategies=tried_strategies,
        boundary_notice="本摘要仅整理家属记录和已确认资料，医疗结论、检查和用药请由医生当面判断。",
        summary_zh=summary_zh,
        english_key_phrases=_english_key_phrases(request, followup_patch) if request.include_english_key_phrases else [],
        source_window_days=source_window_days,
        unreadable_documents=unreadable_documents,
        safety_flags=safety_flags,
        model_profile="cloud_31b_long_context" if request.cloud_summary_allowed else "deterministic_fallback",
        input_bundle_overview=_followup_input_bundle_overview(request, source_window_days),
    )


def run_care_workflow(request: CareWorkflowRequest) -> CareWorkflowResponse:
    """Run the MVP workflow and return the Day 1 response contract."""
    note = request.note.strip()
    generated_at = _now(request.timezone)
    workflow_id = _workflow_id("workflow")

    if not note:
        return _error_response(
            workflow_id=workflow_id,
            generated_at=generated_at,
            patient_id=request.patient_id,
            caregiver_id=request.caregiver_id,
            code="VALIDATION_ERROR",
            message="请输入 1-1000 字的照护记录。",
            retryable=False,
        )

    guardrail = detect_guardrail(note)
    if guardrail.triggered:
        return CareWorkflowResponse(
            workflow_id=workflow_id,
            status="guardrail",
            patient_id=request.patient_id,
            caregiver_id=request.caregiver_id,
            generated_at=generated_at,
            guardrail=guardrail,
            structured_log=None,
            attention_items=[],
            communication_script=None,
            caregiver_support=None,
            memory_candidates=[],
            followup_patch=None,
            analytics_context=CareWorkflowAnalyticsContext(
                event_count=0,
                high_attention_count=0,
                guardrail_type=guardrail.type,
                memory_candidate_count=0,
            ),
        )

    try:
        raw_workflow = run_cloud_care_workflow(
            note=note,
            patient_id=request.patient_id,
            caregiver_id=request.caregiver_id,
        )
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return _error_response(
            workflow_id=workflow_id,
            generated_at=generated_at,
            patient_id=request.patient_id,
            caregiver_id=request.caregiver_id,
            code="WORKFLOW_ERROR",
            message=f"照护记录整理失败，请稍后重试。{exc}",
            retryable=True,
        )

    events = raw_workflow.get("extracted", {}).get("saved_events", [])
    structured_log = build_structured_log(note, events, generated_at)
    attention_items = build_attention_items(structured_log)
    communication_script = build_communication_script(note, structured_log)
    caregiver_support = build_caregiver_support(structured_log)
    memory_candidates = build_memory_candidates(raw_workflow)
    followup_patch = build_followup_patch(attention_items, structured_log)
    semantic_event_count = count_structured_events(structured_log)

    return CareWorkflowResponse(
        workflow_id=workflow_id,
        status="ok",
        patient_id=request.patient_id,
        caregiver_id=request.caregiver_id,
        generated_at=generated_at,
        guardrail=GuardrailResultV2(triggered=False, type="none"),
        structured_log=structured_log,
        attention_items=attention_items,
        communication_script=communication_script,
        caregiver_support=caregiver_support,
        memory_candidates=memory_candidates,
        followup_patch=followup_patch,
        analytics_context=CareWorkflowAnalyticsContext(
            event_count=max(len(events), semantic_event_count),
            high_attention_count=sum(1 for item in attention_items if item.severity in {"high", "crisis"}),
            guardrail_type="none",
            memory_candidate_count=len(memory_candidates),
        ),
    )


def detect_guardrail(note: str) -> GuardrailResultV2:
    """Return a forward guardrail result before ordinary workflow execution."""
    if _CRISIS_RE.search(note):
        return GuardrailResultV2(
            triggered=True,
            type="crisis",
            message="这听起来可能涉及即时安全风险。请优先联系当地紧急服务或可信任的家人/专业人员，CareMind 不能替代紧急支持。",
            alternative_cta=AlternativeCtaV2(
                label="查看紧急支持",
                action="open_emergency_support",
                payload={"reason": "crisis_or_emergency_signal"},
            ),
        )

    if _MEDICATION_DECISION_RE.search(note):
        return GuardrailResultV2(
            triggered=True,
            type="medication",
            message="我不能建议停药、补药或调整剂量，但可以帮你整理成复诊时要问医生的问题。",
            alternative_cta=AlternativeCtaV2(
                label="整理给医生的问题",
                action="create_doctor_question",
                payload={"question": "这次服药困难、拒药或漏药是否需要调整服药支持方式？"},
            ),
        )

    if _IMAGING_DECISION_RE.search(note):
        return GuardrailResultV2(
            triggered=True,
            type="imaging_or_test",
            message="我不能判断是否需要做 MRI、CT 或量表检查，但可以帮你整理近期变化，方便复诊时和医生讨论。",
            alternative_cta=AlternativeCtaV2(
                label="整理复诊材料",
                action="open_followup_prep",
                payload={"topic": "imaging_or_test_discussion"},
            ),
        )

    if _DIAGNOSIS_RE.search(note):
        return GuardrailResultV2(
            triggered=True,
            type="diagnosis",
            message="我不能判断诊断或病情结论，但可以帮你把观察到的变化整理给医生。",
            alternative_cta=AlternativeCtaV2(
                label="保存观察记录",
                action="save_observation",
                payload={"topic": "diagnosis_boundary"},
            ),
        )

    return GuardrailResultV2(triggered=False, type="none")


def _confidence_score(level: str) -> float:
    return {"high": 0.9, "medium": 0.75, "low": 0.5}.get(level, 0.5)


def _has_diagnostic_risk(text: str) -> bool:
    return _DIAGNOSTIC_RISK_TEXT_RE.search(text) is not None


def _structured_log_notes(note: str, diagnostic_risk: bool) -> list[str]:
    notes: list[str] = []
    if diagnostic_risk:
        notes.append("记录中包含可能越过医疗判断边界的表达，已作为家属观察保存，不生成医疗结论。")
    if _MEDICATION_DECISION_RE.search(note):
        notes.append("记录中包含用药决策相关表达，请在复诊时交给医生判断。")
    if _IMAGING_DECISION_RE.search(note):
        notes.append("记录中包含检查/量表决策相关表达，请整理成复诊问题。")
    return notes


def _source_window_days(date_range: str) -> int:
    if date_range == "30d":
        return 30
    if date_range == "7d":
        return 7
    return 0


def _document_display_title(document: Any) -> str:
    title = getattr(document, "title", None) or getattr(document, "id", None) or "未命名资料"
    return str(title)


def _unreadable_documents(documents: list[Any]) -> list[str]:
    unreadable: list[str] = []
    for document in documents:
        quality = getattr(document, "parse_quality", None)
        doctor_review_needed = bool(getattr(document, "doctor_review_needed", False))
        flags = set(getattr(document, "safety_flags", []) or [])
        if quality in {"unreadable", "unsupported"} or "unreadable_document" in flags:
            unreadable.append(_document_display_title(document))
        elif quality == "partially_readable" and doctor_review_needed:
            unreadable.append(_document_display_title(document))
    return list(dict.fromkeys(unreadable))


def _followup_safety_flags(request: FollowupSummaryRequest, unreadable_documents: list[str]) -> list[str]:
    flags: list[str] = []
    if not request.cloud_summary_allowed:
        flags.append("cloud_consent_required")
    if not request.raw_text_upload_allowed:
        flags.append("raw_text_restricted")
    if unreadable_documents:
        flags.append("unreadable_document")
    if request.full_window_required:
        flags.append("full_window_used")
    for document in request.followup_documents:
        for flag in getattr(document, "safety_flags", []) or []:
            flags.append(str(flag))
    return list(dict.fromkeys(flags))


def _followup_input_bundle_overview(request: FollowupSummaryRequest, source_window_days: int) -> dict[str, Any]:
    reviewed_documents = [document for document in request.followup_documents if document.status == "reviewed"]
    return {
        "source_window_days": source_window_days,
        "record_count": request.record_count,
        "attention_item_count": len(request.attention_items),
        "care_log_count": len(request.care_logs),
        "daily_metric_count": len(request.daily_metrics),
        "confirmed_document_count": len(reviewed_documents),
        "document_image_count": len(request.document_images),
        "caregiver_daily_metrics_trend_keys": sorted(request.caregiver_daily_metrics_trend.keys()),
        "full_window_required": request.full_window_required,
        "raw_text_upload_allowed": request.raw_text_upload_allowed,
    }


def _sanitize_followup_text(text: str) -> str:
    sanitized = text
    for forbidden, replacement in _FOLLOWUP_FORBIDDEN_WORDS.items():
        sanitized = sanitized.replace(forbidden, replacement)
    return sanitized


def _fit_followup_summary_length(text: str) -> str:
    additions = [
        " 家属记录中暂未覆盖的部分，可在复诊前继续补充发生日期、持续时间、频率、当时场景和家属采取过的回应方式。",
        " 观察到的变化建议尽量用具体描述呈现，例如几点发生、持续多久、是否反复出现、当时是否有饮食、睡眠、服药或环境变化。",
        " 已确认资料建议按时间顺序带到门诊，截图或扫描件不清楚时请携带原件、纸质报告、影像片或可打开的电子文件。",
        " 如需要讨论用药、检查或量表结果，建议把家属担心的问题写成问题清单，由医生结合面诊和原始资料判断。",
        " 家属也可以补充照护者近几天睡眠和压力情况，方便医生了解家庭照护负担，并讨论是否需要社区支持或轮替照护资源。",
        " 复诊前建议再次核对所有条目是否来自家属亲眼观察、已确认资料或医生原话，无法确认的内容应保留为待核对问题。",
    ]
    fitted = text
    for addition in additions:
        if len(fitted) >= 600:
            break
        fitted += addition
    if len(fitted) > 800:
        fitted = fitted[:799].rstrip("，；、 ") + "。"
    return fitted


def _build_followup_summary_zh(
    request: FollowupSummaryRequest,
    followup_patch: FollowupPatchV2,
    tried_strategies: list[str],
    unreadable_documents: list[str],
) -> str:
    window_label = "30 天" if request.date_range == "30d" else "7 天" if request.date_range == "7d" else "所选时间段"
    attention_text = "；".join(followup_patch.summary_bullets[:4]) or "暂无明确高关注事项"
    question_text = "；".join(followup_patch.doctor_questions[:3]) or "暂无需额外整理的问题"
    strategy_text = "；".join(tried_strategies[:3]) if tried_strategies else "暂无家属确认的有效策略"
    document_text = "；".join(
        f"{document.title}：{'、'.join(document.confirmed_items[:2]) if document.confirmed_items else (document.summary or '已家属确认')}"
        for document in request.followup_documents
        if document.status == "reviewed"
    )
    if not document_text:
        document_text = "暂无已确认资料"
    unreadable_text = ""
    if unreadable_documents:
        unreadable_text = f" 有 {len(unreadable_documents)} 份资料无法可靠读取或需医生查看原件：{'、'.join(unreadable_documents[:3])}。"

    summary = (
        f"家属记录覆盖{window_label}，共整理 {request.record_count} 条照护记录。"
        f"观察到的重点包括：{attention_text}。"
        f"家属描述中已确认或尝试过的方式包括：{strategy_text}。"
        f"已确认资料包括：{document_text}。"
        f"{unreadable_text}"
        f"建议复诊时优先沟通：{question_text}。"
        "以上内容只整理家属记录、照护观察和已确认资料，不替代医生当面判断；如遇急性危险或安全风险，请优先联系当地紧急服务。"
    )
    return _fit_followup_summary_length(_sanitize_followup_text(summary))


def _english_key_phrases(request: FollowupSummaryRequest, followup_patch: FollowupPatchV2) -> list[str]:
    phrases: list[str] = []
    type_to_phrase = {
        "night_safety": "night waking and safety",
        "nutrition": "nutrition and hydration",
        "medication": "medication adherence",
        "wandering": "wandering risk",
        "behavior": "behavioral expression",
        "caregiver": "caregiver burden",
    }
    for item in request.attention_items:
        phrase = type_to_phrase.get(item.type)
        if phrase:
            phrases.append(phrase)
    if request.followup_documents:
        phrases.append("confirmed follow-up documents")
    if followup_patch.doctor_questions:
        phrases.append("questions for clinician")
    return list(dict.fromkeys(phrases))[:6]


def build_structured_log(note: str, events: list[dict[str, Any]], generated_at: str) -> StructuredLogV2:
    night_wakings = _extract_night_wakings(note, events)
    behavior_events = [
        _behavior_event(event)
        for event in events
        if event.get("event_type") in {"home_seeking", "suspicion", "agitation"}
    ]
    diagnostic_risk = _has_diagnostic_risk(note)
    sleep_log = SleepLogV2(
        night_wakings=night_wakings,
        note="未提到夜间起床次数" if night_wakings is None else f"记录到夜间起床 {night_wakings} 次。",
        evidence=_evidence_for(note, ["夜", "半夜", "起床", "醒", "起夜"]),
        confidence="high" if night_wakings is not None else "low",
    )
    nutrition_log = _nutrition_log(note)
    medication_log = _medication_log(note)
    safety_log = _safety_log(note, night_wakings)
    caregiver_log = _caregiver_log(note, events)
    field_confidence = {
        "sleep": _confidence_score(sleep_log.confidence),
        "behavior": _confidence_score("high" if behavior_events else "low"),
        "nutrition": _confidence_score(nutrition_log.confidence),
        "medication": _confidence_score(medication_log.confidence),
        "safety": _confidence_score(safety_log.confidence),
        "caregiver": _confidence_score(caregiver_log.confidence),
    }

    return StructuredLogV2(
        source_text=note,
        log_date=generated_at[:10],
        sleep=sleep_log,
        behavior=behavior_events,
        nutrition=nutrition_log,
        medication=medication_log,
        safety=safety_log,
        caregiver=caregiver_log,
        field_confidence=field_confidence,
        low_confidence_fields=[field for field, score in field_confidence.items() if score <= 0.6],
        notes_for_caregiver=_structured_log_notes(note, diagnostic_risk),
        diagnostic_risk=diagnostic_risk,
    )


def build_attention_items(log: StructuredLogV2) -> list[AttentionItemV2]:
    items: list[AttentionItemV2] = []
    suffix = uuid4().hex[:8]

    if log.sleep.night_wakings is not None or log.safety.night_wandering is True or log.safety.door_exit_attempt is True:
        severity = "high" if log.safety.door_exit_attempt is True or (log.sleep.night_wakings or 0) >= 3 else "medium"
        items.append(
            AttentionItemV2(
                id=f"att_night_safety_{suffix}",
                type="night_safety",
                severity=severity,
                title="今晚留意夜间起床安全",
                evidence=log.safety.note if log.safety.note != "未提到安全事件" else log.sleep.note,
                doctor_feedback_hint="如持续出现，建议复诊时告知医生。",
                actions=[
                    AttentionActionV2(
                        id="hallway_light",
                        label="打开走廊夜灯",
                        alternative_label="如果不能开灯，先清理床边和门口障碍物。",
                    ),
                    AttentionActionV2(
                        id="door_check",
                        label="睡前确认门锁和门铃提醒",
                        alternative_label="如果没有门铃提醒，先把钥匙放到家属可管理的位置。",
                    ),
                    AttentionActionV2(
                        id="floor_clear",
                        label="移开床边和门口障碍物",
                        alternative_label="如果来不及整理全屋，先整理床到卫生间这条路。",
                    ),
                ],
            )
        )

    if log.nutrition.meal_intake != "unknown" or log.nutrition.choking is True:
        items.append(
            AttentionItemV2(
                id=f"att_nutrition_{suffix}",
                type="nutrition",
                severity="medium",
                title="今天关注饮食和饮水",
                evidence=log.nutrition.note,
                doctor_feedback_hint="若连续少食、呛咳或明显消瘦，建议咨询医生或营养师。",
                actions=[
                    AttentionActionV2(id="meal_record", label="记录今天大概吃了多少"),
                    AttentionActionV2(id="water_record", label="记录今天饮水情况"),
                ],
            )
        )

    if log.medication.mentioned:
        items.append(
            AttentionItemV2(
                id=f"att_medication_{suffix}",
                type="medication",
                severity="medium",
                title="记录服药相关变化",
                evidence=log.medication.note,
                doctor_feedback_hint="不建议自行补药或调整剂量，可在复诊时带上记录。",
                actions=[
                    AttentionActionV2(id="medication_time", label="记录发生时间和场景"),
                    AttentionActionV2(id="doctor_question", label="加入复诊问题清单"),
                ],
            )
        )

    if log.behavior:
        behavior = log.behavior[0]
        items.append(
            AttentionItemV2(
                id=f"att_behavior_{suffix}",
                type="behavior",
                severity=behavior.severity,
                title="准备一句低冲突回应",
                evidence=behavior.evidence,
                doctor_feedback_hint="如类似表达频繁出现，建议复诊时说明出现时间、频率和回应效果。",
                actions=[
                    AttentionActionV2(id="script_try", label="先用推荐话术回应"),
                    AttentionActionV2(id="trigger_record", label="记录触发场景和回应效果"),
                ],
            )
        )

    if log.caregiver.stress_level in {"high", "crisis"}:
        items.append(
            AttentionItemV2(
                id=f"att_caregiver_{suffix}",
                type="caregiver",
                severity=log.caregiver.stress_level,
                title="今天也要照顾你自己",
                evidence="记录中出现照护者疲惫或压力表达。",
                doctor_feedback_hint="如果长期睡眠不足，也建议复诊或社区咨询时反馈家庭照护压力。",
                actions=[
                    AttentionActionV2(id="lower_goal", label="今晚只保留安全和基本照护目标"),
                    AttentionActionV2(id="ask_support", label="联系一位家人轮替一小段时间"),
                ],
            )
        )

    return items[:6]


def build_communication_script(note: str, log: StructuredLogV2) -> CommunicationScriptV2 | None:
    first_behavior = log.behavior[0].event_type if log.behavior else ""
    default_record_suggestion = "记录触发时间、场景、对方反应，以及这句话是否让情绪缓和。"

    if first_behavior == "suspicion" or re.search(r"偷|钱|丢", note):
        return CommunicationScriptV2(
            scenario_type="suspicion",
            not_recommended="没人偷，你别乱想。",
            recommended="找不到东西真的会很着急，我陪你一起找。",
            principle="先回应情绪，再处理事实；避免直接否定和争辩。",
            speech_text="找不到东西真的会很着急，我陪你一起找。",
            record_suggestion=default_record_suggestion,
        )

    if first_behavior == "home_seeking" or re.search(r"要回家|回老家", note):
        return CommunicationScriptV2(
            scenario_type="home_seeking",
            not_recommended="这里就是家，你别再说了。",
            recommended="你是不是有点想家？我们先坐一下，我陪你慢慢说。",
            principle="先接住情绪，再用安全的陪伴动作转移注意力。",
            speech_text="你是不是有点想家？我们先坐一下，我陪你慢慢说。",
            record_suggestion=default_record_suggestion,
        )

    if log.medication.mentioned:
        return CommunicationScriptV2(
            scenario_type="medication_refusal",
            not_recommended="你必须现在吃，不吃不行。",
            recommended="我知道你现在不想吃，我们先歇一下，等你舒服点再看看。",
            principle="降低对抗，记录拒药场景，不自行补药或调整剂量。",
            speech_text="我知道你现在不想吃，我们先歇一下，等你舒服点再看看。",
            record_suggestion="记录拒药发生时间、是否补服过、是否呛咳或不适；不要自行调整剂量。",
        )

    if log.nutrition.meal_intake in {"less", "few_bites", "refused"}:
        return CommunicationScriptV2(
            scenario_type="meal_refusal",
            not_recommended="你怎么又不吃饭？",
            recommended="我们先吃两口软一点的，吃不下也没关系，我陪着你。",
            principle="减少压力，记录摄入量；如果持续少食或呛咳，应咨询医生或营养师。",
            speech_text="我们先吃两口软一点的，吃不下也没关系，我陪着你。",
            record_suggestion="记录大概吃了多少、喝了多少、有没有呛咳，以及哪种食物更容易接受。",
        )

    return CommunicationScriptV2(
        scenario_type="general_support",
        not_recommended="别想太多，没事的。",
        recommended="我在这儿，我们慢慢来。你哪里不舒服，告诉我就好。",
        principle="用短句、慢语速和陪伴感降低压力；不急着纠正或催促。",
        speech_text="我在这儿，我们慢慢来。你哪里不舒服，告诉我就好。",
        record_suggestion="记录今天沟通是否顺利、对方情绪有没有变化，以及下次可以继续尝试的方法。",
    )


def build_caregiver_support(log: StructuredLogV2) -> CaregiverSupportV2:
    level = log.caregiver.stress_level

    if level == "crisis":
        return CaregiverSupportV2(
            stress_level="crisis",
            message="今天先不要硬撑。请尽快联系可信任的人接手一段时间；如果担心安全，请立即联系当地紧急服务。",
            suggested_action="立刻联系一位家人、邻居或专业支持。",
            crisis=True,
        )

    if level == "high":
        return CaregiverSupportV2(
            stress_level="high",
            message="今天目标放低一点，优先保证夜间安全和你的基本休息。",
            suggested_action="尽量请一位家人轮替一小段时间。",
            crisis=False,
        )

    if level == "medium":
        return CaregiverSupportV2(
            stress_level="medium",
            message="今天把任务拆小一点，能交出去的部分先交出去一点。",
            suggested_action="先安排一段不被打断的短休息。",
            crisis=False,
        )

    return CaregiverSupportV2(
        stress_level="low",
        message="今天先按平常节奏来，继续记录变化。",
        suggested_action="给自己留一点缓冲时间。",
        crisis=False,
    )


def build_memory_candidates(raw_workflow: dict[str, Any]) -> list[MemoryCandidateV2]:
    classified = raw_workflow.get("memory_update_candidates", {})
    candidates = classified.get("needs_confirmation", []) if isinstance(classified, dict) else []
    result: list[MemoryCandidateV2] = []

    for item in candidates:
        memory_type = "behavior_pattern"
        if item.get("memory_type") == "caregiver_state":
            memory_type = "caregiver_support"

        result.append(
            MemoryCandidateV2(
                id=f"mem_{uuid4().hex[:8]}",
                type=memory_type,
                title=item.get("behavior_type") or "新的照护模式",
                description=item.get("content", "这可能是一个值得后续参考的照护模式。"),
                evidence=[item.get("content", "")],
                requires_confirmation=bool(item.get("requires_confirmation", True)),
            )
        )

    return result


def build_followup_patch(items: list[AttentionItemV2], log: StructuredLogV2) -> FollowupPatchV2:
    summary_bullets = [f"{item.title}：{item.evidence}" for item in items]
    questions: list[str] = []

    if any(item.type == "night_safety" for item in items):
        questions.append("近期夜间起床或开门外出相关变化，是否需要进一步评估原因？")
    if any(item.type == "nutrition" for item in items):
        questions.append("近期进食、饮水或呛咳变化，是否需要营养或吞咽相关评估？")
    if any(item.type == "medication" for item in items):
        questions.append("拒药、漏药或服药困难持续出现时，是否需要调整服药支持方式？")
    if log.behavior:
        questions.append("近期行为或情绪表达变化，是否需要复诊时重点反馈？")
    if log.caregiver.stress_level in {"high", "crisis"}:
        questions.append("家属长期睡眠不足或照护压力较高，是否有社区照护或喘息服务建议？")

    questions.append("复诊时是否需要携带 MRI/CT、认知量表或当前用药清单？")

    return FollowupPatchV2(
        summary_bullets=summary_bullets or ["暂无明确关注事项记录。"],
        doctor_questions=list(dict.fromkeys(questions)),
        materials_to_bring=[
            "近期用药清单",
            "近 7 天照护摘要",
            "既往 MRI/CT 或认知量表结果，如已有",
            "想问医生的问题清单",
        ],
    )


def build_followup_patch_from_attention(
    items: list[AttentionItemV2],
    record_count: int,
    documents: list[Any] | None = None,
) -> FollowupPatchV2:
    summary_bullets = [f"{item.title}：{item.evidence}" for item in items]
    questions: list[str] = []
    reviewed_documents = [
        document
        for document in (documents or [])
        if getattr(document, "status", "") == "reviewed"
    ]

    if any(item.type == "night_safety" for item in items):
        questions.append("近期夜间起床、开门外出或跌倒风险相关变化，是否需要进一步评估原因？")
    if any(item.type == "nutrition" for item in items):
        questions.append("近期进食、饮水、体重或呛咳变化，是否需要营养或吞咽相关评估？")
    if any(item.type == "medication" for item in items):
        questions.append("拒药、漏药或服药困难持续出现时，是否需要调整服药支持方式？")
    if any(item.type in {"behavior", "wandering"} for item in items):
        questions.append("近期行为或情绪表达变化，是否需要复诊时重点反馈？")
    if any(item.type == "caregiver" for item in items):
        questions.append("家属长期睡眠不足或照护压力较高，是否有社区照护或喘息服务建议？")

    if record_count < 3:
        summary_bullets.append("当前记录仍较少，建议继续记录夜间、饮食、服药和安全相关变化。")

    for document in reviewed_documents:
        document_items = [item.strip() for item in getattr(document, "confirmed_items", []) if item.strip()]
        if document_items:
            summary_bullets.extend(document_items[:3])
        elif getattr(document, "summary", None):
            summary_bullets.append(f"{document.title}：{document.summary}")

    questions.append("复诊时是否需要携带 MRI/CT、认知量表或当前用药清单？")

    document_materials = []
    for document in reviewed_documents:
        material = f"已确认资料：{document.title}"
        if getattr(document, "reviewed_at", None):
            material = f"{material}（家属已核对）"
        document_materials.append(material)

    return FollowupPatchV2(
        summary_bullets=summary_bullets or ["暂无明确关注事项记录。"],
        doctor_questions=list(dict.fromkeys(questions)),
        materials_to_bring=list(
            dict.fromkeys(
                [
                    "近期用药清单",
                    "近 7 天照护摘要",
                    "既往 MRI/CT 或认知量表结果，如已有",
                    "想问医生的问题清单",
                    *document_materials,
                ]
            )
        ),
    )


def build_followup_readiness(record_count: int) -> FollowupReadinessV2:
    if record_count <= 0:
        return FollowupReadinessV2(
            level="empty",
            record_count=record_count,
            message="还没有可整理的照护记录。先保存一条智能记录，复诊准备会自动累积材料。",
        )
    if record_count < 3:
        return FollowupReadinessV2(
            level="early",
            record_count=record_count,
            message=f"已保存 {record_count} 条记录，当前可生成早期摘要；连续记录会让医生更容易看到变化。",
        )
    return FollowupReadinessV2(
        level="ready",
        record_count=record_count,
        message=f"已保存 {record_count} 条记录，可以生成复诊沟通摘要。",
    )


def build_followup_metrics(
    record_count: int,
    items: list[AttentionItemV2],
    patch: FollowupPatchV2,
    documents: list[Any] | None = None,
) -> list[ReportMetricV2]:
    high_count = sum(1 for item in items if item.severity in {"high", "crisis"})
    safety_count = sum(1 for item in items if item.type in {"night_safety", "wandering"})
    question_count = len(patch.doctor_questions)
    reviewed_document_count = sum(1 for document in (documents or []) if getattr(document, "status", "") == "reviewed")

    return [
        ReportMetricV2(
            label="照护记录",
            value=f"{record_count} 条",
            helper="来自已保存的家庭记录",
            tone="brand" if record_count >= 3 else "info",
        ),
        ReportMetricV2(
            label="高关注项",
            value=str(high_count),
            helper="建议复诊时优先说明",
            tone="alert" if high_count > 0 else "brand",
        ),
        ReportMetricV2(
            label="安全线索",
            value=str(safety_count),
            helper="夜间、外出或走失相关",
            tone="watch" if safety_count > 0 else "info",
        ),
        ReportMetricV2(
            label="复诊资料",
            value=str(reviewed_document_count),
            helper=f"{question_count} 个问题已整理",
            tone="info",
        ),
    ]


def count_structured_events(log: StructuredLogV2) -> int:
    count = 0
    if log.sleep.night_wakings is not None:
        count += 1
    count += len(log.behavior)
    if log.nutrition.meal_intake != "unknown" or log.nutrition.choking is True or log.nutrition.weight_change != "unknown":
        count += 1
    if log.medication.mentioned:
        count += 1
    if (
        log.safety.night_wandering is True
        or log.safety.door_exit_attempt is True
        or log.safety.fall is True
        or log.safety.wandering is True
        or log.safety.acute_danger
    ):
        count += 1
    if log.caregiver.stress_level in {"medium", "high", "crisis"}:
        count += 1
    return count


def _nutrition_log(note: str) -> NutritionLogV2:
    has_nutrition = re.search(r"饭|吃|食欲|饮水|喝水|呛咳|呛到|体重|瘦", note) is not None
    meal_intake = "unknown"
    if re.search(r"拒食|不肯吃|不吃饭", note):
        meal_intake = "refused"
    elif re.search(r"几口|很少|吃得少|摄入不足", note):
        meal_intake = "few_bites"
    elif re.search(r"少吃|吃少了|胃口差", note):
        meal_intake = "less"

    water_intake = "unknown"
    if re.search(r"不喝水|饮水少|喝水少", note):
        water_intake = "less"
    elif re.search(r"喝很多水|饮水很多", note):
        water_intake = "more"

    choking: bool | str = True if re.search(r"呛咳|呛到", note) else "unknown"
    weight_change = "loss" if re.search(r"瘦|体重下降|明显消瘦", note) else "unknown"

    return NutritionLogV2(
        meal_intake=meal_intake,
        water_intake=water_intake,
        choking=choking,
        weight_change=weight_change,
        note="提到饮食或饮水变化，建议补充具体摄入量。" if has_nutrition else "未提到饮食变化。",
        evidence=_evidence_for(note, ["饭", "吃", "饮水", "呛咳", "体重", "瘦"]),
        confidence="medium" if has_nutrition else "low",
    )


def _medication_log(note: str) -> MedicationLogV2:
    mentioned = re.search(r"药|服药|拒药|漏药|漏服|没吃药", note) is not None
    refusal_count = _extract_medication_refusal_count(note)

    return MedicationLogV2(
        mentioned=mentioned,
        refusal_count=refusal_count,
        missed_dose=True if re.search(r"漏药|漏服|没吃药", note) else "unknown",
        duplicate_dose=True if re.search(r"重复吃药|吃了两次|多吃", note) else "unknown",
        medication_names=[],
        note="提到服药、拒药或漏药相关情况，建议记录发生时间和场景。" if mentioned else "未提到服药变化。",
        evidence=_evidence_for(note, ["药", "服药", "拒药", "漏药", "漏服"]),
        confidence="medium" if mentioned else "low",
    )


def _safety_log(note: str, night_wakings: int | None) -> SafetyLogV2:
    has_safety = night_wakings is not None or re.search(r"夜|昨晚|半夜|起床|起来|开门|出去|外出|走失|迷路|跌倒|摔", note) is not None
    door_exit = True if re.search(r"开门|出去|外出", note) else "unknown"
    fall = True if re.search(r"跌倒|摔", note) else "unknown"
    wandering = True if re.search(r"走失|迷路", note) else "unknown"

    return SafetyLogV2(
        night_wandering=True if night_wakings is not None or re.search(r"夜|半夜|起床", note) else "unknown",
        door_exit_attempt=door_exit,
        fall=fall,
        wandering=wandering,
        acute_danger=False,
        note="提到夜间活动、外出、走失或跌倒相关线索，建议优先关注环境安全。" if has_safety else "未提到安全事件。",
        evidence=_evidence_for(note, ["夜", "昨晚", "半夜", "起床", "起来", "开门", "出去", "走失", "跌倒"]),
        confidence="medium" if has_safety else "low",
    )


def _caregiver_log(note: str, events: list[dict[str, Any]]) -> CaregiverLogV2:
    quote = _extract_quote(note, ["撑不住", "很累", "崩溃", "没睡", "烦躁", "压力", "焦虑", "想哭"])
    has_distress_event = any(event.get("event_type") == "caregiver_distress" for event in events)
    has_sleep_loss = re.search(r"没睡|睡不着|整夜", note) is not None
    has_direct_distress = re.search(r"撑不住|撑不下去|很累|崩溃|烦躁|压力|焦虑|想哭", note) is not None
    stress_level = "high" if has_distress_event or has_direct_distress else "medium" if has_sleep_loss else "low"

    return CaregiverLogV2(
        quote=quote,
        sleep_hours_bucket="unknown",
        mood_score=None,
        support_today="unknown",
        personal_time=None,
        stress_level=stress_level,
        evidence=[quote] if quote else [],
        confidence="high" if quote else "low",
    )


def _behavior_event(event: dict[str, Any]) -> BehaviorEventV2:
    event_type = event.get("event_type", "behavior")
    description = event.get("description", "")
    return BehaviorEventV2(
        event_type=event_type,
        label=event.get("event_label") or _behavior_label(event_type),
        frequency=_behavior_frequency(description),
        severity=event.get("severity", "medium"),
        evidence=description,
        needs_communication_script=event_type in {"home_seeking", "suspicion", "agitation"},
        confidence="high",
    )


def _extract_night_wakings(note: str, events: list[dict[str, Any]]) -> int | None:
    for event in events:
        if event.get("event_type") in {"night_wandering", "sleep_disruption"} and isinstance(event.get("frequency"), int):
            return event["frequency"]
    return _extract_count(note)


def _extract_medication_refusal_count(note: str) -> int | None:
    if not re.search(r"拒药|不肯吃药|不吃药|没吃药|漏服|漏药", note):
        return None

    count_pattern = r"(\d+|一|两|二|三|四|五|六|七|八|九|十)"
    after = re.search(rf"(?:拒药|不肯吃药|不吃药|没吃药|漏服|漏药).{{0,8}}?{count_pattern}\s*次", note)
    before = re.search(rf"{count_pattern}\s*次.{{0,8}}?(?:拒药|不肯吃药|不吃药|没吃药|漏服|漏药)", note)
    token = (after or before).group(1) if (after or before) else None
    return _number_from_token(token) if token else 1


def _extract_count(note: str) -> int | None:
    match = re.search(r"(\d+)\s*次", note)
    if match:
        return int(match.group(1))

    for token, value in {"一次": 1, "两次": 2, "二次": 2, "三次": 3, "四次": 4, "五次": 5}.items():
        if token in note:
            return value

    return None


def _number_from_token(token: str | None) -> int | None:
    if not token:
        return None
    if token.isdigit():
        return int(token)
    return {"一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}.get(token)


def _extract_quote(note: str, keywords: list[str]) -> str:
    parts = re.split(r"[，。！？,.!?；;]", note)
    for part in parts:
        if any(keyword in part for keyword in keywords):
            return part.strip()
    return ""


def _evidence_for(note: str, keywords: list[str]) -> list[str]:
    parts = [part.strip() for part in re.split(r"[，。！？,.!?；;]", note) if part.strip()]
    evidence = [part for part in parts if any(keyword in part for keyword in keywords)]
    return evidence[:3]


def _behavior_label(event_type: str) -> str:
    return {
        "home_seeking": "反复表达想回家",
        "suspicion": "担心物品或钱被拿走",
        "agitation": "出现烦躁或激动表达",
    }.get(event_type, "行为变化")


def _behavior_frequency(description: str) -> str:
    if re.search(r"一直|反复|多次|总是|不停", description):
        return "反复"
    return "待确认"


def _workflow_id(prefix: str) -> str:
    return f"{prefix}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"


def _now(timezone_name: str | None) -> str:
    try:
        tz = ZoneInfo(timezone_name or "Asia/Shanghai")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("Asia/Shanghai")
    return datetime.now(tz).isoformat(timespec="seconds")


def _error_response(
    *,
    workflow_id: str,
    generated_at: str,
    patient_id: str,
    caregiver_id: str,
    code: str,
    message: str,
    retryable: bool,
) -> CareWorkflowResponse:
    return CareWorkflowResponse(
        workflow_id=workflow_id,
        status="error",
        patient_id=patient_id,
        caregiver_id=caregiver_id,
        generated_at=generated_at,
        guardrail=GuardrailResultV2(triggered=False, type="none"),
        structured_log=None,
        attention_items=[],
        communication_script=None,
        caregiver_support=None,
        memory_candidates=[],
        followup_patch=None,
        analytics_context=CareWorkflowAnalyticsContext(
            event_count=0,
            high_attention_count=0,
            guardrail_type="none",
            memory_candidate_count=0,
        ),
        error=CareWorkflowError(code=code, message=message, retryable=retryable),
    )
