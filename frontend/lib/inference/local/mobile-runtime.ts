import { Platform } from "react-native";

import { Gemma, GEMMA_NATIVE_AVAILABLE } from "./gemma-native";
import type { GemmaEngineOptions, GemmaGenerateOptions, GemmaGenerateResult } from "./gemma-native";
import {
  findModelById,
  getModelEntry,
  refreshModelStatus,
  resolveSelectedModelFilename
} from "./model-manager";
import type {
  MobileModelAvailability,
  ModelProfile,
  RuntimeInitializationStatus,
  RoutingRuntimePlatform
} from "../shared/model-routing";

export type MobileRuntimeErrorCode =
  | "native_unavailable"
  | "model_missing"
  | "runtime_init_failed"
  | "generation_failed"
  | "timed_out"
  | "unsupported_platform";

export interface MobileGenerateRequest {
  prompt: string;
  filename?: string;
  timeoutMs?: number;
  options?: GemmaGenerateOptions;
}

export interface MobileGenerateResponse extends GemmaGenerateResult {
  runtime_status: RuntimeInitializationStatus;
}

let lastRuntimeStatus: RuntimeInitializationStatus = {
  status: "uninitialized",
  runtime: "unavailable",
  model_id: null,
  backend: "unknown",
  error_code: null,
  error_message: null,
  initialized_at: null
};

function currentPlatform(): RoutingRuntimePlatform {
  if (Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web") {
    return Platform.OS;
  }
  return "unknown";
}

function profileForModel(filename: string | null | undefined): ModelProfile | null {
  if (!filename) return null;
  if (/aicore/i.test(filename)) return "android_aicore_optional";
  if (/e4b/i.test(filename)) return "on_device_e4b";
  if (/e2b|gemma\.litertlm/i.test(filename)) return "on_device_e2b";
  return "on_device_e2b";
}

function runtimeFromPlatform(): string {
  if (Platform.OS === "android") return "litert_lm_android";
  if (Platform.OS === "ios") return "litert_lm_swift_early_preview";
  return "unavailable";
}

function normalizeError(error: unknown): { code: MobileRuntimeErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || message.includes("超时")) {
    return { code: "timed_out", message };
  }
  if (lower.includes("model") || message.includes("模型")) {
    return { code: "model_missing", message };
  }
  if (!GEMMA_NATIVE_AVAILABLE) {
    return { code: "native_unavailable", message };
  }
  return { code: "runtime_init_failed", message };
}

