import type {
  FollowupSummaryRequest,
  FollowupSummaryResponse
} from "../../../types/care-workflow";
import { postJson } from "../shared/http";
import { toAttentionItemV2 } from "../shared/v2-mappers";
import type { FollowupSummaryInput } from "../shared/types";

export async function generateFollowupSummaryCloud(
  input: FollowupSummaryInput
): Promise<FollowupSummaryResponse> {
  const startedAt = Date.now();
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
      reviewed_at: item.reviewedAt ?? null,
      parse_quality: item.parseResult?.parse_quality ?? null,
      doctor_review_needed: item.parseResult?.doctor_review_needed ?? false,
      medical_term_candidates: item.parseResult?.medical_term_candidates?.map((candidate) => candidate.term) ?? [],
      safety_flags: item.parseResult?.safety_flags ?? []
    })),
    care_logs: input.careLogs ?? [],
    daily_metrics: input.dailyMetrics ?? [],
    caregiver_daily_metrics_trend: input.caregiverDailyMetricsTrend ?? {},
    document_images: input.documentImages ?? [],
    include_english_key_phrases: input.includeEnglishKeyPhrases ?? false,
    cloud_summary_allowed: input.cloudSummaryAllowed ?? true,
    raw_text_upload_allowed: input.rawTextUploadAllowed ?? true,
    full_window_required: input.fullWindowRequired ?? true,
    timezone: input.timezone ?? "Asia/Shanghai"
  };

  const response = await postJson<FollowupSummaryResponse>("/api/reports/follow-up", request);
  return {
    ...response,
    inference_provenance: response.inference_provenance ?? {
      source: "cloud_31b",
      task: "follow_up_summary",
      modelId: response.model_profile || "cloud_31b_long_context",
      backend: "cloud",
      latencyMs: Date.now() - startedAt,
      engineInitialized: true,
      nativeGenerateAttempted: false,
      nativeGenerateReturned: false,
      rawOutputLength: 0,
      rawOutputHash: null,
      parseSucceeded: true,
      fallbackReason: null
    }
  };
}
