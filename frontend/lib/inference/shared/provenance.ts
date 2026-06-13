export type InferenceProvenanceSource =
  | "native_litertlm_success"
  | "native_litertlm_parse_fallback"
  | "rule_local_fallback"
  | "local_fallback"
  | "deterministic_local_fallback"
  | "cloud_26b"
  | "cloud_31b"
  | "stub_debug"
  | "demo_mock"
  | "manual_draft"
  | "unavailable";

export interface InferenceProvenance {
  source: InferenceProvenanceSource;
  task: "daily_log" | "communication" | "follow_up_summary" | "followup_document" | "guardrail" | "audio";
  modelId: string;
  backend: string;
  latencyMs: number;
  engineInitialized: boolean;
  nativeGenerateAttempted: boolean;
  nativeGenerateReturned: boolean;
  rawOutputLength: number;
  rawOutputHash: string | null;
  parseSucceeded: boolean;
  fallbackReason: string | null;
}

export function hashInferenceOutput(text: string): string | null {
  if (!text) return null;

  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sourceLabel(source: InferenceProvenanceSource): string {
  switch (source) {
    case "native_litertlm_success":
      return "Gemma local model ran";
    case "native_litertlm_parse_fallback":
      return "native output parse failed, rule fallback used";
    case "rule_local_fallback":
      return "local rules fallback used";
    case "local_fallback":
    case "deterministic_local_fallback":
      return "local model did not run, fallback used";
    case "cloud_26b":
      return "cloud 26B model ran";
    case "cloud_31b":
      return "cloud 31B model ran";
    case "stub_debug":
      return "stub/demo output";
    case "manual_draft":
      return "manual draft";
    case "unavailable":
      return "local model unavailable";
    case "demo_mock":
      return "demo/mock output";
    default:
      return source;
  }
}
