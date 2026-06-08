// The single place that knows both cloud and local exist. Every dispatch
// reads the privacy-mode flag and the model status. When privacy mode is on,
// missing local capability must not silently upload sensitive notes to cloud;
// call sites can catch the explicit local-unavailable error and show a local
// deterministic fallback or ask the user to opt into cloud for this request.
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

import { isPrivacyMode } from "./privacy-mode";
import {
  getModelEntry,
  resolveSelectedModelFilename
} from "./local/model-manager";

import { runCareWorkflowCloud } from "./cloud/care-workflow-cloud";
import { checkGuardrailCloud } from "./cloud/guardrail-cloud";
import { generateFollowupSummaryCloud } from "./cloud/followup-cloud";
import { transcribeAudioNoteCloud } from "./cloud/audio-cloud";

import { runCareWorkflowLocal } from "./local/care-workflow-local";
import { checkGuardrailLocal } from "./local/guardrail-local";
import { generateFollowupSummaryLocal } from "./local/followup-local";
import { transcribeAudioNoteLocal } from "./local/audio-local";

/** True when the currently selected on-device model is ready to serve. */
async function isSelectedLocalModelReady(): Promise<boolean> {
  const filename = await resolveSelectedModelFilename();
  if (!filename) return false;
  return getModelEntry(filename).status === "ready";
}

function localUnavailableError(): Error {
  return new Error("隐私模式已开启，但本机模型尚未就绪。请先在设置里下载本地模型，或明确关闭隐私模式后使用云端整理。");
}

export async function runCareWorkflow(
  request: CareWorkflowRequest
): Promise<CareWorkflowAppResult> {
  if (await isPrivacyMode()) {
    if (!(await isSelectedLocalModelReady())) throw localUnavailableError();
    return runCareWorkflowLocal(request);
  }
  return runCareWorkflowCloud(request);
}

export async function checkGuardrail(
  request: GuardrailCheckRequest
): Promise<GuardrailCheckResponse> {
  if (await isPrivacyMode()) {
    if (!(await isSelectedLocalModelReady())) throw localUnavailableError();
    return checkGuardrailLocal(request);
  }
  return checkGuardrailCloud(request);
}

export async function generateFollowupSummary(
  input: FollowupSummaryInput
): Promise<FollowupSummaryResponse> {
  if (await isPrivacyMode()) {
    if (!(await isSelectedLocalModelReady())) throw localUnavailableError();
    return generateFollowupSummaryLocal(input);
  }
  return generateFollowupSummaryCloud(input);
}

export async function transcribeAudioNote(
  input: TranscribeAudioNoteInput
): Promise<AudioTranscriptionResponse> {
  if (await isPrivacyMode()) {
    if (!(await isSelectedLocalModelReady())) throw localUnavailableError();
    // For audio we do NOT silently fall back: uploading user audio to the
    // backend after a "privacy mode" toggle would be a privacy violation. If
    // the local engine fails, surface the error so the recorder UI can show
    // it and the user can disable privacy mode explicitly if they wish.
    return transcribeAudioNoteLocal(input);
  }
  return transcribeAudioNoteCloud(input);
}
