// Higher-level model lifecycle around the native module. Maintains
// **per-filename** state so the PrivacyModeCard can show each model's
// own download / ready / error progress independently.
//
// Owns the small state machine that the settings UI watches:
//   absent → downloading → ready → error
// Plus convenience hooks. Keeps all native-side error / progress plumbing
// out of the React components.

import { useEffect, useState } from "react";
import {
  buildModelDownloadUrl,
  defaultContextTokensForModel,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_FILENAME,
  DEFAULT_TOP_K
} from "./constants";
import { Gemma, GEMMA_NATIVE_AVAILABLE, subscribeDownloadProgress } from "./gemma-native";
import type { GemmaEngineOptions } from "./gemma-native";
import { hashInferenceOutput } from "../shared/provenance";
import { TRACK_C_OFFLINE_DEMO } from "../track-c-demo";
import {
  fetchModelCatalog,
  findModelById,
  resolveModelDownloadInfo,
  resolveModelDownloadUrl,
  safeUrlHost,
  type ModelCatalogEntry
} from "./model-catalog";
import {
  getSelectedModelIdSync,
  subscribeSelectedModelId,
  setSelectedModelId
} from "../privacy-mode";

export type ModelStatus =
  | "unsupported"
  | "not_downloaded"
  | "downloading"
  | "download_failed"
  | "downloaded"
  | "validating"
  | "validation_failed"
  | "initializing"
  | "ready"
  | "runtime_failed";

export interface ModelSmokeResult {
  passed: boolean;
  source: "native_litertlm_success" | "stub_debug" | "unavailable";
  modelId: string;
  backend: string;
  latencyMs: number;
  nativeGenerateAttempted: boolean;
  nativeGenerateReturned: boolean;
  rawOutputLength: number;
  rawOutputHash: string | null;
  errorMessage?: string | null;
}

export interface PerModelState {
  filename: string;
  status: ModelStatus;
  progress: number; // 0..1
  bytesDownloaded: number;
  totalBytes: number;
  errorMessage: string | null;
  localUri?: string | null;
  fileSize?: number;
  downloadedAt?: string | null;
  validationStatus?: "not_run" | "passed" | "failed";
  validationMessage?: string | null;
  runtimeStatus?: "not_run" | "initializing" | "ready" | "failed";
  runtimeBackend?: string | null;
  smokeTest?: ModelSmokeResult | null;
}

function normalizeDownloadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  const statusMatch = raw.match(/\bhttp\s*(\d{3})\b/i) ?? raw.match(/服务器返回\s*(\d{3})/);
  const status = statusMatch?.[1];
  if (status === "500") {
    return "模型下载失败：服务器返回 500。请稍后重试，或让我们检查后端模型下载配置。";
  }
  if (status === "401" || status === "403" || lower.includes("auth") || lower.includes("token") || raw.includes("鉴权")) {
    return "模型下载失败：模型源鉴权或许可未通过。请确认模型已同步到 CareMind 存储，且后端 token/权限配置正确。";
  }
  if (status === "404" || raw.includes("未找到") || lower.includes("not found")) {
    return "模型下载失败：模型文件不存在。请确认后端模型目录或 Cloud Storage 对象已上传。";
  }
  if (raw.includes("空间不足") || lower.includes("no space") || lower.includes("enospc") || lower.includes("disk")) {
    return raw;
  }
  if (raw.includes("超时") || lower.includes("timeout") || lower.includes("timed out")) {
    return "模型下载超时：网络不稳定或文件过大，请保持网络连接后重试。";
  }
  if (raw.includes("校验失败") || raw.includes("未完成") || raw.includes("大小不完整") || lower.includes("corrupt") || lower.includes("checksum")) {
    return "模型下载不完整或校验失败：已保留可续传的临时文件，请重新点击下载。";
  }
  return raw;
}

export interface ManagerState {
  /** True when the global stub mode flag is on (dev only). */
  stub: boolean;
  /** Per-filename rows. */
  byModel: Record<string, PerModelState>;
  /** Currently selected model id, if any. */
  selectedModelId: string | null;
}

