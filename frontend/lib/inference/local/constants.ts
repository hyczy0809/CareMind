// Single source of truth for on-device model configuration. The actual list
// of available models is fetched at runtime from the backend's /api/models
// endpoint (so adding a new model is a backend-only change), but a few
// constants here cover URLs, defaults, and inference knobs.

// Base URL of the CareMind backend. Same env var used by the cloud-side
// HTTP helper, with a safe default for the dev case where adb reverse maps
// the phone's 127.0.0.1:8090 to the laptop's backend.
const API_BASE =
  process.env.EXPO_PUBLIC_CAREMIND_API_URL ?? "http://127.0.0.1:8090";

export const MODEL_CATALOG_URL = `${API_BASE}/api/models`;

/** Build the download URL for a specific model file name. */
export function buildModelDownloadUrl(filename: string): string {
  return `${API_BASE}/api/models/${encodeURIComponent(filename)}`;
}

/** Build the metadata-only URL for a specific model file name. */
export function buildModelMetaUrl(filename: string): string {
  return `${API_BASE}/api/models/${encodeURIComponent(filename)}/meta`;
}

// Fallback model filename when the catalog has not been fetched yet — kept
// in sync with the legacy /api/models/gemma alias on the backend so first
// launches of older code paths still work.
export const DEFAULT_MODEL_FILENAME = "gemma-4-E4B-it.litertlm";

// Inference knobs. Keep modest — the model can blow past the JSON schema if
// it runs free, especially on the smaller 1B variant.
export const DEFAULT_MAX_TOKENS = 1024;
export const TRANSCRIPTION_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.4;
export const DEFAULT_TOP_K = 40;
