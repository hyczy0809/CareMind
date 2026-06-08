// On-device follow-up summary. Gemma generates the soft fields (bullets /
// questions / strategies); we deterministically compute readiness and metrics
// in TS since those are simple counts.

import type {
  FollowupReadinessLevel,
  FollowupReadinessV2,
  FollowupSummaryResponse,
  ReportMetricV2
} from "../../../types/care-workflow";
import type { FollowupSummaryInput } from "../shared/types";
import { Gemma } from "./gemma-native";
import { ensureEngine } from "./model-manager";
import { parseJsonObject, coerceString, coerceStringArray } from "./json-extract";
import { buildFollowupPrompt, type LocalFollowupJson } from "./prompts";
import { buildFollowupXmlPrompt, type LocalFollowupXml } from "./prompts-xml";
import { parseFollowupXml } from "./xml-parsers";
import { isXmlOutput, LOCAL_OUTPUT_FORMAT } from "./format-config";
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, DEFAULT_TOP_K } from "./constants";
import { reportOnDeviceInference } from "./telemetry";

function computeReadiness(recordCount: number): FollowupReadinessV2 {
  let level: FollowupReadinessLevel = "empty";
  let message = "近期还没有照护记录，先在“智能记录”里保存一两条。";
  if (recordCount >= 3) {
    level = "ready";
    message = "近期已有足够记录，可以生成完整的复诊摘要。";
  } else if (recordCount >= 1) {
    level = "early";
    message = "已开始记录，再保存几条会让摘要更完整。";
  }
  return { level, record_count: recordCount, message };
}

function buildFallback(input: FollowupSummaryInput): {
  metrics: ReportMetricV2[];
  followup_patch: LocalFollowupJson["followup_patch"];
  tried_strategies: string[];
  boundary_notice: string;
} {
  const high = input.attentionItems.filter(
    (item) => item.severity === "high" || item.severity === "crisis"
  ).length;
  const nightCount = input.attentionItems.filter((item) => item.type === "night_safety").length;
  const medicationCount = input.attentionItems.filter((item) => item.type === "medication").length;
  const remembered = input.memoryItems.filter((item) => item.status === "confirmed").length;

  const summaryBullets: string[] = [];
  if (input.recordCount > 0) summaryBullets.push(`近期已保存 ${input.recordCount} 条照护记录。`);
  if (high > 0) summaryBullets.push(`其中 ${high} 条为高优先级关注事项。`);
  if (nightCount > 0) summaryBullets.push("出现夜间起床或安全相关线索。");
  if (medicationCount > 0) summaryBullets.push("出现服药、拒药或漏药相关记录。");
  if (summaryBullets.length === 0) summaryBullets.push("近期记录平稳，未发现明显异常。");

  const doctorQuestions: string[] = [];
  if (nightCount > 0) doctorQuestions.push("夜间起床和外出冲动是否需要进一步评估？");
  if (medicationCount > 0) doctorQuestions.push("近期服药变化是否需要调整方案？请医生评估。");
  if (input.attentionItems.some((item) => item.type === "caregiver")) {
    doctorQuestions.push("家属照护压力较高，是否有可推荐的社区支持？");
  }
  if (doctorQuestions.length === 0) doctorQuestions.push("近期总体情况，是否还有需要观察的方面？");

  return {
    metrics: [
      { label: "记录数", value: String(input.recordCount), helper: "近期", tone: "brand" },
      { label: "夜间安全", value: String(nightCount), helper: "关注事项", tone: nightCount > 0 ? "alert" : "info" },
      { label: "服药事件", value: String(medicationCount), helper: "建议提及", tone: "watch" },
      { label: "已记住方法", value: String(remembered), helper: "可复用", tone: "info" }
    ],
    followup_patch: {
      summary_bullets: summaryBullets,
      doctor_questions: doctorQuestions,
      materials_to_bring: input.followupDocuments?.map((doc) => doc.title) ?? []
    },
    tried_strategies: input.memoryItems
      .filter((item) => item.type === "effective_strategy" && item.status === "confirmed")
      .slice(0, 4)
      .map((item) => item.title),
    boundary_notice: "以上仅用于复诊沟通整理，诊断与用药请以医生判断为准。"
  };
}

/**
 * Re-shape an XML follow-up parse into the snake_case `LocalFollowupJson`
 * the existing assembly logic consumes. Keeps the two paths converged.
 */