function statusFromError(error: unknown): RuntimeInitializationStatus {
  const normalized = normalizeError(error);
  return {
    status: normalized.code === "timed_out" ? "timed_out" : normalized.code === "model_missing" ? "missing_model" : "init_failed",
    runtime: runtimeFromPlatform(),
    model_id: null,
    backend: "unknown",
    error_code: normalized.code,
    error_message: normalized.message,
    initialized_at: null
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  onTimeout?: () => Promise<void>
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onTimeout?.();
      reject(new Error(`on-device runtime timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getMobileModelAvailability(
  filename?: string | null
): Promise<MobileModelAvailability> {
  const platform = currentPlatform();
  const selected = filename ?? (await resolveSelectedModelFilename());
  const profile = profileForModel(selected);

  if (platform !== "ios" && platform !== "android") {
    return {
      platform,
      model_id: selected,
      profile,
      installed: false,
      downloadable: false,
      runtime_supported: false,
      memory_eligible: false,
      recommended_backend: "unknown",
      reason: "unsupported platform"
    };
  }

  if (!GEMMA_NATIVE_AVAILABLE) {
    return {
      platform,
      model_id: selected,
      profile,
      installed: false,
      downloadable: true,
      runtime_supported: false,
      memory_eligible: false,
      recommended_backend: "unknown",
      reason: "native module unavailable"
    };
  }

  if (!selected) {
    return {
      platform,
      model_id: null,
      profile: null,
      installed: false,
      downloadable: true,
      runtime_supported: true,
      memory_eligible: false,
      recommended_backend: "AUTO",
      reason: "no selected model"
    };
  }

  await refreshModelStatus(selected);
  const state = getModelEntry(selected);
  const catalogEntry = await findModelById(selected);
  const minMemory = catalogEntry?.min_device_memory_gb ?? 0;
  const memoryEligible = profile === "on_device_e4b" ? minMemory >= 8 || !catalogEntry : true;

  return {
    platform,
    model_id: selected,
    profile,
    installed: state.status === "ready",
    downloadable: true,
    runtime_supported: true,
    memory_eligible: memoryEligible,
    recommended_backend: profile === "on_device_e4b" ? "CPU" : "AUTO",
    size_bytes: catalogEntry?.size_bytes,
    reason: state.errorMessage ?? undefined
  };
}

export async function getMobileRuntimeStatus(): Promise<RuntimeInitializationStatus> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    return {
      status: "unsupported_device",
      runtime: runtimeFromPlatform(),
      model_id: null,
      backend: "unknown",
      error_code: "native_unavailable",
      error_message: "CareMind native Gemma runtime is unavailable on this platform.",
      initialized_at: null
    };
  }

  try {
    const info = await Gemma.getRuntimeInfo();
    const loadedModelId = info.loadedModelId ?? lastRuntimeStatus.model_id;
    const status: RuntimeInitializationStatus = {
      status: loadedModelId ? "ready" : lastRuntimeStatus.status,
      runtime: info.runtime || runtimeFromPlatform(),
      model_id: loadedModelId ?? null,
      backend:
        info.accelerator === "CPU" || info.accelerator === "GPU" || info.accelerator === "AUTO"
          ? info.accelerator
          : "unknown",
      error_code: null,
      error_message: null,
      initialized_at: lastRuntimeStatus.initialized_at
    };
    lastRuntimeStatus = status;
    return status;
  } catch (error) {
    lastRuntimeStatus = statusFromError(error);
    return lastRuntimeStatus;
  }
}

export async function initializeMobileRuntime(
  filename?: string | null,
  options: GemmaEngineOptions = {}
): Promise<RuntimeInitializationStatus> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    lastRuntimeStatus = {
      status: "unsupported_device",
      runtime: runtimeFromPlatform(),
      model_id: filename ?? null,
      backend: "unknown",
      error_code: "native_unavailable",
      error_message: "CareMind native Gemma runtime is unavailable on this platform.",
      initialized_at: null
    };
    return lastRuntimeStatus;
  }

  const selected = filename ?? (await resolveSelectedModelFilename());
  if (!selected) {
    lastRuntimeStatus = {
      status: "missing_model",
      runtime: runtimeFromPlatform(),
      model_id: null,
      backend: "unknown",
      error_code: "model_missing",
      error_message: "No on-device model is selected.",
      initialized_at: null
    };
    return lastRuntimeStatus;
  }

  try {
    await refreshModelStatus(selected);
    const entry = getModelEntry(selected);
    if (entry.status !== "ready") {
      throw new Error(entry.errorMessage ?? "Selected on-device model is not ready.");
    }
    await Gemma.initEngine(selected, options);
    lastRuntimeStatus = {
      status: "ready",
      runtime: runtimeFromPlatform(),
      model_id: selected,
      backend: options.backend ?? "AUTO",
      error_code: null,
      error_message: null,
      initialized_at: new Date().toISOString()
    };
    return lastRuntimeStatus;
  } catch (error) {
    const normalized = normalizeError(error);
    lastRuntimeStatus = {
      status: normalized.code === "model_missing" ? "missing_model" : "init_failed",
      runtime: runtimeFromPlatform(),
      model_id: selected,
      backend: options.backend ?? "AUTO",
      error_code: normalized.code,
      error_message: normalized.message,
      initialized_at: null
    };
    return lastRuntimeStatus;
  }
}

export async function generateWithMobileRuntime(
  request: MobileGenerateRequest
): Promise<MobileGenerateResponse> {
  const filename = request.filename ?? (await resolveSelectedModelFilename());
  const requestId = request.options?.requestId ?? `local_${Date.now().toString(36)}`;
  const status = await initializeMobileRuntime(filename, request.options ?? {});
  if (status.status !== "ready" || !filename) {
    throw new Error(status.error_message ?? "On-device runtime is not ready.");
  }

  try {
    const result = await withTimeout(
      Gemma.generate(request.prompt, {
        ...(request.options ?? {}),
        filename,
        requestId
      }),
      request.timeoutMs,
      () => Gemma.cancelGeneration(requestId)
    );
    return {
      ...result,
      runtime_status: await getMobileRuntimeStatus()
    };
  } catch (error) {
    const normalized = normalizeError(error);
    lastRuntimeStatus = {
      status: normalized.code === "timed_out" ? "timed_out" : "init_failed",
      runtime: runtimeFromPlatform(),
      model_id: filename,
      backend: request.options?.backend ?? "AUTO",
      error_code: normalized.code === "runtime_init_failed" ? "generation_failed" : normalized.code,
      error_message: normalized.message,
      initialized_at: null
    };
    throw error;
  }
}

export function cancelMobileGeneration(requestId: string): Promise<void> {
  if (!GEMMA_NATIVE_AVAILABLE) return Promise.resolve();
  return Gemma.cancelGeneration(requestId);
}
