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
