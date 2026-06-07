import type {
  GuardrailCheckRequest,
  GuardrailCheckResponse
} from "../../../types/care-workflow";
import { postJson } from "../shared/http";

export async function checkGuardrailCloud(
  request: GuardrailCheckRequest
): Promise<GuardrailCheckResponse> {
  return postJson<GuardrailCheckResponse>("/api/guardrail/check", request);
}
