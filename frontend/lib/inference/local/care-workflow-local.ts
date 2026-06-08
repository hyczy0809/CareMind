// On-device implementation of runCareWorkflow. Asks Gemma for a small V2
// shape, runs the same v2-mappers as the cloud path, and falls back to the
// deterministic regex builders if the model misbehaves. The fallback path
// guarantees the call site never throws in privacy mode unless the engine
// itself is dead — degraded results are still useful results.

import type {
  CareWorkflowRequest,
  CareWorkflowResponse,
  StructuredLogV2,
  AttentionItemV2,
  MemoryCandidateV2,
  CommunicationScriptV2,
  GuardrailResultV2,
  GuardrailType,
  CareSeverity
} from "../../../types/care-workflow";
import {
  mapAttentionItem,
  mapMemoryCandidate,
  mapScriptAdvice,
  mapStructuredLog
} from "../shared/v2-mappers";
import type { CareWorkflowAppResult } from "../shared/types";
import {
  coerceNumberOrNull,
  coerceString,
  coerceStringArray,
  coerceUnknownBoolean,
  parseJsonObject
} from "./json-extract";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_K
} from "./constants";
import { ensureEngine } from "./model-manager";
import { Gemma } from "./gemma-native";
import { reportOnDeviceInference } from "./telemetry";
import { buildCareWorkflowPrompt, type LocalCareWorkflowJson } from "./prompts";
import { buildCareWorkflowXmlPrompt, type LocalCareWorkflowXml } from "./prompts-xml";
import { parseCareWorkflowXml } from "./xml-parsers";
import { isXmlOutput, LOCAL_OUTPUT_FORMAT } from "./format-config";
import {
  buildAttentionItems,
  buildMemoryCandidate,
  buildStructuredLog
} from "./fallback-builders";
import { toAttentionItemV2 } from "../shared/v2-mappers";
import type { AttentionItem, MemoryItem } from "../../../types/caremind";

const VALID_SEVERITIES: CareSeverity[] = ["low", "medium", "high", "crisis"];
const VALID_ATTENTION_TYPES: AttentionItemV2["type"][] = [
  "night_safety",
  "nutrition",
  "medication",
  "wandering",
  "caregiver",
  "behavior"
];
const VALID_MEMORY_TYPES: MemoryCandidateV2["type"][] = [
  "behavior_pattern",
  "effective_strategy",
  "ineffective_strategy",
  "medication_observation",
  "caregiver_support",
  "communication_preference"
];
const VALID_GUARDRAIL_TYPES: GuardrailType[] = [
  "none",
  "diagnosis",
  "medication",
  "imaging_or_test",
  "crisis",
  "emergency"
];

function ensureSeverity(value: unknown): CareSeverity {
  return VALID_SEVERITIES.includes(value as CareSeverity) ? (value as CareSeverity) : "low";
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 10);
}

function timestamp(): string {
  return new Date().toISOString();
}

