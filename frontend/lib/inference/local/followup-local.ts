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
import type { InferenceProvenance } from "../shared/provenance";
import { hashInferenceOutput } from "../shared/provenance";

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
  const confirmedDocuments = (input.followupDocuments ?? []).filter((doc) => doc.status === "reviewed");
  const documentSummaries = confirmedDocuments
    .map((doc) => doc.summary?.trim() || doc.confirmedItems?.[0]?.trim() || "")
    .filter(Boolean)
    .slice(0, 3);

  const summaryBullets: string[] = [];
  if (input.recordCount > 0) summaryBullets.push(`近期已保存 ${input.recordCount} 条照护记录。`);
  if (high > 0) summaryBullets.push(`其中 ${high} 条为高优先级关注事项。`);
  if (nightCount > 0) summaryBullets.push("出现夜间起床或安全相关线索。");
  if (medicationCount > 0) summaryBullets.push("出现服药、拒药或漏药相关记录。");
  if (documentSummaries.length > 0) summaryBullets.push(`已确认复诊资料：${documentSummaries.join("；")}。`);
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
      materials_to_bring: confirmedDocuments.map((doc) => (doc.summary ? `${doc.title}：${doc.summary}` : doc.title))
    },
    tried_strategies: input.memoryItems
      .filter((item) => item.type === "effective_strategy" && item.status === "confirmed")
      .slice(0, 4)
      .map((item) => item.title),
    boundary_notice: "以上仅用于复诊沟通整理，医疗结论与用药请以医生判断为准。"
  };
}

function sourceWindowDays(dateRange: FollowupSummaryInput["dateRange"]): number {
  if (dateRange === "30d") return 30;
  if (dateRange === "7d") return 7;
  return 0;
}

function unreadableDocuments(input: FollowupSummaryInput): string[] {
  return (input.followupDocuments ?? [])
    .filter((doc) => {
      const quality = doc.parseResult?.parse_quality;
      return quality === "unreadable" || quality === "unsupported" || doc.parseResult?.safety_flags?.includes("unreadable_document");
    })
    .map((doc) => doc.title);
}

function localSummaryZh(
  input: FollowupSummaryInput,
  followupPatch: NonNullable<FollowupSummaryResponse["followup_patch"]>,
  triedStrategies: string[],
  unreadable: string[]
): string {
  const windowLabel = input.dateRange === "30d" ? "30 天" : input.dateRange === "7d" ? "7 天" : "所选时间段";
  const focus = followupPatch.summary_bullets.slice(0, 4).join("；") || "暂无明确高关注事项";
  const questions = followupPatch.doctor_questions.slice(0, 3).join("；") || "暂无需额外整理的问题";
  const strategies = triedStrategies.slice(0, 3).join("；") || "暂无家属确认的有效策略";
  const unreadableText = unreadable.length > 0 ? `有资料无法可靠读取：${unreadable.slice(0, 3).join("、")}。` : "";
  return `家属记录覆盖${windowLabel}，共整理 ${input.recordCount} 条照护记录。观察到的重点包括：${focus}。家属描述中已确认或尝试过的方式包括：${strategies}。${unreadableText}建议复诊时优先沟通：${questions}。以上内容只整理家属记录、照护观察和已确认资料，不替代医生当面判断。`;
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
  let filename = "unknown";
  const provenance: InferenceProvenance = {
    source: "rule_local_fallback",
    task: "follow_up_summary",
    modelId: filename,
    backend: "unknown",
    latencyMs: 0,
    engineInitialized: false,
    nativeGenerateAttempted: false,
    nativeGenerateReturned: false,
    rawOutputLength: 0,
    rawOutputHash: null,
    parseSucceeded: false,
    fallbackReason: "cloud_summary_consent_missing_or_local_short_summary"
  };
  provenance.latencyMs = Date.now() - startedAt;

  console.log(
    `[local] followup provenance source=${provenance.source} model=${provenance.modelId} backend=${provenance.backend} nativeAttempted=${provenance.nativeGenerateAttempted} nativeReturned=${provenance.nativeGenerateReturned} parse=${provenance.parseSucceeded} rawLen=${provenance.rawOutputLength} rawHash=${provenance.rawOutputHash ?? "none"} latencyMs=${provenance.latencyMs}`
  );

  void reportOnDeviceInference({
    task: "followup",
    modelId: filename,
    success: false,
    elapsedMs: Date.now() - startedAt,
    inputChars: 0,
    outputChars: 0,
    fellBack: true,
    errorKind: provenance.fallbackReason ?? undefined,
    source: provenance.source,
    backend: provenance.backend,
    rawOutputHash: provenance.rawOutputHash
  });

  const fallback = buildFallback(input);

  const metrics: ReportMetricV2[] = fallback.metrics;

  const followupPatch = {
    summary_bullets: fallback.followup_patch!.summary_bullets!,
    doctor_questions: fallback.followup_patch!.doctor_questions!,
    materials_to_bring: fallback.followup_patch!.materials_to_bring!
  };

  const finalTriedStrategies = fallback.tried_strategies;
  const unreadable = unreadableDocuments(input);

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
    tried_strategies: finalTriedStrategies,
    boundary_notice: fallback.boundary_notice,
    summary_zh: localSummaryZh(input, followupPatch, finalTriedStrategies, unreadable),
    english_key_phrases: [],
    source_window_days: sourceWindowDays(input.dateRange),
    unreadable_documents: unreadable,
    safety_flags: [
      "local_fallback_summary",
      ...(input.cloudSummaryAllowed === false ? ["cloud_consent_required"] : []),
      ...(unreadable.length > 0 ? ["unreadable_document"] : [])
    ],
    model_profile: "deterministic_fallback",
    input_bundle_overview: {
      source_window_days: sourceWindowDays(input.dateRange),
      record_count: input.recordCount,
      attention_item_count: input.attentionItems.length,
      confirmed_document_count: (input.followupDocuments ?? []).filter((doc) => doc.status === "reviewed").length,
      local_summary: true
    },
    inference_provenance: provenance,
    error: null
  };
}