function emptyEntry(filename: string): PerModelState {
  return {
    filename,
    status: GEMMA_NATIVE_AVAILABLE ? "not_downloaded" : "unsupported",
    progress: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
    errorMessage: null,
    localUri: null,
    downloadedAt: null,
    validationStatus: "not_run",
    validationMessage: null,
    runtimeStatus: "not_run",
    runtimeBackend: null,
    smokeTest: null
  };
}

let state: ManagerState = {
  stub: false,
  byModel: {},
  selectedModelId: getSelectedModelIdSync()
};
const subs = new Set<(s: ManagerState) => void>();
let engineReadyKey: string | null = null;
let engineInitPromise: Promise<string> | null = null;

function preferredModelId(catalog: ModelCatalogEntry[]): string | null {
  return (
    catalog.find((entry) => entry.id === DEFAULT_MODEL_FILENAME)?.id ??
    catalog.find((entry) => entry.tier === "light")?.id ??
    catalog[0]?.id ??
    null
  );
}

function emit() {
  for (const sub of subs) {
    try {
      sub(state);
    } catch (error) {
      console.warn("model-manager subscriber threw", error);
    }
  }
}

function patchEntry(filename: string, next: Partial<PerModelState>) {
  const existing = state.byModel[filename] ?? emptyEntry(filename);
  state = {
    ...state,
    byModel: {
      ...state.byModel,
      [filename]: { ...existing, ...next, filename }
    }
  };
  emit();
}

function patchManager(next: Partial<ManagerState>) {
  state = { ...state, ...next };
  emit();
}

export function getManagerState(): ManagerState {
  return state;
}

export function getModelEntry(filename: string): PerModelState {
  return state.byModel[filename] ?? emptyEntry(filename);
}

function normalizeEngineOptions(filename: string, options: GemmaEngineOptions = {}): Required<GemmaEngineOptions> {
  return {
    backend: options.backend ?? "AUTO",
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    contextTokens: options.contextTokens ?? defaultContextTokensForModel(filename)
  };
}

function makeEngineKey(filename: string, options: Required<GemmaEngineOptions>): string {
  return `${filename}|${options.backend}|${options.maxTokens}|${options.contextTokens}`;
}

async function catalogEntryFor(filename: string): Promise<ModelCatalogEntry | null> {
  return findModelById(filename).catch(() => null);
}

async function validateModelOnDisk(filename: string, options: { preserveReady?: boolean } = {}): Promise<boolean> {
  const catalogEntry = await catalogEntryFor(filename);
  const previous = getModelEntry(filename);
  patchEntry(filename, {
    status: "validating",
    errorMessage: null,
    validationStatus: "not_run",
    validationMessage: null,
    runtimeStatus: "not_run",
    smokeTest: null
  });

  const validation = await Gemma.validateModelFile(
    filename,
    catalogEntry?.size_bytes,
    catalogEntry?.checksum_sha256
  );

  if (!validation.ok) {
    const message = validation.reason || "model_validation_failed";
    patchEntry(filename, {
      status: validation.exists ? "validation_failed" : "not_downloaded",
      localUri: validation.path,
      fileSize: validation.bytes,
      bytesDownloaded: validation.bytes,
      totalBytes: catalogEntry?.size_bytes ?? validation.bytes,
      progress: validation.exists && catalogEntry?.size_bytes ? Math.min(1, validation.bytes / catalogEntry.size_bytes) : 0,
      validationStatus: "failed",
      validationMessage: message,
      errorMessage: validation.exists
        ? `模型文件校验失败：${message}`
        : "本地模型未下载。请先下载或导入 Gemma 4 E2B/E4B。"
    });
    return false;
  }

  const keepReady = options.preserveReady && previous.status === "ready" && previous.smokeTest?.passed === true;
  patchEntry(filename, {
    status: keepReady ? "ready" : "downloaded",
    localUri: validation.path,
    fileSize: validation.bytes,
    bytesDownloaded: validation.bytes,
    totalBytes: catalogEntry?.size_bytes ?? validation.bytes,
    progress: 1,
    validationStatus: "passed",
    validationMessage: validation.sha256 ? `sha256=${validation.sha256}` : "file_ok",
    runtimeStatus: keepReady ? previous.runtimeStatus : getModelEntry(filename).runtimeStatus,
    runtimeBackend: keepReady ? previous.runtimeBackend : getModelEntry(filename).runtimeBackend,
    smokeTest: keepReady ? previous.smokeTest : getModelEntry(filename).smokeTest,
    errorMessage: null
  });
  return true;
}

