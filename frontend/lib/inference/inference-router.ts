// The single place that knows both cloud and local exist. Every dispatch
// reads the privacy-mode flag and the model status; on local failure or
// missing model we silently fall back to cloud (degraded mode), and the
// settings UI shows a banner so the user knows.
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

/** True when privacy mode is on AND the currently selected on-device model
 *  is ready to serve. */
async function shouldUseLocal(): Promise<boolean> {
  if (!(await isPrivacyMode())) return false;
  const filename = await resolveSelectedModelFilename();
  if (!filename) return false;
  return getModelEntry(filename).status === "ready";
}

async function withLocalFallback<T>(local: () => Promise<T>, cloud: () => Promise<T>): Promise<T> {
  try {
    return await local();
  } catch (error) {
    console.warn("[router] local inference failed, falling back to cloud", error);
    return cloud();
  }
}

export async function runCareWorkflow(
  request: CareWorkflowRequest
): Promise<CareWorkflowAppResult> {
  if (await shouldUseLocal()) {
    return withLocalFallback(() => runCareWorkflowLocal(request), () => runCareWorkflowCloud(request));
  }
  return runCareWorkflowCloud(request);
}

export async function checkGuardrail(
  request: GuardrailCheckRequest
): Promise<GuardrailCheckResponse> {
  if (await shouldUseLocal()) {
    return withLocalFallback(() => checkGuardrailLocal(request), () => checkGuardrailCloud(request));
  }
  return checkGuardrailCloud(request);
}

export async function generateFollowupSummary(
  input: FollowupSummaryInput
): Promise<FollowupSummaryResponse> {
  if (await shouldUseLocal()) {
    return withLocalFallback(
      () => generateFollowupSummaryLocal(input),
      () => generateFollowupSummaryCloud(input)
    );
  }
  return generateFollowupSummaryCloud(input);
}

export async function transcribeAudioNote(
  input: TranscribeAudioNoteInput
): Promise<AudioTranscriptionResponse> {
  if (await shouldUseLocal()) {
    // For audio we do NOT silently fall back: uploading user audio to the
    // backend after a "privacy mode" toggle would be a privacy violation. If
    // the local engine fails, surface the error so the recorder UI can show
    // it and the user can disable privacy mode explicitly if they wish.
    return transcribeAudioNoteLocal(input);
  }
  return transcribeAudioNoteCloud(input);
}
