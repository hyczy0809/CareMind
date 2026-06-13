// On-device guardrail check. Gemma is asked for a tiny object; if anything
// fails, fall back to a regex heuristic so the soft-block still triggers on
// obvious crises.

import type {
  GuardrailCheckRequest,
  GuardrailCheckResponse,
  GuardrailResultV2,
  GuardrailType
} from "../../../types/care-workflow";
import { Gemma } from "./gemma-native";
import { ensureEngine } from "./model-manager";
import { parseJsonObject, coerceString } from "./json-extract";
import { buildGuardrailPrompt, type LocalGuardrailJson } from "./prompts";
import { buildGuardrailXmlPrompt } from "./prompts-xml";
import { parseGuardrailXml } from "./xml-parsers";
import { isXmlOutput, LOCAL_OUTPUT_FORMAT } from "./format-config";
import { defaultContextTokensForModel, DEFAULT_TOP_K } from "./constants";
import { reportOnDeviceInference } from "./telemetry";
import { TRACK_C_OFFLINE_DEMO } from "../track-c-demo";

const VALID_TYPES: GuardrailType[] = [
  "none",
  "diagnosis",
  "medication",
  "imaging_or_test",
  "crisis",
  "emergency"
];

const VALID_CTA_ACTIONS: Array<NonNullable<GuardrailResultV2["alternative_cta"]>["action"]> = [
  "create_doctor_question",
  "open_emergency_support",
  "save_observation",
  "open_followup_prep"
];

const CRISIS_PATTERN = /失踪|走失|自伤|伤人|呼吸困难|胸痛|意识|昏迷|急救/;
const DIAGNOSIS_PATTERN = /诊断|确诊|恶化|加重|是不是.*?(病|症|阿尔茨海默|失智|痴呆)|得了什么|什么病|报告.*说明.*(病|问题|结果)/;
const MEDICATION_DECISION_PATTERN = /换药|加药|减药|停药|改剂量|药量|剂量|处方|要不要.*药|该不该.*药|能不能.*药/;
const TEST_DECISION_PATTERN = /(MRI|CT|核磁|检查|量表).*(要不要|该不该|需不需要|做不做)|(要不要|该不该|需不需要|做不做).*(MRI|CT|核磁|检查|量表)/i;

function doctorQuestionCta(): NonNullable<GuardrailResultV2["alternative_cta"]> {
  return {
    label: "加入复诊问题",
    action: "create_doctor_question"
  };
}

function normaliseAlternativeCta(raw: LocalGuardrailJson["alternative_cta"]): GuardrailResultV2["alternative_cta"] {
  if (!raw || typeof raw !== "object") return null;
  const action = raw.action;
  if (!action || !VALID_CTA_ACTIONS.includes(action as NonNullable<GuardrailResultV2["alternative_cta"]>["action"])) {
    return null;
  }
  const label = coerceString(raw.label ?? "", "");
  return {
    label: label || "保存为复诊问题",
    action: action as NonNullable<GuardrailResultV2["alternative_cta"]>["action"]
  };
}

function regexGuardrail(note: string): GuardrailResultV2 {
  if (CRISIS_PATTERN.test(note)) {
    return {
      triggered: true,
      type: "crisis",
      message: "记录中出现急性危险信号，建议立刻拨打 120 或前往急诊。",
      alternative_cta: {
        label: "查看紧急建议",
        action: "open_emergency_support"
      }
    };
  }
  if (MEDICATION_DECISION_PATTERN.test(note)) {
    return {
      triggered: true,
      type: "medication",
      message: "请不要自行停药、加药或调整剂量；我可以把这个问题整理进复诊问题清单。",
      alternative_cta: doctorQuestionCta()
    };
  }
  if (DIAGNOSIS_PATTERN.test(note)) {
    return {
      triggered: true,
      type: "diagnosis",
      message: "诊断需要医生判断，建议把这条记录带到复诊时与医生确认。",
      alternative_cta: doctorQuestionCta()
    };
  }
  if (TEST_DECISION_PATTERN.test(note)) {
    return {
      triggered: true,
      type: "imaging_or_test",
      message: "检查项目需要医生结合病情判断，我可以先把问题整理给复诊时确认。",
      alternative_cta: doctorQuestionCta()
    };
  }
  return {
    triggered: false,
    type: "none",
    message: null,
    alternative_cta: null
  };
}

