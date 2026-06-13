import { Gemma, GEMMA_NATIVE_AVAILABLE } from "./gemma-native";
import type { GemmaEngineOptions, GemmaGenerateResult, GemmaRuntimeInfo } from "./gemma-native";
import { DEFAULT_TEMPERATURE, DEFAULT_TOP_K, GEMMA4_E2B_CONTEXT_TOKENS } from "./constants";

export const GEMMA4_E2B_MODEL_ID = "gemma-4-E2B-it.litertlm";

export interface Gemma4SmokeResult extends GemmaGenerateResult {
  modelId: string;
  runtime: GemmaRuntimeInfo;
}

export async function runGemma4E2BSmokePrompt(
  prompt = "请用一句话说明 CareMind 可以怎样帮助家庭照护者。",
  options: GemmaEngineOptions = {}
): Promise<Gemma4SmokeResult> {
  if (!GEMMA_NATIVE_AVAILABLE) {
    throw new Error("当前平台不支持 CareMind 本地推理。");
  }

  const ready = await Gemma.isModelReady(GEMMA4_E2B_MODEL_ID);
  if (!ready) {
    throw new Error("Gemma 4 E2B 模型文件未就绪，请先下载 gemma-4-E2B-it.litertlm。");
  }

  const engineOptions: GemmaEngineOptions = {
    backend: options.backend ?? "AUTO",
    maxTokens: options.maxTokens ?? 256,
    contextTokens: options.contextTokens ?? GEMMA4_E2B_CONTEXT_TOKENS
  };

  await Gemma.setStubMode(false);
  await Gemma.logMemorySnapshot("gemma4-smoke-before-load");
  await Gemma.initEngine(GEMMA4_E2B_MODEL_ID, engineOptions);
  await Gemma.logMemorySnapshot("gemma4-smoke-after-load");

  const result = await Gemma.generate(prompt, {
    ...engineOptions,
    filename: GEMMA4_E2B_MODEL_ID,
    temperature: DEFAULT_TEMPERATURE,
    topK: DEFAULT_TOP_K
  });

  if (result.source === "stub_debug") {
    throw new Error("Gemma 4 E2B smoke failed: stub_debug output returned instead of native LiteRT-LM.");
  }
  if (!result.text.trim()) {
    throw new Error("Gemma 4 E2B smoke failed: native LiteRT-LM returned empty output.");
  }

  await Gemma.logMemorySnapshot("gemma4-smoke-after-generate");

  return {
    ...result,
    modelId: GEMMA4_E2B_MODEL_ID,
    runtime: await Gemma.getRuntimeInfo()
  };
}
