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
  const startedAt = Date.now();
  const response = await postJson<CareWorkflowResponse>("/api/care-workflow", request);
  const inferenceProvenance = {
    source: "cloud_26b" as const,
    task: "daily_log" as const,
    modelId: "cloud_26b",
    backend: "cloud",
    latencyMs: Date.now() - startedAt,
    engineInitialized: true,
    nativeGenerateAttempted: false,
    nativeGenerateReturned: false,
    rawOutputLength: 0,
    rawOutputHash: null,
    parseSucceeded: true,
    fallbackReason: null
  };
  const enrichedResponse = {
    ...response,
    inference_provenance: response.inference_provenance ?? inferenceProvenance
  };

  return {
    response: enrichedResponse,
    structuredLog: enrichedResponse.structured_log ? mapStructuredLog(enrichedResponse.structured_log) : null,
    attentionItems: enrichedResponse.attention_items.map(mapAttentionItem),
    memoryItems: enrichedResponse.memory_candidates.map((item) =>
      mapMemoryCandidate(item, enrichedResponse.patient_id)
    ),
    scriptAdvice: enrichedResponse.communication_script
      ? mapScriptAdvice(enrichedResponse.communication_script)
      : null,
    inferenceProvenance
  };
}
