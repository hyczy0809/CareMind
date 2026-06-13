// Hybrid edge-cloud inference router with a Track C offline override.
//
// In Track C demo mode every judged inference path stays on device. Cloud
// adapters remain available only for non-demo hybrid builds.
//
// Call sites (SmartLogScreen, FollowupPrepScreen, store) import these
// functions from lib/care-workflow-api.ts and remain unaware of the split.

import type {
  CareWorkflowRequest,
  GuardrailCheckRequest,
  GuardrailCheckResponse,
  FollowupSummaryResponse
} from "../../types/care-workflow";
import type {
  AudioTranscriptionResponse,
  CareWorkflowAppResult,
  FollowupSummaryInput,
  TranscribeAudioNoteInput
} from "./shared/types";
import type { CareMindIntent, RoutingDecision } from "./shared/model-routing";
import { buildPrivacyConfig, getCurrentRoutingPlatform, routeIntent } from "./shared/model-routing";
import { TRACK_C_OFFLINE_DEMO } from "./track-c-demo";

import { isPrivacyMode } from "./privacy-mode";
import {
  getModelEntry,
  resolveSelectedModelFilename
} from "./local/model-manager";
import { getMobileModelAvailability } from "./local/mobile-runtime";

import { runCareWorkflowCloud } from "./cloud/care-workflow-cloud";
import { generateFollowupSummaryCloud } from "./cloud/followup-cloud";
import { transcribeAudioNoteCloud } from "./cloud/audio-cloud";

import { runCareWorkflowLocal } from "./local/care-workflow-local";
import { checkGuardrailLocal } from "./local/guardrail-local";
import { generateFollowupSummaryLocal } from "./local/followup-local";
import { transcribeAudioNoteLocal } from "./local/audio-local";

const DAILY_LOG_LOCAL_TIMEOUT_MS = 4_000;

/** True when the currently selected on-device model is ready to serve. */
async function isSelectedLocalModelReady(): Promise<boolean> {
  const filename = await resolveSelectedModelFilename();
  if (!filename) return false;
  return getModelEntry(filename).status === "ready";
}

function localUnavailableError(): Error {
  return new Error("隐私模式已开启，但本机模型尚未就绪。请先在设置里下载本地模型，或明确关闭隐私模式后使用云端整理。");
}

function hasExplicitCloudSummaryConsent(input: FollowupSummaryInput): boolean {
  return input.cloudSummaryAllowed === true && input.rawTextUploadAllowed === true;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function getInferenceRoutingDecision(
  intent: CareMindIntent,
  options: {
    userConfirmedCloud?: boolean;
    networkAvailable?: boolean;
    complexity?: "simple" | "complex";
  } = {}
): Promise<RoutingDecision> {
  const localFirst = await isPrivacyMode();
  const availability = await getMobileModelAvailability().catch(() => null);
  return routeIntent({
    intent,
    platform: getCurrentRoutingPlatform(),
    privacy: buildPrivacyConfig(TRACK_C_OFFLINE_DEMO ? true : localFirst),
    model_availability: availability,
    network_available: TRACK_C_OFFLINE_DEMO ? false : options.networkAvailable,
    user_confirmed_cloud: TRACK_C_OFFLINE_DEMO ? false : options.userConfirmedCloud,
    complexity: options.complexity
  });
}

export async function runCareWorkflow(
  request: CareWorkflowRequest
): Promise<CareWorkflowAppResult> {
  if (TRACK_C_OFFLINE_DEMO) {
    return runCareWorkflowLocal(request);
  }

  const localFirst = await isPrivacyMode();
  const localReady = await isSelectedLocalModelReady().catch(() => false);

  if (!localReady && !localFirst) {
    return runCareWorkflowCloud(request);
  }

  try {
    const localResult = await withTimeout(
      runCareWorkflowLocal(request),
      DAILY_LOG_LOCAL_TIMEOUT_MS,
      "local_daily_log_timeout"
    );
    if (
      localResult.inferenceProvenance?.source === "native_litertlm_success" ||
      localFirst
    ) {
      return localResult;
    }
    return runCareWorkflowCloud(request);
  } catch (error) {
    if (!localFirst) {
      return runCareWorkflowCloud(request);
    }
    throw error;
  }
}

export async function checkGuardrail(
  request: GuardrailCheckRequest
): Promise<GuardrailCheckResponse> {
  // Safety/crisis rules must work offline. Keep this local-first even when the
  // rest of the app can reach cloud.
  return checkGuardrailLocal(request);
}

export async function generateFollowupSummary(
  input: FollowupSummaryInput
): Promise<FollowupSummaryResponse> {
  if (TRACK_C_OFFLINE_DEMO) {
    return generateFollowupSummaryLocal(input);
  }

  const localFirst = await isPrivacyMode();
  if (!localFirst || hasExplicitCloudSummaryConsent(input)) {
    return generateFollowupSummaryCloud(input);
  }
  return generateFollowupSummaryLocal(input);
}

export async function transcribeAudioNote(
  input: TranscribeAudioNoteInput
): Promise<AudioTranscriptionResponse> {
  if (TRACK_C_OFFLINE_DEMO) {
    if (!(await isSelectedLocalModelReady())) throw localUnavailableError();
    return transcribeAudioNoteLocal(input);
  }

  if (await isPrivacyMode()) {
    if (!(await isSelectedLocalModelReady())) throw localUnavailableError();
    return transcribeAudioNoteLocal(input);
  }
  return transcribeAudioNoteCloud(input);
}
