// Public facade for the frontend's inference + document APIs. The 4
// AI-routed functions (runCareWorkflow / checkGuardrail /
// generateFollowupSummary / transcribeAudioNote) are re-exported from the
// inference router so call sites do not need to know whether the call lands
// on the cloud backend or on-device Gemma.
//
// Document-related functions stay here — they are cloud-only by design
// (file storage and parsing happen server-side; nothing the on-device model
// can replace).

import { buildApiUrl, readableApiError } from "./inference/shared/http";

export {
  runCareWorkflow,
  checkGuardrail,
  generateFollowupSummary,
  transcribeAudioNote
} from "./inference/inference-router";

export type {
  CareWorkflowAppResult,
  FollowupSummaryInput,
  TranscribeAudioNoteInput,
  AudioTranscriptionResponse
} from "./inference/shared/types";

export type MedicalDocumentStatus =
  | "uploaded"
  | "parsing"
  | "review_required"
  | "reviewed"
  | "parse_failed"
  | "deleted";

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

export async function uploadMedicalDocument(
  input: UploadMedicalDocumentInput
): Promise<MedicalDocumentRecord> {
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
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料上传失败"));
  }

  return (await response.json()) as MedicalDocumentRecord;
}

export async function getMedicalDocument(documentId: string): Promise<MedicalDocumentRecord> {
  const response = await fetch(buildApiUrl(`/api/documents/${documentId}`));
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料状态查询失败"));
  }
  return (await response.json()) as MedicalDocumentRecord;
}

export async function parseMedicalDocument(documentId: string): Promise<DocumentParseResult> {
  const response = await fetch(buildApiUrl(`/api/documents/${documentId}/parse`), {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料整理失败"));
  }
  return (await response.json()) as DocumentParseResult;
}

export async function confirmMedicalDocumentReview(
  input: ConfirmDocumentReviewInput
): Promise<ConfirmDocumentReviewResponse> {
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
  const response = await fetch(buildApiUrl(`/api/documents/${documentId}`), {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await readableApiError(response, "资料删除失败"));
  }
}
