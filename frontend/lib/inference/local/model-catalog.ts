// Lightweight catalog client — fetches /api/models from the CareMind
// backend and caches the result for a short window. This is what the
// PrivacyModeCard renders as a picker, and what model-manager looks up
// to know the filename / size of the currently selected model.

import { buildModelCatalogUrl } from "./constants";

export interface ModelCatalogEntry {
  /** Stable identifier == the filename. */
  id: string;
  filename: string;
  /** Human-readable name shown in the picker (e.g. "Gemma 4 E2B"). */
  display_name: string;
  /** One-line description shown under the name. */
  description: string;
  /** True for multimodal models (audio input supported). */
  supports_audio: boolean;
  /** "light" | "medium" | "full" | "unknown". Used for badge colour. */
  tier: string;
  size_bytes: number;
  /** "litertlm" | "task". */
  format: string;
  /** Server-side download path, e.g. "/api/models/foo.litertlm". */
  download_path: string;
  modified_at: string;
}

export interface ModelCatalog {
  models: ModelCatalogEntry[];
  model_dir: string;
}

let cache: ModelCatalog | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000;

/** Fetch the model catalog from the backend. Cached for ~60 s. */
export async function fetchModelCatalog(force = false): Promise<ModelCatalog> {
  if (!force && cache && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(buildModelCatalogUrl(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`catalog HTTP ${response.status}`);
    }
    const payload = (await response.json()) as ModelCatalog;
    cache = {
      models: Array.isArray(payload.models) ? payload.models : [],
      model_dir: payload.model_dir ?? ""
    };
    cacheTime = Date.now();
    return cache;
  } catch (error) {
    if (cache) return cache; // Stale-but-usable on network errors.
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Look up a single model entry by filename — convenience around the catalog. */
export async function findModelById(modelId: string): Promise<ModelCatalogEntry | null> {
  try {
    const catalog = await fetchModelCatalog();
    return catalog.models.find((entry) => entry.id === modelId) ?? null;
  } catch {
    return null;
  }
}

/** Drop the in-memory cache; mainly useful for the dev "refresh" affordance. */
export function clearCatalogCache(): void {
  cache = null;
  cacheTime = 0;
}