export async function checkGuardrailLocal(
  request: GuardrailCheckRequest
): Promise<GuardrailCheckResponse> {
  const startedAt = Date.now();
  const preflightRule = regexGuardrail(request.note);
  if (preflightRule.triggered) {
    void reportOnDeviceInference({
      task: "guardrail",
      modelId: "rule_local_guardrail",
      success: true,
      elapsedMs: Date.now() - startedAt,
      inputChars: request.note.length,
      outputChars: 0,
      fellBack: true,
      errorKind: "rule_guardrail_preflight",
      source: "rule_local_fallback"
    });
    return {
      checked_at: new Date().toISOString(),
      patient_id: request.patient_id ?? "",
      caregiver_id: request.caregiver_id ?? "",
      guardrail: preflightRule
    };
  }

  let parsed: LocalGuardrailJson | null = null;
  let filename = "unknown";
  let outputChars = 0;
  let errorKind: string | undefined;
  let nativeReturned = false;

  try {
    if (TRACK_C_OFFLINE_DEMO) {
      await Gemma.setStubMode(false);
    }
    filename = await ensureEngine();
    const contextTokens = defaultContextTokensForModel(filename);
    const xmlMode = isXmlOutput();
    const prompt = xmlMode
      ? buildGuardrailXmlPrompt(request.note)
      : buildGuardrailPrompt(request.note);
    const result = await Gemma.generate(prompt, {
      filename,
      maxTokens: 256,
      contextTokens,
      temperature: 0.2,
      topK: DEFAULT_TOP_K
    });
    outputChars = result.text.length;
    nativeReturned = result.text.trim().length > 0;

    if (TRACK_C_OFFLINE_DEMO && result.source === "stub_debug") {
      nativeReturned = false;
      throw new Error("stub_debug_disabled_in_track_c");
    }

    if (xmlMode) {
      const xml = parseGuardrailXml(result.text);
      if (xml) {
        parsed = {
          triggered: xml.triggered,
          type: xml.type,
          message: xml.message,
          alternative_cta: xml.alternativeCta
            ? { label: xml.alternativeCta.label, action: xml.alternativeCta.action }
            : null
        };
      }
    } else {
      parsed = parseJsonObject<LocalGuardrailJson>(result.text);
    }
    if (!parsed) errorKind = `${LOCAL_OUTPUT_FORMAT}_parse_failed`;
  } catch (error) {
    console.warn("[local] checkGuardrail Gemma failure, falling back", error);
    errorKind = error instanceof Error ? error.message.slice(0, 60) : "engine_error";
  }

  const ruleGuardrail = preflightRule;
  const ruleOverride = ruleGuardrail.triggered;
  const guardrail: GuardrailResultV2 = ruleGuardrail.triggered
    ? ruleGuardrail
    : parsed
      ? {
        triggered: !!parsed.triggered,
        type: VALID_TYPES.includes(parsed.type as GuardrailType)
          ? (parsed.type as GuardrailType)
          : "none",
        message: coerceString(parsed.message ?? "", "") || null,
        alternative_cta: normaliseAlternativeCta(parsed.alternative_cta)
      }
      : ruleGuardrail;

  void reportOnDeviceInference({
    task: "guardrail",
    modelId: filename,
    success: parsed !== null,
    elapsedMs: Date.now() - startedAt,
    inputChars: request.note.length,
    outputChars,
    fellBack: parsed === null || ruleOverride,
    errorKind,
    source: ruleOverride
      ? "rule_local_fallback"
      : parsed
      ? "native_litertlm_success"
      : nativeReturned
        ? "native_litertlm_parse_fallback"
        : "rule_local_fallback"
  });

  return {
    checked_at: new Date().toISOString(),
    patient_id: request.patient_id ?? "",
    caregiver_id: request.caregiver_id ?? "",
    guardrail
  };
}
