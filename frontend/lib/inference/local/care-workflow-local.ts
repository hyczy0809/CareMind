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
import type { InferenceProvenance } from "../shared/provenance";
import { hashInferenceOutput } from "../shared/provenance";
import {
  coerceNumberOrNull,
  coerceString,
  coerceStringArray,
  coerceUnknownBoolean,
  parseJsonObject
} from "./json-extract";
import {
  defaultContextTokensForModel,
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
import { TRACK_C_OFFLINE_DEMO } from "../track-c-demo";
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
const DIAGNOSTIC_RISK_PATTERN = /诊断|确诊|病情|恶化|好转|加重|改善|阿尔茨海默|失智/;
const DIAGNOSIS_DECISION_PATTERN = /诊断|确诊|是不是.*?(病|症|阿尔茨海默|失智|痴呆)|得了什么/;
const CRISIS_PATTERN = /失踪|走失|自伤|伤人|呼吸困难|胸痛|意识|昏迷|急救/;
const MEDICATION_DECISION_PATTERN = /换药|加药|减药|停药|改剂量|药量|剂量|处方|要不要.*药|该不该.*药|能不能.*药/;
const TEST_DECISION_PATTERN = /(MRI|CT|核磁|检查|量表).*(要不要|该不该|需不需要|做不做)|(要不要|该不该|需不需要|做不做).*(MRI|CT|核磁|检查|量表)/i;

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

function confidenceScore(level: "low" | "medium" | "high"): number {
  if (level === "high") return 0.9;
  if (level === "medium") return 0.75;
  return 0.5;
}

function structuredLogNotes(note: string, diagnosticRisk: boolean): string[] {
  const notes: string[] = [];
  if (diagnosticRisk) {
    notes.push("记录中包含可能越过医疗判断边界的表达，已作为家属观察保存，不生成医疗结论。");
  }
  if (/停药|换药|加药|减药|补药|药量|剂量|处方/.test(note)) {
    notes.push("记录中包含用药决策相关表达，请在复诊时交给医生判断。");
  }
  if (/MRI|CT|核磁|检查|量表/.test(note) && /要不要|该不该|需不需要/.test(note)) {
    notes.push("记录中包含检查/量表决策相关表达，请整理成复诊问题。");
  }
  return notes;
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
  const behaviorItems = Array.isArray(raw?.behavior)
    ? raw!.behavior!.slice(0, 4).map((item) => ({
        event_type: "general",
        label: coerceString(item.label, "未分类行为"),
        frequency: coerceString(item.frequency, "待确认"),
        severity: "low" as const,
        evidence: coerceString(item.evidence, ""),
        needs_communication_script: false,
        confidence: "low" as const
      }))
    : fallback.behavior.map((item) => ({
        event_type: "general",
        label: item.label,
        frequency: item.frequency,
        severity: "low" as const,
        evidence: item.evidence,
        needs_communication_script: false,
        confidence: "low" as const
      }));
  const fieldConfidence = {
    sleep: confidenceScore(coerceNumberOrNull(sleep.night_wakings) !== null || fallback.sleep.nightWakings !== null ? "medium" : "low"),
    behavior: confidenceScore(behaviorItems.length > 0 ? "medium" : "low"),
    nutrition: confidenceScore(/[饭吃食欲饮水呛咳体重瘦]/.test(note) ? "medium" : "low"),
    medication: confidenceScore(/[药服药拒药漏药]/.test(note) ? "medium" : "low"),
    safety: confidenceScore(/[夜半夜起床开门出去外出走失跌倒摔]/.test(note) ? "medium" : "low"),
    caregiver: confidenceScore(/[撑不住很累崩溃没睡烦躁压力焦虑]/.test(note) ? "medium" : "low")
  };
  const diagnosticRisk = DIAGNOSTIC_RISK_PATTERN.test(note);

  return {
    source_text: note,
    log_date: timestamp(),
    sleep: {
      night_wakings: coerceNumberOrNull(sleep.night_wakings) ?? fallback.sleep.nightWakings,
      note: coerceString(sleep.note, fallback.sleep.note),
      evidence: [],
      confidence: "low"
    },
    behavior: behaviorItems,
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
    },
    field_confidence: fieldConfidence,
    low_confidence_fields: Object.entries(fieldConfidence)
      .filter(([, score]) => score <= 0.6)
      .map(([field]) => field),
    notes_for_caregiver: structuredLogNotes(note, diagnosticRisk),
    diagnostic_risk: diagnosticRisk
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
    speech_text: recommended || not,
    record_suggestion: coerceString(
      raw.record_suggestion,
      "记录触发场景、回应后情绪是否缓和，以及下次是否值得继续尝试。"
    )
  };
}

