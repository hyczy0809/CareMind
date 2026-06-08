// Lightweight catalog client — fetches /api/models from the CareMind
// backend and caches the result for a short window. This is what the
// PrivacyModeCard renders as a picker, and what model-manager looks up
// to know the filename / size of the currently selected model.

import { buildModelCatalogUrl } from "./constants";
import { buildApiUrl } from "../shared/http";

export interface ModelCatalogEntry {
  /** Stable identifier == the filename. */
  id: string;
  filename: string;
  /** Human-readable name shown in the picker (e.g. "Gemma 3 1B"). */
  display_name: string;
  /** One-line description shown under the name. */
  description: string;
  /** True only when a model/native path supports direct audio input. */
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
const FALLBACK_CATALOG: ModelCatalog = {
  model_dir: "builtin",
  models: [
    {
      id: "Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm",
      filename: "Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm",
      display_name: "Gemma 3 1B",
      description: "推荐端侧演示模型（~560 MB）。适合中端机，速度快；语音当前先由系统转成可编辑文本。",
      supports_audio: false,
      tier: "light",
      size_bytes: 584417280,
      format: "litertlm",
      download_path: "/api/models/Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm",
      modified_at: "fallback"
    }
  ]
};

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
    const models = Array.isArray(payload.models) ? payload.models : [];
    cache = {
      models: models.length > 0 ? models : FALLBACK_CATALOG.models,
      model_dir: payload.model_dir ?? ""
    };
    cacheTime = Date.now();
    return cache;
  } catch (error) {
    if (cache) return cache; // Stale-but-usable on network errors.
    console.warn("[model-catalog] using fallback catalog", error);
    cache = FALLBACK_CATALOG;
    cacheTime = Date.now();
    return cache;
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

export function resolveModelDownloadUrl(entry: ModelCatalogEntry): string {
  if (/^https?:\/\//i.test(entry.download_path)) {
    return entry.download_path;
  }
  const path = entry.download_path.startsWith("/") ? entry.download_path : `/${entry.download_path}`;
  return buildApiUrl(path);
}
