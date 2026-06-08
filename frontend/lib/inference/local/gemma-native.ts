// TypeScript wrapper around the Android native module that bridges
// React Native to MediaPipe LLM Inference. On platforms without the native
// side (iOS, web), every call rejects with a clear error so the inference
// router can decide to fall back to cloud.
//
// Every model lifecycle method now takes an explicit `filename` argument so
// multiple models can coexist on disk; the active model is whichever the
// JS side passes in (driven by the privacy-mode picker).

import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import type { EmitterSubscription } from "react-native";

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

export interface DownloadProgressEvent {
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  ratio: number; // 0..1, totalBytes may be 0 early on, in which case ratio=0
}

interface CaremindGemmaSpec {
  isModelReady(filename: string): Promise<boolean>;
  getModelPath(filename: string): Promise<string>;
  downloadModel(filename: string, url: string): Promise<{ path: string; filename: string; bytes: number }>;
  cancelDownload(filename: string): Promise<void>;
  deleteModel(filename: string): Promise<void>;
  initEngine(filename: string, options: GemmaEngineOptions | null): Promise<void>;
  releaseEngine(): Promise<void>;
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

const NativeCaremindGemma: CaremindGemmaSpec | undefined =
  (NativeModules as Record<string, CaremindGemmaSpec | undefined>).CaremindGemma;

export const GEMMA_NATIVE_AVAILABLE = Platform.OS === "android" && !!NativeCaremindGemma;

function ensureNative(): CaremindGemmaSpec {
  if (!NativeCaremindGemma) {
    throw new Error("当前平台不支持本地推理（仅 Android 真机）。");
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

  downloadModel(filename: string, url: string): Promise<{ path: string; filename: string; bytes: number }> {
    return ensureNative().downloadModel(filename, url);
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
  return DeviceEventEmitter.addListener("CaremindGemma_DownloadProgress", cb);
}