async function initializeValidatedEngine(filename: string, options: GemmaEngineOptions = {}): Promise<Required<GemmaEngineOptions>> {
  const normalizedOptions = normalizeEngineOptions(filename, options);
  const key = makeEngineKey(filename, normalizedOptions);
  if (engineReadyKey === key) {
    return normalizedOptions;
  }
  if (engineInitPromise) {
    await engineInitPromise;
    return normalizedOptions;
  }

  patchEntry(filename, {
    status: "initializing",
    runtimeStatus: "initializing",
    runtimeBackend: normalizedOptions.backend,
    errorMessage: null
  });

  engineInitPromise = (async () => {
    await Gemma.initEngine(filename, normalizedOptions);
    engineReadyKey = key;
    return filename;
  })();

  try {
    await engineInitPromise;
    const info = await Gemma.getRuntimeInfo().catch(() => null);
    patchEntry(filename, {
      runtimeStatus: "ready",
      runtimeBackend: String(info?.accelerator ?? normalizedOptions.backend),
      localUri: info?.loadedModelPath ?? getModelEntry(filename).localUri ?? null
    });
    return normalizedOptions;
  } catch (error) {
    engineReadyKey = null;
    const message = error instanceof Error ? error.message : String(error);
    patchEntry(filename, {
      status: "runtime_failed",
      runtimeStatus: "failed",
      errorMessage: `本地推理运行时初始化失败：${message}`
    });
    throw error;
  } finally {
    engineInitPromise = null;
  }
}

export function subscribeManager(cb: (s: ManagerState) => void): () => void {
  subs.add(cb);
  cb(state);
  return () => {
    subs.delete(cb);
  };
}

