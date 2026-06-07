// Fire-and-forget telemetry ping sent after each on-device inference. The
// purpose is purely so a developer running the backend can SEE that local
// inference happened (otherwise the backend goes silent in privacy mode).
//
// Privacy contract — NEVER send:
//   - user notes / prompts / source text
//   - model output text
//   - audio bytes or transcripts
// Only counts (chars), durations (ms), task name and model id leave the device.
// The endpoint on the backend additionally rejects oversized strings.

import { buildApiUrl } from "../shared/http";

const TELEMETRY_TIMEOUT_MS = 4_000;

export type OnDeviceTask = "care_workflow" | "guardrail" | "followup" | "audio";

export interface OnDeviceTelemetry {
  task: OnDeviceTask;
  modelId: string;
  success: boolean;
  elapsedMs: number;
  /** Character length of the prompt that went into the model, not the prompt. */
  inputChars?: number;
  /** Character length of the generated response, not the response. */
  outputChars?: number;
  /** True when the local adapter's deterministic fallback was used. */
  fellBack?: boolean;
  /** Short error tag, e.g. "json_parse_failed". Truncated to 64 chars. */
  errorKind?: string;
}

/** Best-effort ping. Never throws — errors are swallowed and logged only. */
export async function reportOnDeviceInference(t: OnDeviceTelemetry): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);

  const body = {
    task: t.task,
    model_id: t.modelId.slice(0, 128),
    success: !!t.success,
    elapsed_ms: Math.max(0, Math.floor(t.elapsedMs)),
    input_chars: Math.max(0, Math.floor(t.inputChars ?? 0)),
    output_chars: Math.max(0, Math.floor(t.outputChars ?? 0)),
    fell_back: !!t.fellBack,
    error_kind: t.errorKind ? t.errorKind.slice(0, 64) : null
  };

  try {
    const response = await fetch(buildApiUrl("/api/telemetry/ondevice"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      // Best-effort, no retry. Tighten verbosity to a single line.
      console.warn(`[telemetry] HTTP ${response.status}`);
    }
  } catch (error) {
    // Likely offline — that's fine, this is best-effort.
    if (error instanceof Error && error.name !== "AbortError") {
      console.warn("[telemetry] failed", error.message);
    }
  } finally {
    clearTimeout(timer);
  }
}