function normaliseStructuredLog(
  raw: LocalCareWorkflowJson["structured_log"] | undefined,
  note: string
): StructuredLogV2 {
  const fallback = buildStructuredLog(note);
  const sleep = raw?.sleep ?? {};
  const nutrition = raw?.nutrition ?? {};
  const medication = raw?.medication ?? {};
  const safety = raw?.safety ?? {};
  const caregiver = raw?.caregiver ?? {};

  return {
    source_text: note,
    log_date: timestamp(),
    sleep: {
      night_wakings: coerceNumberOrNull(sleep.night_wakings) ?? fallback.sleep.nightWakings,
      note: coerceString(sleep.note, fallback.sleep.note),
      evidence: [],
      confidence: "low"
    },
    behavior: Array.isArray(raw?.behavior)
      ? raw!.behavior!.slice(0, 4).map((item) => ({
          event_type: "general",
          label: coerceString(item.label, "未分类行为"),
          frequency: coerceString(item.frequency, "待确认"),
          severity: "low",
          evidence: coerceString(item.evidence, ""),
          needs_communication_script: false,
          confidence: "low"
        }))
      : fallback.behavior.map((item) => ({
          event_type: "general",
          label: item.label,
          frequency: item.frequency,
          severity: "low" as const,
          evidence: item.evidence,
          needs_communication_script: false,
          confidence: "low" as const
        })),
    nutrition: {
      meal_intake: pickEnum(
        nutrition.meal_intake,
        ["normal", "less", "few_bites", "refused", "unknown"],
        fallback.nutrition.mealIntake
      ),
      water_intake: pickEnum(
        nutrition.water_intake,
        ["normal", "less", "more", "unknown"],
        fallback.nutrition.waterIntake
      ),
      choking: coerceUnknownBoolean(nutrition.choking ?? fallback.nutrition.choking),
      weight_change: pickEnum(
        nutrition.weight_change,
        ["loss", "gain", "stable", "unknown"],
        fallback.nutrition.weightChange
      ),
      note: coerceString(nutrition.note, fallback.nutrition.note),
      evidence: [],
      confidence: "low"
    },
    medication: {
      mentioned: typeof medication.mentioned === "boolean" ? medication.mentioned : fallback.medication.mentioned,
      refusal_count: coerceNumberOrNull(medication.refusal_count) ?? fallback.medication.refusalCount,
      missed_dose: coerceUnknownBoolean(medication.missed_dose ?? fallback.medication.missedDose),
      duplicate_dose: coerceUnknownBoolean(medication.duplicate_dose ?? fallback.medication.duplicateDose),
      medication_names: coerceStringArray(medication.medication_names),
      note: coerceString(medication.note, fallback.medication.note),
      evidence: [],
      confidence: "low"
    },
    safety: {
      night_wandering: coerceUnknownBoolean(safety.night_wandering ?? fallback.safety.nightWandering),
      door_exit_attempt: coerceUnknownBoolean(safety.door_exit_attempt ?? fallback.safety.doorExitAttempt),
      fall: coerceUnknownBoolean(safety.fall ?? fallback.safety.fall),
      wandering: coerceUnknownBoolean(safety.wandering ?? fallback.safety.wandering),
      acute_danger:
        typeof safety.acute_danger === "boolean" ? safety.acute_danger : fallback.safety.acuteDanger,
      note: coerceString(safety.note, fallback.safety.note),
      evidence: [],
      confidence: "low"
    },
    caregiver: {
      quote: coerceString(caregiver.quote, fallback.caregiver.quote),
      sleep_hours_bucket: "unknown",
      mood_score: null,
      support_today: "unknown",
      personal_time: null,
      stress_level: fallback.caregiver.stressSignal
        ? ensureSeverity(caregiver.stress_level ?? "high")
        : ensureSeverity(caregiver.stress_level ?? "low"),
      evidence: [],
      confidence: "low"
    }
  };
}

function normaliseAttentionItems(
  raw: LocalCareWorkflowJson["attention_items"] | undefined,
  note: string
): AttentionItemV2[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.slice(0, 5).map((item, idx) => ({
      id: `local_att_${Date.now()}_${idx}_${randomSuffix()}`,
      type: pickEnum(item.type, VALID_ATTENTION_TYPES, "behavior"),
      severity: ensureSeverity(item.severity),
      title: coerceString(item.title, "请关注"),
      evidence: coerceString(item.evidence, ""),
      doctor_feedback_hint: coerceString(item.doctor_feedback_hint, "如有疑问，可在复诊时告知医生。"),
      actions: Array.isArray(item.actions)
        ? item.actions.slice(0, 4).map((action, aIdx) => ({
            id: coerceString(action.id, `action_${idx}_${aIdx}`),
            label: coerceString(action.label, "记录详情"),
            status: "pending",
            blocked_reason: null,
            alternative_label: coerceString(action.alternative_label, "") || null
          }))
        : []
    }));
  }

  // No usable items from the model — fall back to deterministic builder.
  const items: AttentionItem[] = buildAttentionItems(note);
  return items.map((item) => toAttentionItemV2(item));
}

function normaliseMemoryCandidates(
  raw: LocalCareWorkflowJson["memory_candidates"] | undefined,
  note: string,
  patientId: string
): MemoryCandidateV2[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.slice(0, 3).map((item, idx) => ({
      id: `local_mem_${Date.now()}_${idx}_${randomSuffix()}`,
      type: pickEnum(item.type, VALID_MEMORY_TYPES, "behavior_pattern"),
      title: coerceString(item.title, "可观察的模式"),
      description: coerceString(item.description, ""),
      evidence: coerceStringArray(item.evidence),
      requires_confirmation: item.requires_confirmation !== false
    }));
  }

  // Fallback: deterministic candidate derived from regex
  const candidate: MemoryItem | null = buildMemoryCandidate(patientId, note);
  if (!candidate) return [];
  return [
    {
      id: candidate.id,
      type: candidate.type,
      title: candidate.title,
      description: candidate.description,
      evidence: candidate.evidence,
      requires_confirmation: candidate.requiresConfirmation
    }
  ];
}