function buildRuleCommunicationScript(note: string): CommunicationScriptV2 | null {
  if (/偷|钱|丢|找不到/.test(note)) {
    const recommended = "你是不是很担心？我陪你一起找找。";
    return {
      scenario_type: "lost_item_suspicion",
      not_recommended: "没人偷，你别乱想。",
      recommended,
      principle: "先接住情绪，再一起确认事实，避免直接否定。",
      speech_text: recommended,
      record_suggestion: "记录丢失物品、出现时间、找回位置，以及这句话是否让情绪缓和。"
    };
  }
  if (/回家|老家|妈妈|找家人/.test(note)) {
    const recommended = "你是不是有点想念以前熟悉的地方？我陪你坐一会儿。";
    return {
      scenario_type: "wanting_to_go_home",
      not_recommended: "这里就是你家，别再说了。",
      recommended,
      principle: "回应想念和不安，不急着纠正现实地点。",
      speech_text: recommended,
      record_suggestion: "记录出现时段、触发场景、陪伴方式和缓和时间。"
    };
  }
  if (/洗澡|换衣|刷牙|清洁/.test(note)) {
    const recommended = "我们先洗手，等水温舒服了再看要不要继续。";
    return {
      scenario_type: "care_refusal",
      not_recommended: "你必须现在洗，不洗不行。",
      recommended,
      principle: "把任务拆小，给可选择的下一步，减少对抗。",
      speech_text: recommended,
      record_suggestion: "记录拒绝的时间、身体不适线索、可接受的小步骤。"
    };
  }
  if (/吃药|药|拒药|漏药/.test(note)) {
    const recommended = "这颗药我们先放在这里，等你喝口水舒服一点再一起看。";
    return {
      scenario_type: "medication_refusal",
      not_recommended: "你不吃药病就会更严重。",
      recommended,
      principle: "避免威胁式表达，用陪伴和环境提示降低压力。",
      speech_text: recommended,
      record_suggestion: "记录药名、拒绝原因、是否补服，以及是否需要问医生。"
    };
  }
  return null;
}

function normaliseGuardrail(
  raw: LocalCareWorkflowJson["guardrail"] | undefined,
  note: string
): GuardrailResultV2 {
  const ruleGuardrail = localRuleGuardrail(note);
  if (ruleGuardrail.triggered) {
    return ruleGuardrail;
  }

  if (raw && typeof raw === "object") {
    return {
      triggered: !!raw.triggered,
      type: pickEnum(raw.type, VALID_GUARDRAIL_TYPES, "none"),
      message: raw.message ?? null,
      alternative_cta: null
    };
  }
  return ruleGuardrail;
}

function doctorQuestionCta(): NonNullable<GuardrailResultV2["alternative_cta"]> {
  return {
    label: "加入复诊问题",
    action: "create_doctor_question"
  };
}

