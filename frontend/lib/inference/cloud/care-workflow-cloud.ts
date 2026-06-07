import type {
  CareWorkflowRequest,
  CareWorkflowResponse
} from "../../../types/care-workflow";
import {
  mapAttentionItem,
  mapMemoryCandidate,
  mapScriptAdvice,
  mapStructuredLog
} from "../shared/v2-mappers";
import { postJson } from "../shared/http";
import type { CareWorkflowAppResult } from "../shared/types";

export async function runCareWorkflowCloud(
  request: CareWorkflowRequest
): Promise<CareWorkflowAppResult> {
  const response = await postJson<CareWorkflowResponse>("/api/care-workflow", request);

  return {
    response,
    structuredLog: response.structured_log ? mapStructuredLog(response.structured_log) : null,
    attentionItems: response.attention_items.map(mapAttentionItem),
    memoryItems: response.memory_candidates.map((item) =>
      mapMemoryCandidate(item, response.patient_id)
    ),
    scriptAdvice: response.communication_script
      ? mapScriptAdvice(response.communication_script)
      : null
  };
}
