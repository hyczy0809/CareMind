// TypeScript wrapper around the platform native module that bridges
// React Native to on-device inference. Android uses the Kotlin LiteRT-LM
// NativeModules.CaremindGemma bridge; iOS uses the local Expo Swift module
// with the same module name. Web keeps returning clear unsupported errors.
//
// Every model lifecycle method now takes an explicit `filename` argument so
// multiple models can coexist on disk; the active model is whichever the
// JS side passes in (driven by the privacy-mode picker).

import { EventEmitter, requireOptionalNativeModule } from "expo-modules-core";
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import type { EmitterSubscription } from "react-native";
import type { EventSubscription } from "expo-modules-core";

/**
 * Hardware backend for LiteRT-LM local inference.
 *
 * - `AUTO` (default) — the native side picks based on model size. Models over
 *   ~1.5 GB on disk fall back to CPU because most phone GPUs cannot hold the
 *   full weight tensor in VRAM and will OOM mid-graph. Smaller models go GPU.
 * - `CPU` — force CPU. Slower but most reliable, often the only path that
 *   works for ≥3 B parameter models on commodity Android.
 * - `GPU` — force GPU (OpenCL delegate). Lowest latency on small models;
 *   may fail to compile or run out of VRAM on larger ones.
 */
export type GemmaBackend = "AUTO" | "CPU" | "GPU";

export interface GemmaEngineOptions {
  /** Hardware backend override. Defaults to "AUTO". */
  backend?: GemmaBackend;
  /**
   * Generated-output budget requested by JS callers.
   * Android LiteRT-LM currently uses `contextTokens` for the engine window.
   */
  maxTokens?: number;
  /** Engine context window override. Gemma 4 E2B defaults to 4096, other local models to 2048. */
  contextTokens?: number;
}

export interface GemmaGenerateOptions extends GemmaEngineOptions {
  /** Filename of the model to use. Required for non-stub generation. */
  filename?: string;
  temperature?: number;
  topK?: number;
  requestId?: string;
}

export interface GemmaGenerateResult {
  text: string;
  tokenCount?: number;
  elapsedMs?: number;
  source?: "native_litertlm_success" | "stub_debug";
  modelId?: string;
  backend?: string;
  engineInitialized?: boolean;
}

export interface GemmaModelFileInfo {
  filename: string;
  path: string;
  exists: boolean;
  readable: boolean;
  bytes: number;
  extension: string;
  debugTmp?: boolean;
}

export interface GemmaModelValidationResult extends GemmaModelFileInfo {
  ok: boolean;
  sha256?: string | null;
  reason?: string | null;
}

export interface GemmaRuntimeInfo {
  platform: "android" | "ios";
  runtime: string;
  runtimeDependency?: string;
  accelerator: "AUTO" | "CPU" | "GPU" | "cpu" | "gpu" | "metal" | "coreml" | "auto";
  supportsAudio: boolean;
  loadedModelId?: string;
  loadedModelPath?: string;
  modelFormat?: string;
  loadedModelBytes?: number;
  engineInitialized?: boolean;
  memoryClassMb?: number;
  systemInfo?: {
    manufacturer?: string;
    brand?: string;
    model?: string;
    device?: string;
    hardware?: string;
    androidVersion?: string;
    sdkInt?: number;
    totalMemoryMb?: number;
    availableMemoryMb?: number;
    lowMemoryThresholdMb?: number;
    lowMemory?: boolean;
    largeHeapClassMb?: number;
    airplaneMode?: boolean;
  };
}

export interface DownloadProgressEvent {
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  ratio: number; // 0..1, totalBytes may be 0 early on, in which case ratio=0
}

interface CaremindGemmaSpec {
  isModelReady(filename: string): Promise<boolean>;
  getModelPath(filename: string): Promise<string>;
  getModelFileInfo?: (filename: string) => Promise<GemmaModelFileInfo>;
  validateModelFile?: (filename: string, expectedBytes?: number, checksum?: string) => Promise<GemmaModelValidationResult>;
  importDebugModel?: (filename: string) => Promise<{ path: string; filename: string; bytes: number }>;
  downloadModel(filename: string, url: string, checksum?: string, expectedBytes?: number): Promise<{ path: string; filename: string; bytes: number }>;
  cancelDownload(filename: string): Promise<void>;
  deleteModel(filename: string): Promise<void>;
  initEngine(filename: string, options: GemmaEngineOptions | null): Promise<void>;
  releaseEngine(): Promise<void>;
  getRuntimeInfo?: () => Promise<GemmaRuntimeInfo>;
  logMemorySnapshot(label: string | null): Promise<void>;
  generate(prompt: string, options: GemmaGenerateOptions): Promise<GemmaGenerateResult>;
  generateWithAudio(
    prompt: string,
    audioFilePath: string,
    options: GemmaGenerateOptions
  ): Promise<GemmaGenerateResult>;
  cancelGeneration(requestId: string): Promise<void>;
  setStubMode(enabled: boolean): Promise<void>;
}

const LegacyNativeCaremindGemma: CaremindGemmaSpec | undefined =
  (NativeModules as Record<string, CaremindGemmaSpec | undefined>).CaremindGemma;

const ExpoNativeCaremindGemma: CaremindGemmaSpec | null =
  Platform.OS === "ios" ? requireOptionalNativeModule<CaremindGemmaSpec>("CaremindGemma") : null;

