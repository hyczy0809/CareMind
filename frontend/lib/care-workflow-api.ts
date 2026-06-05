import type {
  AttentionItem,
  FollowupDocumentRecord,
  MemoryItem,
  StructuredLog
} from "../types/caremind";
import type {
  AttentionItemV2,
  CareWorkflowRequest,
  CareWorkflowResponse,
  CommunicationScriptV2,
  FollowupRange,
  FollowupSummaryRequest,
  FollowupSummaryResponse,
  GuardrailCheckRequest,
  GuardrailCheckResponse,
  MemoryCandidateV2,
  StructuredLogV2
} from "../types/care-workflow";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8090";
const API_BASE_URL = process.env.EXPO_PUBLIC_CAREMIND_API_URL ?? DEFAULT_API_BASE_URL;
const REQUEST_TIMEOUT_MS = 12000;

export interface CareWorkflowAppResult {
  response: CareWorkflowResponse;
  structuredLog: StructuredLog | null;
  attentionItems: AttentionItem[];
  memoryItems: MemoryItem[];
  scriptAdvice: {
    notRecommended: string;
    recommended: string;
    principle: string;
  } | null;
}

export interface FollowupSummaryInput {
  patientId: string;
  caregiverId: string;
  dateRange: FollowupRange;
  recordCount: number;
  attentionItems: AttentionItem[];
  memoryItems: MemoryItem[];
  followupDocuments?: FollowupDocumentRecord[];
  timezone?: string;
}

export type MedicalDocumentStatus = "uploaded" | "parsing" | "review_required" | "reviewed" | "parse_failed" | "deleted";

export type DocumentParseConfidence = "low" | "medium" | "high";
export type DocumentParseSource = "filename" | "user_summary" | "document_type" | "system_template";

export interface MedicalDocumentRecord {
  document_id: string;
  patient_id: string;
  document_type: string;
  filename: string;
  mime_type: string;
  file_size: number;
  checksum: string;
  status: MedicalDocumentStatus;
  summary: string | null;
  uploaded_at: string;
  storage_path: string;
  parse_error: string | null;
}

export interface DocumentParseField {
  field: string;
  label: string;
  value: string;
  confidence: DocumentParseConfidence;
  source: DocumentParseSource;
  requires_confirmation: boolean;
}

export interface DocumentReviewQuestion {
  id: string;
  question: string;
  reason: string;
}

export interface DocumentParseResult {
  document_id: string;
  status: "review_required" | "parse_failed";
  extracted_fields: DocumentParseField[];
  review_questions: DocumentReviewQuestion[];
  followup_summary_items: string[];
  medical_boundary: string;
  parsed_at: string;
  parse_error: string | null;
}

export interface ConfirmDocumentReviewInput {
  documentId: string;
  confirmedItems: string[];
  familyNote?: string;
}

export interface ConfirmDocumentReviewResponse {
  document_id: string;
  status: "reviewed";
  confirmed_items: string[];
  family_note: string | null;
  reviewed_at: string;
}

export interface UploadMedicalDocumentInput {
  patientId: string;
  documentType: string;
  summary?: string;
  asset: {
    uri: string;
    name: string;
    mimeType?: string | null;
  };
}

export interface TranscribeAudioNoteInput {
  patientId: string;
  language?: string;
  asset: {
    uri: string;
    name: string;
    mimeType?: string | null;
  };
}

export interface AudioTranscriptionResponse {
  request_id: string;
  transcript: string;
  model: string;
  language: string | null;
  provider: "openai_compatible";
  medical_boundary: string;
}

export async function runCareWorkflow(request: CareWorkflowRequest): Promise<CareWorkflowAppResult> {
  const response = await postCareWorkflow(request);

  return {
    response,
    structuredLog: response.structured_log ? mapStructuredLog(response.structured_log) : null,
    attentionItems: response.attention_items.map(mapAttentionItem),
    memoryItems: response.memory_candidates.map((item) => mapMemoryCandidate(item, response.patient_id)),
    scriptAdvice: response.communication_script ? mapScriptAdvice(response.communication_script) : null
  };
}

export async function checkGuardrail(request: GuardrailCheckRequest): Promise<GuardrailCheckResponse> {
  return postJson<GuardrailCheckResponse>("/api/guardrail/check", request);
}

export async function generateFollowupSummary(input: FollowupSummaryInput): Promise<FollowupSummaryResponse> {
  const request: FollowupSummaryRequest = {
    patient_id: input.patientId,
    caregiver_id: input.caregiverId,
    date_range: input.dateRange,
    record_count: input.recordCount,
    attention_items: input.attentionItems.map(toAttentionItemV2),
    memory_items: input.memoryItems.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      title: item.title,
      description: item.description,
      evidence: item.evidence
    })),
    followup_documents: (input.followupDocuments ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      title: item.title,
      summary: item.summary || null,
      confirmed_items: item.confirmedItems ?? [],
      reviewed_at: item.reviewedAt ?? null
    })),
    timezone: input.timezone ?? "Asia/Shanghai"
  };

  return postJson<FollowupSummaryResponse>("/api/reports/follow-up", request);
}