function normaliseCommunicationScript(
  raw: LocalCareWorkflowJson["communication_script"] | undefined
): CommunicationScriptV2 | null {
  if (!raw) return null;
  const recommended = coerceString(raw.recommended, "");
  const not = coerceString(raw.not_recommended, "");
  if (!recommended && !not) return null;

  return {
    scenario_type: "general",
    not_recommended: not,
    recommended,
    principle: coerceString(raw.principle, "保持温和、提供选择、避免对抗。"),
    speech_text: recommended || not
  };
}

function normaliseGuardrail(
  raw: LocalCareWorkflowJson["guardrail"] | undefined,
  note: string
): GuardrailResultV2 {
  if (raw && typeof raw === "object") {
    return {
      triggered: !!raw.triggered,
      type: pickEnum(raw.type, VALID_GUARDRAIL_TYPES, "none"),
      message: raw.message ?? null,
      alternative_cta: null
    };
  }
  // Fallback: regex hint
  const acute = /失踪|走失|自伤|伤人|呼吸困难|胸痛|意识/.test(note);
  return {
    triggered: acute,
    type: acute ? "crisis" : "none",
    message: acute ? "记录中出现急性危险信号，建议立刻拨打 120 或前往急诊。" : null,
    alternative_cta: null
  };
}

async function callGemmaWithRetry(
  prompt: string,
  parse: (text: string) => LocalCareWorkflowJson | null
): Promise<{ parsed: LocalCareWorkflowJson | null; filename: string; outputChars: number }> {
  const filename = await ensureEngine();
  const first = await Gemma.generate(prompt, {
    filename,
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: DEFAULT_TEMPERATURE,
    topK: DEFAULT_TOP_K
  });
  const firstParsed = parse(first.text);
  if (firstParsed) return { parsed: firstParsed, filename, outputChars: first.text.length };

  // One retry, asking for the same format only.
  const retryPrompt = `${prompt}\n\n你上一次的回复无法解析。请仅重新输出 ${
    isXmlOutput() ? "XML 标签" : "JSON 对象"
  }本身。`;
  const second = await Gemma.generate(retryPrompt, {
    filename,
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: 0.2,
    topK: DEFAULT_TOP_K
  });
  return {
    parsed: parse(second.text),
    filename,
    outputChars: first.text.length + second.text.length
  };
}

/**
 * Re-shape an XML parse result into the snake_case `LocalCareWorkflowJson`
 * shape that the existing `normalise…` functions consume. Lets us reuse the
 * JSON-side normalisation/validation without a parallel pipeline.
 */
