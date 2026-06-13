// Public facade for the frontend's inference + document APIs. The 4
// AI-routed functions (runCareWorkflow / checkGuardrail /
// generateFollowupSummary / transcribeAudioNote) are re-exported from the
// inference router so call sites do not need to know whether the call lands
// on the cloud backend or on-device Gemma.
//
// Document-related functions stay here. In Track C offline demo mode these
// helpers refuse to call the backend; the UI stores a local manual summary
// instead of uploading or parsing files.

import { buildApiUrl, readableApiError } from "./inference/shared/http";
import { isPrivacyMode } from "./inference/privacy-mode";
import { TRACK_C_OFFLINE_DEMO } from "./inference/track-c-demo";

export {
  runCareWorkflow,
  checkGuardrail,
  generateFollowupSummary,
  transcribeAudioNote,
  getInferenceRoutingDecision
} from "./inference/inference-router";

export type {
  CareWorkflowAppResult,
  FollowupSummaryInput,
  TranscribeAudioNoteInput,
  AudioTranscriptionResponse,
  CareMindIntent,
  LocalFirstPrivacyConfig,
  MobileModelAvailability,
  ModelProfile,
  RoutingDecision,
  RuntimeInitializationStatus
} from "./inference/shared/types";

export type MedicalDocumentStatus =
  | "uploaded"
  | "parsing"
  | "review_required"
  | "reviewed"
  | "parse_failed"
  | "deleted";

export type DocumentParseConfidence = "low" | "medium" | "high";
export type DocumentParseSource =
  | "filename"
  | "user_summary"
  | "document_type"
  | "system_template"
  | "multimodal_model"
  | "manual_fallback"
  | "file_quality";
export type DocumentParseQuality = "readable" | "partially_readable" | "unreadable" | "unsupported";

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

export interface DocumentMedicalTermCandidate {
  term: string;
  original_text: string;
  family_explanation: string;
  confidence: DocumentParseConfidence;
  requires_confirmation: boolean;
}

export interface DocumentParseResult {
  document_id: string;
  status: "review_required" | "parse_failed";
  extracted_fields: DocumentParseField[];
  review_questions: DocumentReviewQuestion[];
  followup_summary_items: string[];
  medical_boundary: string;
  parse_quality: DocumentParseQuality;
  doctor_review_needed: boolean;
  medical_term_candidates: DocumentMedicalTermCandidate[];
  safety_flags: string[];
  model_profile: string;
  multimodal_attempted: boolean;
  requires_family_confirmation: boolean;
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
  userConfirmedCloudUpload?: boolean;
  asset: {
    uri: string;
    name: string;
    mimeType?: string | null;
  };
}

export interface ParseMedicalDocumentOptions {
  userConfirmedCloudParse?: boolean;
}

export class PrivacyUploadBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyUploadBlockedError";
  }
}

async function assertCloudDocumentProcessingAllowed(confirmed: boolean | undefined, action: "upload" | "parse") {
  if (TRACK_C_OFFLINE_DEMO) {
    throw new PrivacyUploadBlockedError(
      action === "upload"
        ? "Track C 离线 demo 模式已开启：资料不会上传云端，请保存本地文件和手动摘要。"
        : "Track C 离线 demo 模式已开启：资料不会云端解析，请使用手动摘要。"
    );
  }

  const localFirst = await isPrivacyMode();
  if (!localFirst || confirmed === true) {
    return {
      localFirst,
      consent: localFirst ? "explicit" : "standard"
    };
  }

  throw new PrivacyUploadBlockedError(
    action === "upload"
      ? "本地优先模式已开启。上传资料前需要你明确同意本次云端处理。"
      : "本地优先模式已开启。整理云端资料前需要你明确同意本次云端处理。"
  );
}

export async function uploadMedicalDocument(
  input: UploadMedicalDocumentInput
): Promise<MedicalDocumentRecord> {
  const policy = await assertCloudDocumentProcessingAllowed(input.userConfirmedCloudUpload, "upload");
  const formData = new FormData();
  formData.append("patient_id", input.patientId);
  formData.append("document_type", input.documentType);
  formData.append("summary", input.summary ?? "");
  formData.append("file", {
    uri: input.asset.uri,
    name: input.asset.name,
    type: input.asset.mimeType ?? "application/octet-stream"
  } as unknown as Blob);

  const response = await fetch(buildApiUrl("/api/documents/upload"), {
    method: "POST",
    headers: {
      "X-CareMind-Local-First": String(policy.localFirst),
      "X-CareMind-Cloud-Consent": policy.consent
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料上传失败"));
  }

  return (await response.json()) as MedicalDocumentRecord;
}

export async function getMedicalDocument(documentId: string): Promise<MedicalDocumentRecord> {
  if (TRACK_C_OFFLINE_DEMO) {
    throw new PrivacyUploadBlockedError("Track C 离线 demo 模式不会查询云端资料状态。");
  }

  const response = await fetch(buildApiUrl(`/api/documents/${documentId}`));
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料状态查询失败"));
  }
  return (await response.json()) as MedicalDocumentRecord;
}

export async function parseMedicalDocument(
  documentId: string,
  options: ParseMedicalDocumentOptions = {}
): Promise<DocumentParseResult> {
  const policy = await assertCloudDocumentProcessingAllowed(options.userConfirmedCloudParse, "parse");
  const response = await fetch(buildApiUrl(`/api/documents/${documentId}/parse`), {
    method: "POST",
    headers: {
      "X-CareMind-Local-First": String(policy.localFirst),
      "X-CareMind-Cloud-Consent": policy.consent
    }
  });
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料整理失败"));
  }
  return (await response.json()) as DocumentParseResult;
}

export async function confirmMedicalDocumentReview(
  input: ConfirmDocumentReviewInput
): Promise<ConfirmDocumentReviewResponse> {
  if (TRACK_C_OFFLINE_DEMO) {
    throw new PrivacyUploadBlockedError("Track C 离线 demo 模式不会向云端确认资料。");
  }

  const response = await fetch(buildApiUrl(`/api/documents/${input.documentId}/review`), {
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
  if (TRACK_C_OFFLINE_DEMO) {
    throw new PrivacyUploadBlockedError("Track C 离线 demo 模式不会向云端删除资料。");
  }

  const response = await fetch(buildApiUrl(`/api/documents/${documentId}`), {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料删除失败"));
  }
}
