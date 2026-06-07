// On-device speech transcription via Gemma multimodal. The recorder in
// SmartLogScreen produces a local file URI (file://...); we strip the
// scheme and hand the file path to the native module.

import type { AudioTranscriptionResponse, TranscribeAudioNoteInput } from "../shared/types";
import { Gemma } from "./gemma-native";
import { ensureEngine } from "./model-manager";
import { buildTranscriptionPrompt } from "./prompts";
import { TRANSCRIPTION_MAX_TOKENS, DEFAULT_TEMPERATURE, DEFAULT_TOP_K } from "./constants";
import { reportOnDeviceInference } from "./telemetry";

const LOCAL_GEMMA_AUDIO_ENABLED = process.env.EXPO_PUBLIC_CAREMIND_ENABLE_LOCAL_AUDIO === "1";

function toLocalPath(uri: string): string {
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}

export async function transcribeAudioNoteLocal(
  input: TranscribeAudioNoteInput
): Promise<AudioTranscriptionResponse> {
  const startedAt = Date.now();
  let filename = "unknown";
  let outputChars = 0;
  let success = false;
  let errorKind: string | undefined;

  try {
    if (!LOCAL_GEMMA_AUDIO_ENABLED) {
      errorKind = "local_audio_disabled";
      throw new Error("隐私模式下暂不启用本地语音转文字，请先手动输入，或关闭隐私模式后使用系统语音识别。");
    }

    filename = await ensureEngine();

    const language = input.language ?? "zh";
    const prompt = buildTranscriptionPrompt(language);
    const path = toLocalPath(input.asset.uri);

    const result = await Gemma.generateWithAudio(prompt, path, {
      filename,
      maxTokens: TRANSCRIPTION_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      topK: DEFAULT_TOP_K
    });

    const transcript = (result.text ?? "").trim();
    outputChars = transcript.length;
    if (!transcript) {
      errorKind = "empty_transcript";
      throw new Error("本地语音识别返回空内容，请稍后重试或关闭隐私模式。");
    }

    success = true;
    return {
      request_id: `local_audio_${Date.now()}`,
      transcript,
      model: filename,
      language,
      provider: "on_device_gemma",
      medical_boundary: "本地处理，未上传服务器。"
    };
  } catch (error) {
    errorKind = errorKind ?? (error instanceof Error ? error.message.slice(0, 60) : "engine_error");
    throw error;
  } finally {
    // Audio length we don't have easily; pass 0 — the duration is in elapsed_ms anyway.
    void reportOnDeviceInference({
      task: "audio",
      modelId: filename,
      success,
      elapsedMs: Date.now() - startedAt,
      inputChars: 0,
      outputChars,
      fellBack: false,
      errorKind
    });
  }
}