function xmlToJsonShape(xml: LocalCareWorkflowXml): LocalCareWorkflowJson {
  const slog = xml.structuredLog;
  return {
    structured_log: slog
      ? {
          sleep: slog.sleep
            ? { night_wakings: slog.sleep.nightWakings ?? null, note: slog.sleep.note }
            : undefined,
          behavior: slog.behavior
            ? slog.behavior.map((b) => ({
                label: b.label,
                evidence: b.evidence,
                frequency: b.frequency
              }))
            : undefined,
          nutrition: slog.nutrition
            ? {
                meal_intake: slog.nutrition.mealIntake,
                water_intake: slog.nutrition.waterIntake,
                choking: slog.nutrition.choking,
                weight_change: slog.nutrition.weightChange,
                note: slog.nutrition.note
              }
            : undefined,
          medication: slog.medication
            ? {
                mentioned: slog.medication.mentioned,
                refusal_count: slog.medication.refusalCount ?? null,
                missed_dose: slog.medication.missedDose,
                duplicate_dose: slog.medication.duplicateDose,
                medication_names: slog.medication.medicationNames,
                note: slog.medication.note
              }
            : undefined,
          safety: slog.safety
            ? {
                night_wandering: slog.safety.nightWandering,
                door_exit_attempt: slog.safety.doorExitAttempt,
                fall: slog.safety.fall,
                wandering: slog.safety.wandering,
                acute_danger: slog.safety.acuteDanger,
                note: slog.safety.note
              }
            : undefined,
          caregiver: slog.caregiver
            ? { quote: slog.caregiver.quote, stress_level: slog.caregiver.stressLevel }
            : undefined
        }
      : undefined,
    attention_items: xml.attentionItems?.map((item) => ({
      type: item.type,
      severity: item.severity,
      title: item.title,
      evidence: item.evidence,
      doctor_feedback_hint: item.doctorFeedbackHint,
      actions: item.actions?.map((a) => ({
        label: a.label,
        alternative_label: a.alternativeLabel
      }))
    })),
    memory_candidates: xml.memoryCandidates?.map((c) => ({
      type: c.type,
      title: c.title,
      description: c.description,
      evidence: c.evidence,
      requires_confirmation: c.requiresConfirmation
    })),
    communication_script: xml.communicationScript
      ? {
          not_recommended: xml.communicationScript.notRecommended,
          recommended: xml.communicationScript.recommended,
          principle: xml.communicationScript.principle
        }
      : null,
    guardrail: xml.guardrail
      ? {
          triggered: xml.guardrail.triggered,
          type: xml.guardrail.type,
          message: xml.guardrail.message
        }
      : undefined
  };
}

export async function runCareWorkflowLocal(
  request: CareWorkflowRequest
): Promise<CareWorkflowAppResult> {
  const note = request.note;
  const startedAt = Date.now();
  let parsed: LocalCareWorkflowJson | null = null;
  let filename = "unknown";
  let outputChars = 0;
  let errorKind: string | undefined;

  try {
    const xmlMode = isXmlOutput();
    const prompt = xmlMode
      ? buildCareWorkflowXmlPrompt(note)
      : buildCareWorkflowPrompt(note);
    const parse = xmlMode
      ? (text: string) => {
          const x = parseCareWorkflowXml(text);
          return x ? xmlToJsonShape(x) : null;
        }
      : (text: string) => parseJsonObject<LocalCareWorkflowJson>(text);

    const result = await callGemmaWithRetry(prompt, parse);
    parsed = result.parsed;
    filename = result.filename;
    outputChars = result.outputChars;
    if (!parsed) errorKind = `${LOCAL_OUTPUT_FORMAT}_parse_failed`;
  } catch (error) {
    console.warn("[local] runCareWorkflow Gemma failure, falling back", error);
    errorKind = error instanceof Error ? error.message.slice(0, 60) : "engine_error";
    parsed = null;
  }

  const fellBack = parsed === null;

  void reportOnDeviceInference({
    task: "care_workflow",
    modelId: filename,
    success: !fellBack,
    elapsedMs: Date.now() - startedAt,
    inputChars: note.length,
    outputChars,
    fellBack,
    errorKind
  });

  const structured = normaliseStructuredLog(parsed?.structured_log, note);
  const attention = normaliseAttentionItems(parsed?.attention_items, note);
  const memories = normaliseMemoryCandidates(parsed?.memory_candidates, note, request.patient_id);
  const script = normaliseCommunicationScript(parsed?.communication_script ?? null);
  const guardrail = normaliseGuardrail(parsed?.guardrail, note);

  const response: CareWorkflowResponse = {
    workflow_id: `local_wf_${Date.now()}_${randomSuffix()}`,
    status: "ok",
    patient_id: request.patient_id,
    caregiver_id: request.caregiver_id,
    generated_at: timestamp(),
    guardrail,
    structured_log: structured,
    attention_items: attention,
    communication_script: script,
    caregiver_support: null,
    memory_candidates: memories,
    followup_patch: null,
    analytics_context: {
      event_count: attention.length,
      high_attention_count: attention.filter((item) => item.severity === "high" || item.severity === "crisis").length,
      guardrail_type: guardrail.type,
      memory_candidate_count: memories.length
    }
  };

  return {
    response,
    structuredLog: mapStructuredLog(structured),
    attentionItems: attention.map(mapAttentionItem),
    memoryItems: memories.map((item) => mapMemoryCandidate(item, request.patient_id)),
    scriptAdvice: script ? mapScriptAdvice(script) : null
  };
}
