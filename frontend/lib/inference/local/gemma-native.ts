// TypeScript wrapper around the platform native module that bridges
// React Native to on-device inference. Android uses the legacy Kotlin
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
 * Hardware backend for MediaPipe LLM Inference.
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
   * Max tokens the engine keeps in its KV cache (prompt + generated).
   * Lower values dramatically reduce native memory; default 2048.
   * Try 1024 first when loading a 2 B model is OOM-ing.
   */
  maxTokens?: number;
  /** iOS llama.cpp context window override. Defaults to 2048. */
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
}

export interface GemmaRuntimeInfo {
  platform: "android" | "ios";
  runtime: string;
  accelerator: "AUTO" | "CPU" | "GPU" | "cpu" | "gpu" | "metal" | "coreml" | "auto";
  supportsAudio: boolean;
  loadedModelId?: string;
  memoryClassMb?: number;
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
  downloadModel(filename: string, url: string, checksum?: string): Promise<{ path: string; filename: string; bytes: number }>;
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

  downloadModel(filename: string, url: string, checksum?: string): Promise<{ path: string; filename: string; bytes: number }> {
    return ensureNative().downloadModel(filename, url, checksum);
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
        runtime: Platform.OS === "android" ? "mediapipe-llm" : "unavailable",
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
