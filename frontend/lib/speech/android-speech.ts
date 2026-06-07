import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

export type AndroidSpeechResultEvent = {
  transcript?: string;
  isFinal?: boolean;
};

export type AndroidSpeechErrorEvent = {
  message?: string;
  code?: number;
};

export type AndroidSpeechStateEvent = {
  state?: "ready" | "listening" | "transcribing" | "idle";
};

type Subscription = {
  remove: () => void;
};

interface CaremindSpeechSpec {
  isAvailable(): Promise<boolean>;
  start(locale?: string): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
}

const NativeCaremindSpeech: CaremindSpeechSpec | undefined =
  (NativeModules as Record<string, CaremindSpeechSpec | undefined>).CaremindSpeech;

export const ANDROID_SPEECH_RECOGNITION_AVAILABLE =
  Platform.OS === "android" && !!NativeCaremindSpeech;

function ensureSpeech(): CaremindSpeechSpec {
  if (!NativeCaremindSpeech) {
    throw new Error("当前设备暂不支持系统语音识别，可以先手动输入。");
  }
  return NativeCaremindSpeech;
}

export async function isAndroidSpeechRecognitionAvailable(): Promise<boolean> {
  if (!ANDROID_SPEECH_RECOGNITION_AVAILABLE) return false;
  try {
    return await ensureSpeech().isAvailable();
  } catch {
    return false;
  }
}

export function startAndroidSpeechRecognition(locale = "zh-CN"): Promise<void> {
  return ensureSpeech().start(locale);
}

export function stopAndroidSpeechRecognition(): Promise<void> {
  return ensureSpeech().stop();
}

export function cancelAndroidSpeechRecognition(): Promise<void> {
  if (!NativeCaremindSpeech) return Promise.resolve();
  return NativeCaremindSpeech.cancel();
}

export function subscribeAndroidSpeechResult(
  cb: (event: AndroidSpeechResultEvent) => void
): Subscription {
  return DeviceEventEmitter.addListener("CaremindSpeech_Result", cb);
}

export function subscribeAndroidSpeechError(
  cb: (event: AndroidSpeechErrorEvent) => void
): Subscription {
  return DeviceEventEmitter.addListener("CaremindSpeech_Error", cb);
}

export function subscribeAndroidSpeechState(
  cb: (event: AndroidSpeechStateEvent) => void
): Subscription {
  return DeviceEventEmitter.addListener("CaremindSpeech_State", cb);
}