export async function uploadMedicalDocument(input: UploadMedicalDocumentInput): Promise<MedicalDocumentRecord> {
  const formData = new FormData();
  formData.append("patient_id", input.patientId);
  formData.append("document_type", input.documentType);
  formData.append("summary", input.summary ?? "");
  formData.append("file", {
    uri: input.asset.uri,
    name: input.asset.name,
    type: input.asset.mimeType ?? "application/octet-stream"
  } as unknown as Blob);

  const response = await fetch(`${API_BASE_URL}/api/documents/upload`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料上传失败"));
  }

  return (await response.json()) as MedicalDocumentRecord;
}

export async function transcribeAudioNote(input: TranscribeAudioNoteInput): Promise<AudioTranscriptionResponse> {
  const formData = new FormData();
  formData.append("patient_id", input.patientId);
  formData.append("language", input.language ?? "zh");
  formData.append("file", {
    uri: input.asset.uri,
    name: input.asset.name,
    type: input.asset.mimeType ?? "audio/m4a"
  } as unknown as Blob);

  const response = await fetch(`${API_BASE_URL}/api/audio/transcribe`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readableApiError(response, "语音转文字失败"));
  }

  return (await response.json()) as AudioTranscriptionResponse;
}

export async function getMedicalDocument(documentId: string): Promise<MedicalDocumentRecord> {
  const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}`);
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料状态查询失败"));
  }
  return (await response.json()) as MedicalDocumentRecord;
}

export async function parseMedicalDocument(documentId: string): Promise<DocumentParseResult> {
  const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}/parse`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料整理失败"));
  }
  return (await response.json()) as DocumentParseResult;
}

export async function confirmMedicalDocumentReview(input: ConfirmDocumentReviewInput): Promise<ConfirmDocumentReviewResponse> {
  const response = await fetch(`${API_BASE_URL}/api/documents/${input.documentId}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      confirmed_items: input.confirmedItems,
      family_note: input.familyNote ?? null
    })
  });

  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料确认失败"));
  }

  return (await response.json()) as ConfirmDocumentReviewResponse;
}

export async function deleteMedicalDocument(documentId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料删除失败"));
  }
}

async function postCareWorkflow(request: CareWorkflowRequest): Promise<CareWorkflowResponse> {
  return postJson<CareWorkflowResponse>("/api/care-workflow", request);
}

async function readableApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ? `${fallback}：${payload.detail}` : `${fallback}：${response.status}`;
  } catch {
    return `${fallback}：${response.status}`;
  }
}

async function postJson<TResponse>(path: string, payload: unknown): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`CareMind API 请求失败：${response.status}`);
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("CareMind 后端响应超时，请确认服务是否已启动。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapStructuredLog(log: StructuredLogV2): StructuredLog {
  return {
    sleep: {
      nightWakings: log.sleep.night_wakings,
      note: log.sleep.note
    },
    behavior: log.behavior.map((item) => ({
      label: item.label,
      evidence: item.evidence,
      frequency: item.frequency
    })),
    nutrition: {
      mealIntake: log.nutrition.meal_intake,
      waterIntake: log.nutrition.water_intake,
      choking: log.nutrition.choking,
      weightChange: log.nutrition.weight_change,
      note: log.nutrition.note
    },
    medication: {
      mentioned: log.medication.mentioned,
      refusalCount: log.medication.refusal_count,
      missedDose: log.medication.missed_dose,
      duplicateDose: log.medication.duplicate_dose,
      medicationNames: log.medication.medication_names,
      note: log.medication.note
    },
    safety: {
      nightWandering: log.safety.night_wandering,
      doorExitAttempt: log.safety.door_exit_attempt,
      fall: log.safety.fall,
      wandering: log.safety.wandering,
      acuteDanger: log.safety.acute_danger,
      note: log.safety.note
    },
    caregiver: {
      quote: log.caregiver.quote,
      stressSignal: log.caregiver.stress_level === "medium" || log.caregiver.stress_level === "high" || log.caregiver.stress_level === "crisis"
    }
  };
}

function mapAttentionItem(item: AttentionItemV2): AttentionItem {
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    evidence: item.evidence,
    doctorFeedbackHint: item.doctor_feedback_hint,
    createdAt: new Date().toISOString(),
    actions: item.actions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      blockedReason: action.blocked_reason ?? undefined,
      alternativeLabel: action.alternative_label ?? undefined
    }))
  };
}

function toAttentionItemV2(item: AttentionItem): AttentionItemV2 {
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    evidence: item.evidence,
    doctor_feedback_hint: item.doctorFeedbackHint,
    actions: item.actions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      blocked_reason: action.blockedReason ?? null,
      alternative_label: action.alternativeLabel ?? null
    }))
  };
}

function mapMemoryCandidate(item: MemoryCandidateV2, patientId: string): MemoryItem {
  const now = new Date().toISOString();

  return {
    id: item.id,
    patientId,
    type: item.type,
    status: "candidate",
    title: item.title,
    description: item.description,
    evidence: item.evidence,
    sourceEventIds: [],
    createdAt: now,
    updatedAt: now,
    requiresConfirmation: item.requires_confirmation
  };
}

function mapScriptAdvice(script: CommunicationScriptV2) {
  return {
    notRecommended: script.not_recommended,
    recommended: script.recommended,
    principle: script.principle
  };
}
