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

// Fallback model filename when the catalog has not been fetched yet — kept
// in sync with the legacy /api/models/gemma alias on the backend so first
// launches of older code paths still work.
export const DEFAULT_MODEL_FILENAME = "Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm";

// Inference knobs. Keep modest — the model can blow past the JSON schema if
// it runs free, especially on the smaller 1B variant.
export const DEFAULT_MAX_TOKENS = 768;
export const TRANSCRIPTION_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.4;
export const DEFAULT_TOP_K = 40;