/** Re-check whether a given model file is present on disk. */
export async function refreshModelStatus(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    patchEntry(filename, { status: "unsupported" });
    return;
  }
  try {
    const info = await Gemma.getModelFileInfo(filename);
    if (!info.exists || info.bytes <= 0) {
      patchEntry(filename, {
        status: "not_downloaded",
        progress: 0,
        bytesDownloaded: 0,
        localUri: info.path,
        fileSize: 0,
        validationStatus: "not_run",
        validationMessage: null,
        runtimeStatus: "not_run",
        runtimeBackend: null,
        smokeTest: null,
        errorMessage: null
      });
      return;
    }
    await validateModelOnDisk(filename, { preserveReady: true });
  } catch (error) {
    patchEntry(filename, {
      status: "validation_failed",
      validationStatus: "failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

/** Refresh all models in the catalog at once — used on app start. */
export async function refreshAllFromCatalog(): Promise<ModelCatalogEntry[]> {
  let catalog;
  try {
    catalog = await fetchModelCatalog(true);
  } catch (error) {
    console.warn("[model-manager] catalog fetch failed", error);
    return [];
  }
  for (const entry of catalog.models) {
    if (!state.byModel[entry.id]) {
      patchEntry(entry.id, { totalBytes: entry.size_bytes });
    } else {
      patchEntry(entry.id, { totalBytes: entry.size_bytes });
    }
    void refreshModelStatus(entry.id);
  }
  return catalog.models;
}

/** Kick off a download for the given model. */
export async function downloadModel(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    patchEntry(filename, { status: "unsupported" });
    return;
  }
  if (state.byModel[filename]?.status === "downloading") {
    return;
  }
  patchEntry(filename, {
    status: "downloading",
    progress: 0,
    bytesDownloaded: 0,
    errorMessage: null
  });

  try {
    const entry = await findModelById(filename);
    const downloadInfo = entry ? await resolveModelDownloadInfo(entry) : null;
    const stableApiUrl = entry ? resolveModelDownloadUrl(entry) : buildModelDownloadUrl(filename);
    // Prefer the stable backend URL for GCS signed-url entries. The backend
    // responds with a fresh 302 signed URL for every request, which makes
    // native resume/retry safer on slow mobile networks than reusing one
    // one-hour signed URL for the whole multi-GB transfer.
    const useStableRedirect =
      downloadInfo?.source === "gcs-signed-url" ||
      (!!downloadInfo?.expires_at && downloadInfo.via_backend_proxy === false);
    const url = useStableRedirect ? stableApiUrl : (downloadInfo?.download_url ?? stableApiUrl);
    const expectedBytes = downloadInfo?.size_bytes ?? entry?.size_bytes ?? 0;
    console.log(
      `[model-manager] download target model=${filename} host=${safeUrlHost(url)} resolvedHost=${downloadInfo?.url_host ?? "unknown"} source=${downloadInfo?.source ?? entry?.delivery ?? "fallback"} transport=${useStableRedirect ? "stable-api-redirect" : "direct"} status=${downloadInfo?.status_code ?? "unknown"} contentLength=${expectedBytes} retry=0`
    );
    const result = await Gemma.downloadModel(filename, url, downloadInfo?.checksum_sha256 ?? entry?.checksum_sha256, expectedBytes);
    patchEntry(filename, {
      status: "downloaded",
      progress: 1,
      bytesDownloaded: result.bytes,
      fileSize: result.bytes,
      localUri: result.path,
      downloadedAt: new Date().toISOString(),
      errorMessage: null
    });
    await validateModelOnDisk(filename);
  } catch (error) {
    patchEntry(filename, {
      status: "download_failed",
      errorMessage: normalizeDownloadError(error)
    });
  }
}

export async function importDebugModel(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    patchEntry(filename, { status: "unsupported" });
    return;
  }
  patchEntry(filename, {
    status: "validating",
    errorMessage: null,
    validationStatus: "not_run",
    runtimeStatus: "not_run",
    smokeTest: null
  });
  try {
    const result = await Gemma.importDebugModel(filename);
    patchEntry(filename, {
      status: "downloaded",
      localUri: result.path,
      fileSize: result.bytes,
      bytesDownloaded: result.bytes,
      downloadedAt: new Date().toISOString(),
      errorMessage: null
    });
    await validateModelOnDisk(filename);
  } catch (error) {
    patchEntry(filename, {
      status: "validation_failed",
      validationStatus: "failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function cancelDownload(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return;
  try {
    await Gemma.cancelDownload(filename);
  } catch (error) {
    console.warn("cancelDownload failed", error);
  }
  await refreshModelStatus(filename);
}

export async function deleteModel(filename: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return;
  try {
    await Gemma.deleteModel(filename);
  } catch (error) {
    console.warn("deleteModel failed", error);
  }
  engineReadyKey = null;
  engineInitPromise = null;
  patchEntry(filename, {
    status: "not_downloaded",
    progress: 0,
    bytesDownloaded: 0,
    fileSize: 0,
    localUri: null,
    downloadedAt: null,
    validationStatus: "not_run",
    validationMessage: null,
    runtimeStatus: "not_run",
    runtimeBackend: null,
    smokeTest: null,
    errorMessage: null
  });
}

/**
 * Toggle the dev-only stub mode. When enabled, the native module returns
 * canned responses without touching the native LiteRT-LM runtime — lets us verify the
 * end-to-end wiring before the real model is downloaded.
 */
export async function setStubMode(enabled: boolean): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return;
  if (!__DEV__ && enabled) {
    console.warn("stub mode is disabled outside debug builds");
    patchManager({ stub: false });
    return;
  }
  try {
    await Gemma.setStubMode(enabled);
    engineReadyKey = null;
    engineInitPromise = null;
    patchManager({ stub: enabled });
    // Re-check status of all known models so the UI updates.
    for (const filename of Object.keys(state.byModel)) {
      void refreshModelStatus(filename);
    }
  } catch (error) {
    console.warn("setStubMode failed", error);
  }
}

/**
 * Resolve the filename of the currently selected model, falling back to
 * the first ready model in the catalog if no explicit selection exists.
 */
export async function resolveSelectedModelFilename(): Promise<string | null> {
  const catalog = await fetchModelCatalog();
  const preferred = preferredModelId(catalog.models);
  const selected = state.selectedModelId;
  if (!selected) return preferred;

  const exists = catalog.models.some((entry) => entry.id === selected);
  if (!exists && preferred) {
    await setSelectedModelId(preferred);
    return preferred;
  }
  if (!exists) {
    await setSelectedModelId(null);
    return null;
  }
  return selected;
}

/**
 * Lazily make sure the engine is ready to generate using the currently
 * selected model. Throws if no model file exists.
 */
/**
 * Lazily make sure the engine is ready to generate using the currently
 * selected model. Throws if no model file exists.
 *
 * Pass `options` to override hardware backend (CPU/GPU/AUTO) or context size.
 * Gemma 4 E2B defaults to a 4096-token context so the XML workflow prompt fits;
 * smaller/local fallback models default to 2048.
 */
export async function ensureEngine(options: GemmaEngineOptions = {}): Promise<string> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    throw new Error("当前平台不支持 CareMind 本地推理。");
  }
  const filename = await resolveSelectedModelFilename();
  if (!filename) {
    throw new Error("尚未选择本地模型。");
  }
  let entry = getModelEntry(filename);
  if (entry.status === "not_downloaded" || entry.status === "validation_failed") {
    await refreshModelStatus(filename);
    entry = getModelEntry(filename);
  }
  if (entry.status !== "ready") {
    const message = TRACK_C_OFFLINE_DEMO
      ? "本地模型未就绪，请先下载/导入模型并运行本地 Gemma smoke test 或 Track C 离线验证。当前结果只能作为本地规则兜底，不代表 Gemma 4 推理。"
      : "当前选中的本地模型未就绪。";
    throw new Error(entry.errorMessage ?? message);
  }

  await initializeValidatedEngine(filename, options);
  return filename;
}

export async function runLocalGemmaSmokeTest(filenameArg?: string | null, options: GemmaEngineOptions = {}): Promise<ModelSmokeResult> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    throw new Error("当前平台不支持 CareMind 本地推理。");
  }
  const filename = filenameArg ?? (await resolveSelectedModelFilename());
  if (!filename) {
    throw new Error("尚未选择本地模型。");
  }

  await Gemma.setStubMode(false).catch(() => undefined);
  const validated = await validateModelOnDisk(filename);
  if (!validated) {
    const entry = getModelEntry(filename);
    const failed: ModelSmokeResult = {
      passed: false,
      source: "unavailable",
      modelId: filename,
      backend: "unknown",
      latencyMs: 0,
      nativeGenerateAttempted: false,
      nativeGenerateReturned: false,
      rawOutputLength: 0,
      rawOutputHash: null,
      errorMessage: entry.errorMessage ?? "model_validation_failed"
    };
    patchEntry(filename, { smokeTest: failed });
    return failed;
  }

  const startedAt = Date.now();
  try {
    const engineOptions = await initializeValidatedEngine(filename, {
      backend: options.backend ?? "AUTO",
      maxTokens: options.maxTokens ?? 96,
      contextTokens: options.contextTokens ?? defaultContextTokensForModel(filename)
    });
    const result = await Gemma.generate("请用一句中文说明你正在本机离线运行。", {
      ...engineOptions,
      filename,
      temperature: DEFAULT_TEMPERATURE,
      topK: DEFAULT_TOP_K
    });
    const rawText = result.text ?? "";
    const rawHash = hashInferenceOutput(rawText);
    const passed =
      result.source === "native_litertlm_success" &&
      rawText.trim().length > 0 &&
      !!rawHash;
    const smoke: ModelSmokeResult = {
      passed,
      source: result.source === "stub_debug" ? "stub_debug" : passed ? "native_litertlm_success" : "unavailable",
      modelId: result.modelId ?? filename,
      backend: result.backend ?? getModelEntry(filename).runtimeBackend ?? "unknown",
      latencyMs: result.elapsedMs ?? Date.now() - startedAt,
      nativeGenerateAttempted: true,
      nativeGenerateReturned: rawText.trim().length > 0,
      rawOutputLength: rawText.length,
      rawOutputHash: rawHash,
      errorMessage: passed ? null : "native_smoke_no_valid_output"
    };
    patchEntry(filename, {
      status: passed ? "ready" : "runtime_failed",
      runtimeStatus: passed ? "ready" : "failed",
      runtimeBackend: smoke.backend,
      smokeTest: smoke,
      errorMessage: passed ? null : "本地 Gemma smoke test 未返回有效 native 输出。"
    });
    return smoke;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: ModelSmokeResult = {
      passed: false,
      source: "unavailable",
      modelId: filename,
      backend: getModelEntry(filename).runtimeBackend ?? "unknown",
      latencyMs: Date.now() - startedAt,
      nativeGenerateAttempted: false,
      nativeGenerateReturned: false,
      rawOutputLength: 0,
      rawOutputHash: null,
      errorMessage: message
    };
    patchEntry(filename, {
      status: "runtime_failed",
      runtimeStatus: "failed",
      smokeTest: failed,
      errorMessage: `本地 Gemma smoke test 失败：${message}`
    });
    return failed;
  }
}