const NativeCaremindGemma: CaremindGemmaSpec | undefined =
  LegacyNativeCaremindGemma ?? ExpoNativeCaremindGemma ?? undefined;

export const GEMMA_NATIVE_AVAILABLE =
  (Platform.OS === "android" || Platform.OS === "ios") && !!NativeCaremindGemma;

function ensureNative(): CaremindGemmaSpec {
  if (!NativeCaremindGemma) {
    throw new Error("当前平台不支持 CareMind 本地推理。");
  }
  return NativeCaremindGemma;
}

export const Gemma = {
  available: GEMMA_NATIVE_AVAILABLE,

  isModelReady(filename: string): Promise<boolean> {
    if (!NativeCaremindGemma) return Promise.resolve(false);
    return NativeCaremindGemma.isModelReady(filename);
  },

  getModelPath(filename: string): Promise<string> {
    return ensureNative().getModelPath(filename);
  },

  async getModelFileInfo(filename: string): Promise<GemmaModelFileInfo> {
    const native = ensureNative();
    if (native.getModelFileInfo) {
      return native.getModelFileInfo(filename);
    }
    const [path, exists] = await Promise.all([
      native.getModelPath(filename),
      native.isModelReady(filename)
    ]);
    const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() ?? "" : "";
    return {
      filename,
      path,
      exists,
      readable: exists,
      bytes: 0,
      extension
    };
  },

  async validateModelFile(filename: string, expectedBytes?: number, checksum?: string): Promise<GemmaModelValidationResult> {
    const native = ensureNative();
    if (native.validateModelFile) {
      return native.validateModelFile(filename, expectedBytes, checksum);
    }
    const info = await this.getModelFileInfo(filename);
    const reasons: string[] = [];
    if (!info.exists) reasons.push("not_downloaded");
    if (info.exists && !info.readable) reasons.push("not_readable");
    if ((info.extension || "").toLowerCase() !== "litertlm") reasons.push(`wrong_extension:${info.extension}`);
    if (typeof expectedBytes === "number" && expectedBytes > 0 && info.bytes > 0 && info.bytes !== expectedBytes) {
      reasons.push(`size_mismatch:${info.bytes}/${expectedBytes}`);
    }
    return {
      ...info,
      ok: reasons.length === 0,
      sha256: null,
      reason: reasons.join(",")
    };
  },

  importDebugModel(filename: string): Promise<{ path: string; filename: string; bytes: number }> {
    const native = ensureNative();
    if (!native.importDebugModel) {
      return Promise.reject(new Error("当前原生包不支持导入调试模型。"));
    }
    return native.importDebugModel(filename);
  },

  downloadModel(filename: string, url: string, checksum?: string, expectedBytes?: number): Promise<{ path: string; filename: string; bytes: number }> {
    return ensureNative().downloadModel(filename, url, checksum, expectedBytes);
  },

  cancelDownload(filename: string): Promise<void> {
    return ensureNative().cancelDownload(filename);
  },

  deleteModel(filename: string): Promise<void> {
    return ensureNative().deleteModel(filename);
  },

  initEngine(filename: string, options: GemmaEngineOptions = {}): Promise<void> {
    return ensureNative().initEngine(filename, options);
  },

  releaseEngine(): Promise<void> {
    if (!NativeCaremindGemma) return Promise.resolve();
    return NativeCaremindGemma.releaseEngine();
  },

  logMemorySnapshot(label?: string): Promise<void> {
    if (!NativeCaremindGemma) return Promise.resolve();
    return NativeCaremindGemma.logMemorySnapshot(label ?? null);
  },

  getRuntimeInfo(): Promise<GemmaRuntimeInfo> {
    if (!NativeCaremindGemma?.getRuntimeInfo) {
      return Promise.resolve({
        platform: Platform.OS === "ios" ? "ios" : "android",
        runtime: Platform.OS === "android" ? "litert-lm" : "unavailable",
        accelerator: "AUTO",
        supportsAudio: false
      });
    }
    return NativeCaremindGemma.getRuntimeInfo();
  },

  generate(prompt: string, options: GemmaGenerateOptions = {}): Promise<GemmaGenerateResult> {
    return ensureNative().generate(prompt, options);
  },

  generateWithAudio(
    prompt: string,
    audioFilePath: string,
    options: GemmaGenerateOptions = {}
  ): Promise<GemmaGenerateResult> {
    return ensureNative().generateWithAudio(prompt, audioFilePath, options);
  },

  cancelGeneration(requestId: string): Promise<void> {
    return ensureNative().cancelGeneration(requestId);
  },

  setStubMode(enabled: boolean): Promise<void> {
    if (!NativeCaremindGemma) return Promise.resolve();
    return NativeCaremindGemma.setStubMode(enabled);
  }
};

/**
 * Subscribe to download progress events emitted from the native side.
 * No-op when the native module is missing.
 */
export function subscribeDownloadProgress(
  cb: (event: DownloadProgressEvent) => void
): EmitterSubscription | { remove: () => void } {
  if (!GEMMA_NATIVE_AVAILABLE) {
    return { remove: () => {} };
  }
  if (Platform.OS === "ios" && ExpoNativeCaremindGemma) {
    const emitter = new EventEmitter(ExpoNativeCaremindGemma as never);
    const subscription: EventSubscription = emitter.addListener(
      "CaremindGemma_DownloadProgress" as never,
      cb as never
    );
    return { remove: () => subscription.remove() };
  }
  return DeviceEventEmitter.addListener("CaremindGemma_DownloadProgress", cb);
}