function localRuleGuardrail(note: string): GuardrailResultV2 {
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
      message: "请不要自行停药、加药或调整剂量；我会把它整理成复诊问题给医生确认。",
      alternative_cta: doctorQuestionCta()
    };
  }
  if (DIAGNOSIS_DECISION_PATTERN.test(note)) {
    return {
      triggered: true,
      type: "diagnosis",
      message: "诊断和病情判断需要医生确认，我可以把观察记录整理给复诊时使用。",
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

async function callGemmaWithRetry(
  prompt: string,
  parse: (text: string) => LocalCareWorkflowJson | null
): Promise<{
  parsed: LocalCareWorkflowJson | null;
  filename: string;
  outputChars: number;
  rawOutput: string;
  latencyMs: number;
  backend: string;
  source: "native_litertlm_success" | "stub_debug";
  nativeGenerateAttempted: boolean;
  nativeGenerateReturned: boolean;
}> {
  const startedAt = Date.now();
  if (TRACK_C_OFFLINE_DEMO) {
    await Gemma.setStubMode(false);
  }
  const filename = await ensureEngine({ maxTokens: DEFAULT_MAX_TOKENS });
  const contextTokens = defaultContextTokensForModel(filename);
  let nativeGenerateAttempted = false;
  nativeGenerateAttempted = true;
  const first = await Gemma.generate(prompt, {
    filename,
    maxTokens: DEFAULT_MAX_TOKENS,
    contextTokens,
    temperature: DEFAULT_TEMPERATURE,
    topK: DEFAULT_TOP_K
  });
  const firstParsed = parse(first.text);
  const firstSource = first.source === "stub_debug" ? "stub_debug" : "native_litertlm_success";
  if (firstParsed) {
    return {
      parsed: firstParsed,
      filename,
      outputChars: first.text.length,
      rawOutput: first.text,
      latencyMs: Date.now() - startedAt,
      backend: first.backend ?? "unknown",
      source: firstSource,
      nativeGenerateAttempted,
      nativeGenerateReturned: first.text.trim().length > 0
    };
  }

  // One retry, asking for the same format only.
  const retryPrompt = `${prompt}\n\n你上一次的回复无法解析。请仅重新输出 ${
    isXmlOutput() ? "XML 标签" : "JSON 对象"
  }本身。`;
  const second = await Gemma.generate(retryPrompt, {
    filename,
    maxTokens: DEFAULT_MAX_TOKENS,
    contextTokens,
    temperature: 0.2,
    topK: DEFAULT_TOP_K
  });
  const rawOutput = `${first.text}\n${second.text}`;
  return {
    parsed: parse(second.text),
    filename,
    outputChars: first.text.length + second.text.length,
    rawOutput,
    latencyMs: Date.now() - startedAt,
    backend: second.backend ?? first.backend ?? "unknown",
    source: second.source === "stub_debug" || firstSource === "stub_debug" ? "stub_debug" : "native_litertlm_success",
    nativeGenerateAttempted,
    nativeGenerateReturned: rawOutput.trim().length > 0
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
          principle: xml.communicationScript.principle,
          record_suggestion: xml.communicationScript.recordSuggestion
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

function composeCareWorkflowResult(input: {
  request: CareWorkflowRequest;
  note: string;
  parsed: LocalCareWorkflowJson | null;
  guardrail: GuardrailResultV2;
  provenance: InferenceProvenance;
  suppressScript?: boolean;
}): CareWorkflowAppResult {
  const { request, note, parsed, guardrail, provenance, suppressScript = false } = input;
  const structured = normaliseStructuredLog(parsed?.structured_log, note);
  const attention = normaliseAttentionItems(parsed?.attention_items, note);
  const memories = normaliseMemoryCandidates(parsed?.memory_candidates, note, request.patient_id);
  const script = suppressScript
    ? null
    : normaliseCommunicationScript(parsed?.communication_script ?? null) ?? buildRuleCommunicationScript(note);

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
    },
    inference_provenance: provenance
  };

  return {
    response,
    structuredLog: mapStructuredLog(structured),
    attentionItems: attention.map(mapAttentionItem),
    memoryItems: memories.map((item) => mapMemoryCandidate(item, request.patient_id)),
    scriptAdvice: script ? mapScriptAdvice(script) : null,
    inferenceProvenance: provenance
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
  let rawOutput = "";
  let errorKind: string | undefined;
  let provenance: InferenceProvenance = {
    source: "rule_local_fallback",
    task: "daily_log",
    modelId: filename,
    backend: "unknown",
    latencyMs: 0,
    engineInitialized: false,
    nativeGenerateAttempted: false,
    nativeGenerateReturned: false,
    rawOutputLength: 0,
    rawOutputHash: null,
    parseSucceeded: false,
    fallbackReason: "not_started"
  };
  const preflightGuardrail = localRuleGuardrail(note);

  if (preflightGuardrail.triggered) {
    provenance = {
      source: "rule_local_fallback",
      task: "daily_log",
      modelId: "rule_local_guardrail",
      backend: "none",
      latencyMs: Date.now() - startedAt,
      engineInitialized: false,
      nativeGenerateAttempted: false,
      nativeGenerateReturned: false,
      rawOutputLength: 0,
      rawOutputHash: null,
      parseSucceeded: true,
      fallbackReason: "rule_guardrail_preflight"
    };
    void reportOnDeviceInference({
      task: "care_workflow",
      modelId: provenance.modelId,
      success: true,
      elapsedMs: provenance.latencyMs,
      inputChars: note.length,
      outputChars: 0,
      fellBack: true,
      errorKind: provenance.fallbackReason ?? undefined,
      source: provenance.source,
      backend: provenance.backend,
      rawOutputHash: provenance.rawOutputHash
    });
    return composeCareWorkflowResult({
      request,
      note,
      parsed: null,
      guardrail: preflightGuardrail,
      provenance,
      suppressScript: true
    });
  }

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
    rawOutput = result.rawOutput;
    const trackCStubBlocked = TRACK_C_OFFLINE_DEMO && result.source === "stub_debug";
    if (trackCStubBlocked) {
      parsed = null;
      errorKind = "stub_debug_disabled_in_track_c";
    }
    if (!parsed && !errorKind) errorKind = result.nativeGenerateReturned ? `${LOCAL_OUTPUT_FORMAT}_parse_failed` : "native_empty_output";
    provenance = {
      source: result.source === "stub_debug"
        ? (TRACK_C_OFFLINE_DEMO ? "unavailable" : "stub_debug")
        : parsed
          ? "native_litertlm_success"
          : result.nativeGenerateReturned
            ? "native_litertlm_parse_fallback"
            : "rule_local_fallback",
      task: "daily_log",
      modelId: filename,
      backend: result.backend,
      latencyMs: result.latencyMs,
      engineInitialized: result.source !== "stub_debug",
      nativeGenerateAttempted: result.nativeGenerateAttempted,
      nativeGenerateReturned: result.nativeGenerateReturned,
      rawOutputLength: rawOutput.length,
      rawOutputHash: hashInferenceOutput(rawOutput),
      parseSucceeded: !!parsed,
      fallbackReason: parsed
        ? null
        : result.source === "stub_debug" && TRACK_C_OFFLINE_DEMO
          ? "stub_debug_disabled_in_track_c"
          : result.nativeGenerateReturned
          ? `${LOCAL_OUTPUT_FORMAT}_parse_failed`
          : "native_empty_output"
    };
  } catch (error) {
    console.warn("[local] runCareWorkflow Gemma failure, falling back", error);
    errorKind = error instanceof Error ? error.message.slice(0, 60) : "engine_error";
    parsed = null;
    const trackCModelUnavailable = TRACK_C_OFFLINE_DEMO && (
      errorKind.includes("本地模型未就绪") ||
      errorKind.includes("当前选中的本地模型未就绪") ||
      errorKind.includes("尚未选择本地模型") ||
      errorKind.includes("本地推理运行时初始化失败") ||
      errorKind.includes("Selected on-device model is not ready")
    );
    provenance = {
      source: trackCModelUnavailable ? "unavailable" : "rule_local_fallback",
      task: "daily_log",
      modelId: filename,
      backend: "unknown",
      latencyMs: Date.now() - startedAt,
      engineInitialized: false,
      nativeGenerateAttempted: false,
      nativeGenerateReturned: false,
      rawOutputLength: 0,
      rawOutputHash: null,
      parseSucceeded: false,
      fallbackReason: trackCModelUnavailable
        ? "本地模型未就绪，请先下载/导入并运行离线验证。当前结果只是本地规则兜底，不代表 Gemma 4 推理。"
        : errorKind
    };
  }

  const fellBack = provenance.source !== "native_litertlm_success";
  console.log(
    `[local] care_workflow provenance source=${provenance.source} model=${provenance.modelId} backend=${provenance.backend} nativeAttempted=${provenance.nativeGenerateAttempted} nativeReturned=${provenance.nativeGenerateReturned} parse=${provenance.parseSucceeded} rawLen=${provenance.rawOutputLength} rawHash=${provenance.rawOutputHash ?? "none"} latencyMs=${provenance.latencyMs}`
  );

  void reportOnDeviceInference({
    task: "care_workflow",
    modelId: filename,
    success: !fellBack,
    elapsedMs: Date.now() - startedAt,
    inputChars: note.length,
    outputChars,
    fellBack,
    errorKind,
    source: provenance.source,
    backend: provenance.backend,
    rawOutputHash: provenance.rawOutputHash
  });

  const guardrail = normaliseGuardrail(parsed?.guardrail, note);

  return composeCareWorkflowResult({
    request,
    note,
    parsed,
    guardrail,
    provenance
  });
}
