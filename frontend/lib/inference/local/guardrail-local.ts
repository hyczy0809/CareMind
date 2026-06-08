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
import { DEFAULT_TOP_K } from "./constants";
import { reportOnDeviceInference } from "./telemetry";

const VALID_TYPES: GuardrailType[] = [
  "none",
  "diagnosis",
  "medication",
  "imaging_or_test",
  "crisis",
  "emergency"
];

function regexGuardrail(note: string): GuardrailResultV2 {
  if (/失踪|走失|自伤|伤人|呼吸困难|胸痛|意识/.test(note)) {
    return {
      triggered: true,
      type: "crisis",
      message: "记录中出现急性危险信号，建议立刻拨打 120 或前往急诊。",
      alternative_cta: null
    };
  }
  if (/诊断|是不是.*?症|得了什么/.test(note)) {
    return {
      triggered: true,
      type: "diagnosis",
      message: "诊断需要医生判断，建议把这条记录带到复诊时与医生确认。",
      alternative_cta: null
    };
  }
  if (/换药|加药|减药|停药|改剂量/.test(note)) {
    return {
      triggered: true,
      type: "medication",
      message: "用药调整需医生评估，请勿自行变更。可在复诊时与医生沟通。",
      alternative_cta: null
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
  let parsed: LocalGuardrailJson | null = null;
  let filename = "unknown";
  let outputChars = 0;
  let errorKind: string | undefined;

  try {
    filename = await ensureEngine();
    const xmlMode = isXmlOutput();
    const prompt = xmlMode
      ? buildGuardrailXmlPrompt(request.note)
      : buildGuardrailPrompt(request.note);
    const result = await Gemma.generate(prompt, {
      filename,
      maxTokens: 256,
      temperature: 0.2,
      topK: DEFAULT_TOP_K
    });
    outputChars = result.text.length;

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

  const guardrail: GuardrailResultV2 = parsed
    ? {
        triggered: !!parsed.triggered,
        type: VALID_TYPES.includes(parsed.type as GuardrailType)
          ? (parsed.type as GuardrailType)
          : "none",
        message: coerceString(parsed.message ?? "", "") || null,
        alternative_cta: null
      }
    : regexGuardrail(request.note);

  void reportOnDeviceInference({
    task: "guardrail",
    modelId: filename,
    success: parsed !== null,
    elapsedMs: Date.now() - startedAt,
    inputChars: request.note.length,
    outputChars,
    fellBack: parsed === null,
    errorKind
  });

  return {
    checked_at: new Date().toISOString(),
    patient_id: request.patient_id ?? "",
    caregiver_id: request.caregiver_id ?? "",
    guardrail
  };
}