function xmlFollowupToJsonShape(xml: LocalFollowupXml): LocalFollowupJson {
  return {
    metrics: xml.metrics?.map((m) => ({
      label: m.label,
      value: m.value,
      helper: m.helper,
      tone: m.tone
    })),
    followup_patch: xml.followupPatch
      ? {
          summary_bullets: xml.followupPatch.summaryBullets,
          doctor_questions: xml.followupPatch.doctorQuestions,
          materials_to_bring: xml.followupPatch.materialsToBring
        }
      : undefined,
    tried_strategies: xml.triedStrategies,
    boundary_notice: xml.boundaryNotice
  };
}

export async function generateFollowupSummaryLocal(
  input: FollowupSummaryInput
): Promise<FollowupSummaryResponse> {
  const startedAt = Date.now();
  let parsed: LocalFollowupJson | null = null;
  let filename = "unknown";
  let outputChars = 0;
  let inputChars = 0;
  let errorKind: string | undefined;

  try {
    filename = await ensureEngine();
    const xmlMode = isXmlOutput();
    const prompt = xmlMode
      ? buildFollowupXmlPrompt({
          dateRange: input.dateRange,
          recordCount: input.recordCount,
          attentionItems: input.attentionItems,
          memoryItems: input.memoryItems,
          followupDocuments: input.followupDocuments ?? []
        })
      : buildFollowupPrompt({
          dateRange: input.dateRange,
          recordCount: input.recordCount,
          attentionItems: input.attentionItems,
          memoryItems: input.memoryItems,
          followupDocuments: input.followupDocuments ?? []
        });
    inputChars = prompt.length;
    const result = await Gemma.generate(prompt, {
      filename,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      topK: DEFAULT_TOP_K
    });
    outputChars = result.text.length;

    if (xmlMode) {
      const xml = parseFollowupXml(result.text);
      parsed = xml ? xmlFollowupToJsonShape(xml) : null;
    } else {
      parsed = parseJsonObject<LocalFollowupJson>(result.text);
    }
    if (!parsed) errorKind = `${LOCAL_OUTPUT_FORMAT}_parse_failed`;
  } catch (error) {
    console.warn("[local] generateFollowupSummary Gemma failure, falling back", error);
    errorKind = error instanceof Error ? error.message.slice(0, 60) : "engine_error";
  }

  void reportOnDeviceInference({
    task: "followup",
    modelId: filename,
    success: parsed !== null,
    elapsedMs: Date.now() - startedAt,
    inputChars,
    outputChars,
    fellBack: parsed === null,
    errorKind
  });

  const fallback = buildFallback(input);

  const metrics: ReportMetricV2[] = Array.isArray(parsed?.metrics) && parsed!.metrics!.length > 0
    ? parsed!.metrics!.map((m) => ({
        label: coerceString(m.label, "指标"),
        value: coerceString(m.value, "0"),
        helper: coerceString(m.helper, ""),
        tone: (["brand", "watch", "alert", "info"] as const).includes(
          m.tone as "brand" | "watch" | "alert" | "info"
        )
          ? (m.tone as ReportMetricV2["tone"])
          : "info"
      }))
    : fallback.metrics;

  const followupPatch = parsed?.followup_patch
    ? {
        summary_bullets: coerceStringArray(parsed.followup_patch.summary_bullets).length > 0
          ? coerceStringArray(parsed.followup_patch.summary_bullets)
          : fallback.followup_patch!.summary_bullets!,
        doctor_questions: coerceStringArray(parsed.followup_patch.doctor_questions).length > 0
          ? coerceStringArray(parsed.followup_patch.doctor_questions)
          : fallback.followup_patch!.doctor_questions!,
        materials_to_bring: coerceStringArray(parsed.followup_patch.materials_to_bring).length > 0
          ? coerceStringArray(parsed.followup_patch.materials_to_bring)
          : fallback.followup_patch!.materials_to_bring!
      }
    : {
        summary_bullets: fallback.followup_patch!.summary_bullets!,
        doctor_questions: fallback.followup_patch!.doctor_questions!,
        materials_to_bring: fallback.followup_patch!.materials_to_bring!
      };

  const triedStrategies = coerceStringArray(parsed?.tried_strategies);

  return {
    report_id: `local_report_${Date.now()}`,
    status: "ok",
    patient_id: input.patientId,
    caregiver_id: input.caregiverId,
    date_range: input.dateRange,
    generated_at: new Date().toISOString(),
    readiness: computeReadiness(input.recordCount),
    metrics,
    followup_patch: followupPatch,
    tried_strategies: triedStrategies.length > 0 ? triedStrategies : fallback.tried_strategies,
    boundary_notice: coerceString(parsed?.boundary_notice, fallback.boundary_notice),
    error: null
  };
}