export async function preloadSelectedEngine(options: GemmaEngineOptions = {}): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE || state.stub) return;
  try {
    const filename = await resolveSelectedModelFilename();
    if (!filename || getModelEntry(filename).status !== "ready") return;
    await ensureEngine(options);
    console.log(`[model-manager] preloaded local engine model=${filename}`);
  } catch (error) {
    console.warn("[model-manager] preload local engine failed", error);
  }
}

// ---------------------------------------------------------------------------
// Wire up once at module load: native progress events + selected-model sync
// ---------------------------------------------------------------------------

let progressSub: { remove: () => void } | null = null;

function attachProgress() {
  if (progressSub || !GEMMA_NATIVE_AVAILABLE) return;
  progressSub = subscribeDownloadProgress((event) => {
    patchEntry(event.filename, {
      bytesDownloaded: event.bytesDownloaded,
      totalBytes: event.totalBytes,
      progress: event.ratio
    });
  });
}

// Mirror the selected-model singleton into manager state so subscribers get
// re-renders when the user picks a different model in the settings UI.
subscribeSelectedModelId((id) => {
  patchManager({ selectedModelId: id });
});

attachProgress();
if (GEMMA_NATIVE_AVAILABLE) {
  // Schedule an initial catalog fetch + status check without blocking import.
  void refreshAllFromCatalog();
}

