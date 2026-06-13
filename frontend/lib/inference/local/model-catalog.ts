// Lightweight catalog client — fetches /api/models from the CareMind
// backend and caches the result for a short window. This is what the
// PrivacyModeCard renders as a picker, and what model-manager looks up
// to know the filename / size of the currently selected model.

import { buildModelCatalogUrl } from "./constants";
import { buildApiUrl } from "../shared/http";
import { Platform } from "react-native";
import { TRACK_C_OFFLINE_DEMO } from "../track-c-demo";

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
  /** "litertlm" | "task" | "gguf". */
  format: string;
  /** Supported platforms. Older backend entries may omit this and are treated as Android-only. */
  platforms?: Array<"android" | "ios" | "web">;
  /** Native runtime expected for this model. */
  runtime?: "mediapipe-llm" | "litert" | "litert-lm" | "llama.cpp" | "stub";
  checksum_sha256?: string;
  min_ios?: string;
  min_device_memory_gb?: number;
  recommended?: boolean;
  /** Server-side download path, e.g. "/api/models/foo.litertlm". */
  download_path: string;
  /** Metadata endpoint that returns a short-lived direct download URL. */
  download_info_path?: string;
  /** Backend delivery strategy. Large files should be gcs-signed-url or remote-direct, not proxy. */
  delivery?: "gcs-signed-url" | "remote-direct" | "backend-local" | "gcs-proxy" | "remote-proxy";
  modified_at: string;
}

export interface ModelCatalog {
  models: ModelCatalogEntry[];
  model_dir: string;
}

export interface ModelDownloadInfo {
  model_id: string;
  filename: string;
  download_url: string;
  url_host?: string;
  source?: string;
  status?: string;
  status_code?: number;
  size_bytes?: number;
  checksum_sha256?: string | null;
  expires_at?: string | null;
  requires_auth?: boolean;
  via_backend_proxy?: boolean;
}

let cache: ModelCatalog | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000;
const ANDROID_FALLBACK_CATALOG: ModelCatalog = {
  model_dir: "builtin",
  models: [
    {
      id: "gemma-4-E2B-it.litertlm",
      filename: "gemma-4-E2B-it.litertlm",
      display_name: "Gemma 4 E2B",
      description: "比赛推荐的 Android 端侧模型。通过 CareMind 后端下载，避免手机直连 Hugging Face；Debug 构建会优先读取 /data/local/tmp/llm/gemma.litertlm。",
      supports_audio: false,
      tier: "medium",
      size_bytes: 2_588_147_712,
      format: "litertlm",
      platforms: ["android"],
      runtime: "litert-lm",
      checksum_sha256: "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c",
      recommended: true,
      download_path: "/api/models/gemma-4-E2B-it.litertlm",
      download_info_path: "/api/models/gemma-4-E2B-it.litertlm/download-info",
      delivery: "gcs-signed-url",
      modified_at: "fallback"
    }
  ]
};

const IOS_FALLBACK_CATALOG: ModelCatalog = {
  model_dir: "builtin-ios",
  models: [
    {
      id: "gemma-4-E2B-it.litertlm",
      filename: "gemma-4-E2B-it.litertlm",
      display_name: "Gemma 4 E2B",
      description: "比赛推荐的 iPhone 端侧模型（约 2.58 GB）。使用 LiteRT-LM Swift runtime 本地处理照护记录；语音暂不走本地模型。",
      supports_audio: false,
      tier: "medium",
      size_bytes: 2_588_147_712,
      format: "litertlm",
      platforms: ["ios"],
      runtime: "litert-lm",
      min_ios: "16.0",
      min_device_memory_gb: 6,
      checksum_sha256: "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c",
      recommended: true,
      download_path: "/api/models/gemma-4-E2B-it.litertlm",
      download_info_path: "/api/models/gemma-4-E2B-it.litertlm/download-info",
      delivery: "gcs-signed-url",
      modified_at: "fallback"
    }
  ]
};

function fallbackCatalogForCurrentPlatform(): ModelCatalog {
  return Platform.OS === "ios" ? IOS_FALLBACK_CATALOG : ANDROID_FALLBACK_CATALOG;
}

function supportsCurrentPlatform(entry: ModelCatalogEntry): boolean {
  if (Platform.OS === "ios") {
    return entry.platforms?.includes("ios") ?? false;
  }
  if (Platform.OS === "android") {
    return entry.platforms?.includes("android") ?? !entry.platforms;
  }
  return entry.platforms?.includes("web") ?? false;
}

function withPlatformFallback(models: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const supported = models.filter(supportsCurrentPlatform);
  const fallback = fallbackCatalogForCurrentPlatform().models;
  if (supported.length === 0) return fallback;

  const existing = new Set(supported.map((entry) => entry.id));
  const missingRecommended = fallback.filter((entry) => entry.recommended && !existing.has(entry.id));
  return [...supported, ...missingRecommended];
}

/** Fetch the model catalog from the backend. Cached for ~60 s. */
export async function fetchModelCatalog(force = false): Promise<ModelCatalog> {
  if (TRACK_C_OFFLINE_DEMO) {
    cache = fallbackCatalogForCurrentPlatform();
    cacheTime = Date.now();
    return cache;
  }

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
      models: models.length > 0 ? withPlatformFallback(models) : fallbackCatalogForCurrentPlatform().models,
      model_dir: payload.model_dir ?? ""
    };
    cacheTime = Date.now();
    return cache;
  } catch (error) {
    if (cache) return cache; // Stale-but-usable on network errors.
    console.warn("[model-catalog] using fallback catalog", error);
    cache = fallbackCatalogForCurrentPlatform();
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
    const filename = entry.filename || entry.id;
    if (/^https?:\/\/([^/]+\.)?huggingface\.co\//i.test(entry.download_path) && filename) {
      return buildApiUrl(`/api/models/${encodeURIComponent(filename)}`);
    }
    return entry.download_path;
  }
  const path = entry.download_path.startsWith("/") ? entry.download_path : `/${entry.download_path}`;
  return buildApiUrl(path);
}

function resolveDownloadInfoUrl(entry: ModelCatalogEntry): string {
  const path = entry.download_info_path ?? `/api/models/${encodeURIComponent(entry.filename || entry.id)}/download-info`;
  if (/^https?:\/\//i.test(path)) return path;
  return buildApiUrl(path.startsWith("/") ? path : `/${path}`);
}

function resolveDirectOrApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return buildApiUrl(url.startsWith("/") ? url : `/${url}`);
}

export function safeUrlHost(url: string): string {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "unknown";
  }
}

export async function resolveModelDownloadInfo(entry: ModelCatalogEntry): Promise<ModelDownloadInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(resolveDownloadInfoUrl(entry), { signal: controller.signal });
    if (!response.ok) {
      let detail = "";
      try {
        const payload = (await response.json()) as { detail?: string };
        detail = payload.detail ? `：${payload.detail}` : "";
      } catch {
        detail = "";
      }
      throw new Error(`模型下载准备失败：服务器返回 ${response.status}${detail}`);
    }
    const payload = (await response.json()) as ModelDownloadInfo;
    return {
      ...payload,
      download_url: resolveDirectOrApiUrl(payload.download_url),
      size_bytes: payload.size_bytes ?? entry.size_bytes,
      checksum_sha256: payload.checksum_sha256 ?? entry.checksum_sha256 ?? null
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("模型下载准备超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
