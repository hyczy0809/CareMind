// Single source of truth for on-device model configuration. The actual list
// of available models is fetched at runtime from the backend's /api/models
// endpoint (so adding a new model is a backend-only change), but a few
// constants here cover URLs, defaults, and inference knobs.

import { buildApiUrl } from "../shared/http";

export function buildModelCatalogUrl(): string {
  return buildApiUrl("/api/models");
}

/** Build the download URL for a specific model file name. */
export function buildModelDownloadUrl(filename: string): string {
  return buildApiUrl(`/api/models/${encodeURIComponent(filename)}`);
}

/** Build the metadata-only URL for a specific model file name. */
export function buildModelMetaUrl(filename: string): string {
  return buildApiUrl(`/api/models/${encodeURIComponent(filename)}/meta`);
}

// Fallback model filename when the catalog has not been fetched yet.
// Android debug builds still prefer /data/local/tmp/llm/gemma.litertlm when
// any .litertlm filename is selected, so we can validate Gemma 4 E2B without
// bundling the model into the APK. Keep this ID aligned with the backend
// /api/models registry so release builds never fall back to Hugging Face.
export const DEFAULT_MODEL_FILENAME = "gemma-4-E2B-it.litertlm";

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Inference knobs. Keep generated output modest — the model can blow past the
// JSON/XML schema if it runs free, especially on the smaller 1B variant.
export const DEFAULT_MAX_TOKENS = 768;
export const DEFAULT_CONTEXT_TOKENS = readPositiveInt(
  process.env.EXPO_PUBLIC_LOCAL_CONTEXT_TOKENS,
  2048
);
export const GEMMA4_E2B_CONTEXT_TOKENS = readPositiveInt(
  process.env.EXPO_PUBLIC_GEMMA4_E2B_CONTEXT_TOKENS,
  4096
);
export const TRANSCRIPTION_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.4;
export const DEFAULT_TOP_K = 40;

export function defaultContextTokensForModel(filename: string): number {
  return filename.toLowerCase().includes("gemma-4-e2b")
    ? GEMMA4_E2B_CONTEXT_TOKENS
    : DEFAULT_CONTEXT_TOKENS;
}