/** React hook over the manager. */
export function useManagerState(): ManagerState {
  const [value, setValue] = useState<ManagerState>(state);
  useEffect(() => subscribeManager(setValue), []);
  return value;
}

/** React hook for a single model entry. */
export function useModelEntry(filename: string | null | undefined): PerModelState | null {
  const [value, setValue] = useState<PerModelState | null>(
    filename ? getModelEntry(filename) : null
  );
  useEffect(() => {
    if (!filename) {
      setValue(null);
      return;
    }
    setValue(getModelEntry(filename));
    return subscribeManager((s) => setValue(s.byModel[filename] ?? emptyEntry(filename)));
  }, [filename]);
  return value;
}

/** Convenience: trigger an explicit catalog refresh (used by pull-to-refresh in UI). */
export async function refreshCatalogNow(): Promise<ModelCatalogEntry[]> {
  return refreshAllFromCatalog();
}

/** Auto-select the recommended model if no selection has been made. */
export async function ensureSelectionFromCatalog(catalog: ModelCatalogEntry[]): Promise<void> {
  const preferred = preferredModelId(catalog);
  if (state.selectedModelId) {
    // If the persisted selection is no longer in the catalog, move to the
    // current recommended model. Do not auto-downgrade Gemma 4: the competition
    // build intentionally targets Gemma 4 E2B on both Android and iOS.
    const exists = catalog.some((m) => m.id === state.selectedModelId);
    if (!exists && preferred) {
      await setSelectedModelId(preferred);
    } else if (!exists) {
      await setSelectedModelId(null);
    }
    return;
  }
  if (preferred) {
    await setSelectedModelId(preferred);
  }
}

/** Convenience re-export so PrivacyModeCard can stay in this file's API. */
export { findModelById };
export type { ModelCatalogEntry };
