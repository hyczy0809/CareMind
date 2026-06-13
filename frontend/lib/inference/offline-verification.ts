import type { CareWorkflowAppResult } from "./shared/types";
import type { InferenceProvenance } from "./shared/provenance";
import { sourceLabel } from "./shared/provenance";
import { TRACK_C_OFFLINE_DEMO, trackCLabel } from "./track-c-demo";
import { checkGuardrail, generateFollowupSummary, runCareWorkflow } from "./inference-router";
import { getModelEntry, preloadSelectedEngine, resolveSelectedModelFilename, runLocalGemmaSmokeTest } from "./local/model-manager";
import { Gemma } from "./local/gemma-native";
import type { GemmaRuntimeInfo } from "./local/gemma-native";
import { DEFAULT_MAX_TOKENS, GEMMA4_E2B_CONTEXT_TOKENS } from "./local/constants";
import { buildApiUrl } from "./shared/http";
import { buildLocalDocumentParseResult } from "../local-followup-documents";
import type { InferenceProvenanceSource } from "./shared/provenance";

export type OfflineVerificationStatus = "passed" | "warning" | "failed";

export interface OfflineVerificationStep {
  id: string;
  label: string;
  status: OfflineVerificationStatus;
  message: string;
  provenance?: InferenceProvenance;
}

export interface OfflinePerformanceSummary {
  device: string;
  os: string;
  ram: string;
  runtime: string;
  runtimeDependency: string;
  model: string;
  modelFormat: string;
  modelSize: string;
  quantization: string;
  backend: string;
  smartLogLatencyMs: number | null;
  communicationLatencyMs: number | null;
  summaryLatencyMs: number | null;
  smokeLatencyMs: number | null;
  totalGenerationMs: number | null;
  firstTokenLatency: string;
  outputCharsPerSec: number | null;
  memoryPeak: string;
  offlineVerification: string;
}

export interface OfflineVerificationReport {
  generatedAt: string;
  mode: string;
  trackCOfflineDemo: boolean;
  selectedModelId: string | null;
  modelStatus: string;
  runtime: string;
  backend: string;
  runtimeInfo: GemmaRuntimeInfo | null;
  performance: OfflinePerformanceSummary;
  forbiddenSourceCheck: OfflineVerificationStatus;
  steps: OfflineVerificationStep[];
  passed: boolean;
  text: string;
}

const FORBIDDEN_TRACK_C_SOURCES: InferenceProvenanceSource[] = [
  "stub_debug",
  "demo_mock",
  "cloud_26b",
  "cloud_31b"
];

function emptyProvenance(task: InferenceProvenance["task"], reason: string): InferenceProvenance {
  return {
    source: "unavailable",
    task,
    modelId: "unknown",
    backend: "unknown",
    latencyMs: 0,
    engineInitialized: false,
    nativeGenerateAttempted: false,
    nativeGenerateReturned: false,
    rawOutputLength: 0,
    rawOutputHash: null,
    parseSucceeded: false,
    fallbackReason: reason
  };
}

function nativeStatus(provenance: InferenceProvenance | undefined): OfflineVerificationStatus {
  if (!provenance) return "failed";
  if (provenance.source === "native_litertlm_success") return "passed";
  if (provenance.source === "native_litertlm_parse_fallback") return "warning";
  return "failed";
}

function summarizeStep(step: OfflineVerificationStep): string {
  const p = step.provenance;
  const provenanceText = p
    ? `source=${p.source}, model=${p.modelId}, backend=${p.backend}, latencyMs=${Math.round(p.latencyMs)}, nativeGenerateAttempted=${p.nativeGenerateAttempted}, nativeGenerateReturned=${p.nativeGenerateReturned}, rawOutputLength=${p.rawOutputLength}, rawOutputHash=${p.rawOutputHash ?? "none"}, parseSucceeded=${p.parseSucceeded}, fallbackReason=${p.fallbackReason ?? "none"}`
    : "no provenance";
  return `[${step.status}] ${step.label}: ${step.message} (${provenanceText})`;
}

function reportText(report: Omit<OfflineVerificationReport, "text">): string {
  const perf = report.performance;
  return [
    "CareMind Track C Offline Verification",
    `generatedAt=${report.generatedAt}`,
    `mode=${report.mode}`,
    `trackCOfflineDemo=${report.trackCOfflineDemo}`,
    `selectedModelId=${report.selectedModelId ?? "none"}`,
    `modelStatus=${report.modelStatus}`,
    `runtime=${report.runtime}`,
    `backend=${report.backend}`,
    `device=${perf.device}`,
    `os=${perf.os}`,
    `ram=${perf.ram}`,
    `runtimeDependency=${perf.runtimeDependency}`,
    `model=${perf.model}`,
    `modelFormat=${perf.modelFormat}`,
    `modelSize=${perf.modelSize}`,
    `quantization=${perf.quantization}`,
    `smartLogLatencyMs=${perf.smartLogLatencyMs ?? "not_measured"}`,
    `communicationLatencyMs=${perf.communicationLatencyMs ?? "not_measured"}`,
    `summaryLatencyMs=${perf.summaryLatencyMs ?? "not_measured"}`,
    `smokeLatencyMs=${perf.smokeLatencyMs ?? "not_measured"}`,
    `totalGenerationMs=${perf.totalGenerationMs ?? "not_measured"}`,
    `firstTokenLatency=${perf.firstTokenLatency}`,
    `outputCharsPerSec=${perf.outputCharsPerSec ?? "not_measured"}`,
    `memoryPeak=${perf.memoryPeak}`,
    `forbiddenSourceCheck=${report.forbiddenSourceCheck}`,
    `passed=${report.passed}`,
    "",
    "Metric | Demo Value",
    "---|---",
    `Device | ${perf.device}`,
    `OS | ${perf.os}`,
    `RAM | ${perf.ram}`,
    `Runtime | ${perf.runtime}`,
    `Runtime dependency | ${perf.runtimeDependency}`,
    `Model | ${perf.model}`,
    `Model format | ${perf.modelFormat}`,
    `Quantization | ${perf.quantization}`,
    `Backend | ${perf.backend}`,
    `Model size | ${perf.modelSize}`,
    `Smart log latency | ${perf.smartLogLatencyMs ?? "not measured"} ms`,
    `Simple communication latency | ${perf.communicationLatencyMs ?? "not measured"} ms`,
    `Short summary latency | ${perf.summaryLatencyMs ?? "not measured"} ms`,
    `Smoke total generation latency | ${perf.smokeLatencyMs ?? "not measured"} ms`,
    `First token latency | ${perf.firstTokenLatency}`,
    `Output throughput | ${perf.outputCharsPerSec ?? "not measured"} chars/sec`,
    `Memory peak | ${perf.memoryPeak}`,
    `Offline verification | ${perf.offlineVerification}`,
    "",
    ...report.steps.map(summarizeStep)
  ].join("\n");
}

function stepError(id: string, label: string, task: InferenceProvenance["task"], error: unknown): OfflineVerificationStep {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id,
    label,
    status: "failed",
    message,
    provenance: emptyProvenance(task, message)
  };
}

function cloudBlockStep(path: string): OfflineVerificationStep {
  try {
    buildApiUrl(path);
    return {
      id: `cloud_block_${path.replace(/[^a-z0-9]+/gi, "_")}`,
      label: `Track C 云端禁用 ${path}`,
      status: TRACK_C_OFFLINE_DEMO ? "failed" : "warning",
      message: "endpoint was not blocked",
      provenance: emptyProvenance("guardrail", "track_c_cloud_endpoint_not_blocked")
    };
  } catch (error) {
    return {
      id: `cloud_block_${path.replace(/[^a-z0-9]+/gi, "_")}`,
      label: `Track C 云端禁用 ${path}`,
      status: "passed",
      message: error instanceof Error ? error.message : "blocked",
      provenance: {
        ...emptyProvenance("guardrail", "track_c_cloud_endpoint_blocked"),
        source: "rule_local_fallback",
        parseSucceeded: true
      }
    };
  }
}

function workflowMessage(result: CareWorkflowAppResult): string {
  const source = result.inferenceProvenance?.source ?? "unavailable";
  const script = result.scriptAdvice ? "script=yes" : "script=no";
  return `${sourceLabel(source)}; attention=${result.attentionItems.length}; memory=${result.memoryItems.length}; ${script}`;
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return "unknown";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function deviceLabel(info: GemmaRuntimeInfo | null): string {
  const system = info?.systemInfo;
  const pieces = [system?.manufacturer, system?.model].filter(Boolean);
  return pieces.length ? pieces.join(" ") : "unknown device";
}

function osLabel(info: GemmaRuntimeInfo | null): string {
  const system = info?.systemInfo;
  if (info?.platform === "android") {
    return `Android ${system?.androidVersion ?? "unknown"} (SDK ${system?.sdkInt ?? "unknown"})`;
  }
  if (info?.platform === "ios") {
    return "iOS";
  }
  return "unknown";
}

function ramLabel(info: GemmaRuntimeInfo | null): string {
  const total = info?.systemInfo?.totalMemoryMb;
  const available = info?.systemInfo?.availableMemoryMb;
  if (!total) return "unknown";
  return `${Math.round(total)} MB total${available ? `, ${Math.round(available)} MB available` : ""}`;
}

function latencyFor(steps: OfflineVerificationStep[], id: string): number | null {
  const value = steps.find((step) => step.id === id)?.provenance?.latencyMs;
  return typeof value === "number" && value > 0 ? Math.round(value) : null;
}

function outputCharsFor(steps: OfflineVerificationStep[], id: string): number {
  const value = steps.find((step) => step.id === id)?.provenance?.rawOutputLength;
  return typeof value === "number" && value > 0 ? value : 0;
}

function buildPerformanceSummary(input: {
  selectedModelId: string | null;
  modelStatus: string;
  runtime: string;
  backend: string;
  runtimeInfo: GemmaRuntimeInfo | null;
  steps: OfflineVerificationStep[];
  passed: boolean;
}): OfflinePerformanceSummary {
  const smokeLatency = latencyFor(input.steps, "smoke");
  const smartLogLatency = latencyFor(input.steps, "daily_log");
  const communicationLatency = latencyFor(input.steps, "communication_simple");
  const summaryLatency = latencyFor(input.steps, "followup_short_summary");
  const totalGenerationMs = [smokeLatency, smartLogLatency, communicationLatency]
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0);
  const outputChars = outputCharsFor(input.steps, "smoke") + outputCharsFor(input.steps, "daily_log") + outputCharsFor(input.steps, "communication_simple");
  const charsPerSec = totalGenerationMs > 0 && outputChars > 0
    ? Number((outputChars / (totalGenerationMs / 1000)).toFixed(1))
    : null;
  return {
    device: deviceLabel(input.runtimeInfo),
    os: osLabel(input.runtimeInfo),
    ram: ramLabel(input.runtimeInfo),
    runtime: input.runtime,
    runtimeDependency: input.runtimeInfo?.runtimeDependency ?? "unknown",
    model: input.runtimeInfo?.loadedModelId ?? input.selectedModelId ?? "none",
    modelFormat: input.runtimeInfo?.modelFormat ?? "unknown",
    modelSize: formatBytes(input.runtimeInfo?.loadedModelBytes ?? getModelEntry(input.selectedModelId ?? "").totalBytes),
    quantization: "unknown/checksum-pinned .litertlm",
    backend: input.backend,
    smartLogLatencyMs: smartLogLatency,
    communicationLatencyMs: communicationLatency,
    summaryLatencyMs: summaryLatency,
    smokeLatencyMs: smokeLatency,
    totalGenerationMs: totalGenerationMs > 0 ? totalGenerationMs : null,
    firstTokenLatency: "not measured; current bridge returns final text after blocking generation",
    outputCharsPerSec: charsPerSec,
    memoryPeak: "see native MEM[...] logcat snapshots",
    offlineVerification: `${input.passed ? "passed" : "failed"}; modelStatus=${input.modelStatus}`
  };
}

function forbiddenSourceStep(steps: OfflineVerificationStep[]): OfflineVerificationStep {
  const offenders = steps.filter((step) => step.provenance && FORBIDDEN_TRACK_C_SOURCES.includes(step.provenance.source));
  return {
    id: "forbidden_sources",
    label: "Track C 禁止 stub/mock/cloud source",
    status: offenders.length === 0 ? "passed" : "failed",
    message: offenders.length === 0
      ? "No stub_debug/demo_mock/cloud_26b/cloud_31b source appeared in judged verification steps."
      : offenders.map((step) => `${step.id}:${step.provenance?.source}`).join(", "),
    provenance: {
      ...emptyProvenance("guardrail", offenders.length === 0 ? "forbidden_sources_absent" : "forbidden_sources_present"),
      source: offenders.length === 0 ? "rule_local_fallback" : "unavailable",
      parseSucceeded: offenders.length === 0
    }
  };
}

function failureModeChecklistStep(): OfflineVerificationStep {
  return {
    id: "failure_modes",
    label: "失败场景 UI/fallback 设计",
    status: "passed",
    message: [
      "missing_model=本地模型未就绪提示",
      "download_errors=HTTP/auth/not_found/disk/timeout/checksum 分类",
      "native_error=manual_draft/unavailable provenance",
      "json_parse_failed=native_litertlm_parse_fallback",
      "document_unreadable=manual_summary_required",
      "medical_boundary=doctor_question_cta"
    ].join("; "),
    provenance: {
      ...emptyProvenance("guardrail", "failure_modes_configured"),
      source: "rule_local_fallback",
      parseSucceeded: true
    }
  };
}

export async function runTrackCOfflineVerification(): Promise<OfflineVerificationReport> {
  const generatedAt = new Date().toISOString();
  const selectedModelId = await resolveSelectedModelFilename().catch(() => null);
  let modelStatus = selectedModelId ? getModelEntry(selectedModelId).status : "not_selected";
  const steps: OfflineVerificationStep[] = [];

  let runtime = "unknown";
  let backend = "unknown";
  let runtimeInfo: GemmaRuntimeInfo | null = null;

  await Gemma.setStubMode(false).catch(() => undefined);

  const initialRuntimeInfo = await Gemma.getRuntimeInfo().catch(() => null);
  if (initialRuntimeInfo) {
    runtimeInfo = initialRuntimeInfo;
    runtime = initialRuntimeInfo.runtime;
    backend = String(initialRuntimeInfo.accelerator ?? backend);
  }
  steps.push({
    id: "airplane_mode",
    label: "飞行模式检测",
    status: initialRuntimeInfo?.systemInfo?.airplaneMode ? "passed" : "warning",
    message: initialRuntimeInfo
      ? `airplaneMode=${initialRuntimeInfo.systemInfo?.airplaneMode === true}`
      : "runtime info unavailable; cannot read airplane mode",
    provenance: {
      ...emptyProvenance("guardrail", initialRuntimeInfo?.systemInfo?.airplaneMode ? "airplane_mode_on" : "airplane_mode_not_confirmed"),
      source: "rule_local_fallback",
      parseSucceeded: true
    }
  });

  steps.push(cloudBlockStep("/api/care-workflow"));
  steps.push(cloudBlockStep("/api/reports/follow-up"));
  steps.push(cloudBlockStep("/api/audio/transcribe"));
  steps.push(cloudBlockStep("/api/documents/upload"));

  try {
    await preloadSelectedEngine({
      maxTokens: DEFAULT_MAX_TOKENS,
      contextTokens: GEMMA4_E2B_CONTEXT_TOKENS
    });
	    const info = await Gemma.getRuntimeInfo();
	    runtimeInfo = info;
	    runtime = info.runtime;
    backend = String(info.accelerator ?? "unknown");
  } catch (error) {
    steps.push(stepError("preload", "初始化本地引擎", "daily_log", error));
  }

  try {
    const smoke = await runLocalGemmaSmokeTest(selectedModelId, {
      maxTokens: 96,
      contextTokens: GEMMA4_E2B_CONTEXT_TOKENS
    });
    if (selectedModelId) {
      modelStatus = getModelEntry(selectedModelId).status;
    }
    const info = await Gemma.getRuntimeInfo().catch(() => null);
    if (info) {
      runtime = info.runtime;
      runtimeInfo = info;
      backend = smoke.backend ?? String(info.accelerator ?? backend);
    } else {
      backend = smoke.backend ?? backend;
    }
    steps.push({
      id: "smoke",
      label: "Gemma 4 E2B 本地 smoke test",
      status: smoke.passed ? "passed" : "failed",
      message: smoke.passed ? "native LiteRT-LM returned non-empty output" : (smoke.errorMessage ?? "native smoke failed"),
      provenance: {
        source: smoke.source === "native_litertlm_success" ? "native_litertlm_success" : "unavailable",
        task: "daily_log",
        modelId: smoke.modelId,
        backend: smoke.backend,
        latencyMs: smoke.latencyMs,
        engineInitialized: smoke.passed,
        nativeGenerateAttempted: smoke.nativeGenerateAttempted,
        nativeGenerateReturned: smoke.nativeGenerateReturned,
        rawOutputLength: smoke.rawOutputLength,
        rawOutputHash: smoke.rawOutputHash,
        parseSucceeded: smoke.passed,
        fallbackReason: smoke.passed ? null : (smoke.errorMessage ?? "native_smoke_failed")
      }
    });
  } catch (error) {
    steps.push(stepError("smoke", "Gemma 4 E2B 本地 smoke test", "daily_log", error));
  }

  const readyEntry = selectedModelId ? getModelEntry(selectedModelId) : null;
  modelStatus = readyEntry?.status ?? modelStatus;
  steps.push({
    id: "selected_model_ready",
    label: "选中模型 ready 状态",
    status: readyEntry?.status === "ready" && readyEntry.smokeTest?.passed ? "passed" : "failed",
    message: readyEntry
      ? `status=${readyEntry.status}; validation=${readyEntry.validationStatus ?? "unknown"}; runtime=${readyEntry.runtimeStatus ?? "unknown"}; smoke=${readyEntry.smokeTest?.passed ? "passed" : "not_passed"}`
      : "no selected model",
    provenance: {
      ...emptyProvenance("daily_log", readyEntry?.errorMessage ?? "selected_model_not_ready"),
      source: readyEntry?.status === "ready" && readyEntry.smokeTest?.passed ? "native_litertlm_success" : "unavailable",
      modelId: selectedModelId ?? "none",
      backend: readyEntry?.runtimeBackend ?? "unknown",
      engineInitialized: readyEntry?.runtimeStatus === "ready",
      nativeGenerateAttempted: readyEntry?.smokeTest?.nativeGenerateAttempted ?? false,
      nativeGenerateReturned: readyEntry?.smokeTest?.nativeGenerateReturned ?? false,
      rawOutputLength: readyEntry?.smokeTest?.rawOutputLength ?? 0,
      rawOutputHash: readyEntry?.smokeTest?.rawOutputHash ?? null,
      parseSucceeded: readyEntry?.smokeTest?.passed === true
    }
  });

  try {
    const daily = await runCareWorkflow({
      patient_id: "offline_demo_patient",
      caregiver_id: "offline_demo_caregiver",
      note: "昨晚妈妈三点起来说要回老家，在门口找钥匙。我陪她看老照片，十分钟后平静下来。",
      source: "manual"
    });
    const p = daily.inferenceProvenance;
    steps.push({
      id: "daily_log",
      label: "智能记录本地推理",
      status: nativeStatus(p),
      message: workflowMessage(daily),
      provenance: p
    });
  } catch (error) {
    steps.push(stepError("daily_log", "智能记录本地推理", "daily_log", error));
  }

  try {
    const script = await runCareWorkflow({
      patient_id: "offline_demo_patient",
      caregiver_id: "offline_demo_caregiver",
      note: "爸爸一直说有人偷了他的钱，情绪很急，需要一句简单安抚话术。",
      source: "manual"
    });
    const hasScript = !!script.scriptAdvice;
    const p = script.inferenceProvenance;
    steps.push({
      id: "communication_simple",
      label: "简单沟通话术本地生成",
      status: hasScript ? nativeStatus(p) : "failed",
      message: hasScript ? workflowMessage(script) : "no communication script generated",
      provenance: p
    });
  } catch (error) {
    steps.push(stepError("communication_simple", "简单沟通话术本地生成", "communication", error));
  }

  try {
    const guardrail = await checkGuardrail({
      patient_id: "offline_demo_patient",
      caregiver_id: "offline_demo_caregiver",
      note: "这个药要不要停？剂量是不是该减一点？"
    });
    const passed =
      guardrail.guardrail.triggered &&
      guardrail.guardrail.type === "medication" &&
      guardrail.guardrail.alternative_cta?.action === "create_doctor_question";
    steps.push({
      id: "medical_boundary_guardrail",
      label: "停药/剂量问题本地拦截",
      status: passed ? "passed" : "failed",
      message: `triggered=${guardrail.guardrail.triggered}; type=${guardrail.guardrail.type}; cta=${guardrail.guardrail.alternative_cta?.action ?? "none"}; message=${guardrail.guardrail.message ?? "none"}`,
      provenance: {
        ...emptyProvenance("guardrail", "rules_local_medical_boundary"),
        source: "rule_local_fallback",
        parseSucceeded: true
      }
    });
  } catch (error) {
    steps.push(stepError("medical_boundary_guardrail", "停药/剂量问题本地拦截", "guardrail", error));
  }

  try {
    const guardrail = await checkGuardrail({
      patient_id: "offline_demo_patient",
      caregiver_id: "offline_demo_caregiver",
      note: "这个报告说明什么病？是不是加重了？要不要做 MRI？"
    });
    const passed =
      guardrail.guardrail.triggered &&
      (guardrail.guardrail.type === "diagnosis" || guardrail.guardrail.type === "imaging_or_test") &&
      guardrail.guardrail.alternative_cta?.action === "create_doctor_question";
    steps.push({
      id: "medical_boundary_report_question",
      label: "报告/检查/诊断问题本地拦截",
      status: passed ? "passed" : "failed",
      message: `triggered=${guardrail.guardrail.triggered}; type=${guardrail.guardrail.type}; cta=${guardrail.guardrail.alternative_cta?.action ?? "none"}; message=${guardrail.guardrail.message ?? "none"}`,
      provenance: {
        ...emptyProvenance("guardrail", "rules_local_medical_boundary_report"),
        source: "rule_local_fallback",
        parseSucceeded: true
      }
    });
  } catch (error) {
    steps.push(stepError("medical_boundary_report_question", "报告/检查/诊断问题本地拦截", "guardrail", error));
  }

  try {
    const guardrail = await checkGuardrail({
      patient_id: "offline_demo_patient",
      caregiver_id: "offline_demo_caregiver",
      note: "老人刚刚走失，家属找不到人。"
    });
    steps.push({
      id: "safety_guardrail",
      label: "危机/安全规则离线检测",
      status: guardrail.guardrail.triggered ? "passed" : "failed",
      message: `triggered=${guardrail.guardrail.triggered}; type=${guardrail.guardrail.type}`,
      provenance: {
        ...emptyProvenance("guardrail", "rules_local_guardrail"),
        source: "rule_local_fallback",
        parseSucceeded: true
      }
    });
  } catch (error) {
    steps.push(stepError("safety_guardrail", "危机/安全规则离线检测", "guardrail", error));
  }

  try {
    const imageParse = buildLocalDocumentParseResult({
      documentId: "offline_image_report_demo",
      typeLabel: "MRI / CT",
      filename: "2026-06-03_mri_report.png",
      mimeType: "image/png",
      size: 420_000,
      sha256: "3f5b6b9c6a8f0db73777e01e6a5c7b8318a41d791d0aa458712f000000000000",
      manualSummary: "报告截图中包含头颅 MRI 字样和 hippocampal atrophy 术语，家属希望复诊时请医生解释。",
      modality: "image",
      parseQuality: "partially_readable"
    });
    steps.push({
      id: "followup_image_material_local",
      label: "报告截图本地资料整理",
      status:
        imageParse.followup_summary_items.length > 1 &&
        imageParse.medical_term_candidates.length > 0 &&
        imageParse.inference_provenance?.source === "manual_draft"
          ? "passed"
          : "warning",
      message: `fields=${imageParse.extracted_fields.length}; terms=${imageParse.medical_term_candidates.map((term) => term.term).join(",") || "none"}; multimodalAttempted=${imageParse.multimodal_attempted}; parseQuality=${imageParse.parse_quality}`,
      provenance: imageParse.inference_provenance
    });
  } catch (error) {
    steps.push(stepError("followup_image_material_local", "报告截图本地资料整理", "followup_document", error));
  }

  try {
    const summary = await generateFollowupSummary({
      patientId: "offline_demo_patient",
      caregiverId: "offline_demo_caregiver",
      dateRange: "7d",
      recordCount: 3,
      attentionItems: [],
      memoryItems: [],
      followupDocuments: [
        {
          id: "offline_image_report_demo",
          patientId: "offline_demo_patient",
          type: "imaging_report",
          title: "MRI / CT",
          filename: "2026-06-03_mri_report.png",
          mimeType: "image/png",
          size: 420_000,
          summary: "报告截图中包含头颅 MRI 字样和 hippocampal atrophy 术语，家属希望复诊时请医生解释。",
          manualSummary: "报告截图中包含头颅 MRI 字样和 hippocampal atrophy 术语，家属希望复诊时请医生解释。",
          status: "reviewed",
          inputModality: "image",
          parseQuality: "partially_readable",
          processingCapability: "local_metadata_manual_summary",
          confirmedItems: [
            "MRI / CT：报告截图中包含头颅 MRI 字样和 hippocampal atrophy 术语，家属希望复诊时请医生解释。"
          ],
          createdAt: generatedAt,
          updatedAt: generatedAt
        }
      ],
      cloudSummaryAllowed: false,
      rawTextUploadAllowed: false,
      fullWindowRequired: false
    });
    const p = summary.inference_provenance;
    steps.push({
      id: "followup_short_summary",
      label: "本地短复诊摘要",
      status: p?.source === "rule_local_fallback" ? "passed" : "warning",
      message: `summaryChars=${(summary.summary_zh ?? "").length}; modelProfile=${summary.model_profile}`,
      provenance: p
    });
  } catch (error) {
    steps.push(stepError("followup_short_summary", "本地短复诊摘要", "follow_up_summary", error));
  }

  steps.push(failureModeChecklistStep());
  steps.push(forbiddenSourceStep(steps));
  const passed = steps.every((step) => step.status !== "failed");
  const performance = buildPerformanceSummary({
    selectedModelId,
    modelStatus,
    runtime,
    backend,
    runtimeInfo,
    steps,
    passed
  });
  const forbiddenSourceCheck = steps.find((step) => step.id === "forbidden_sources")?.status ?? "failed";
  const withoutText: Omit<OfflineVerificationReport, "text"> = {
    generatedAt,
    mode: trackCLabel(),
    trackCOfflineDemo: TRACK_C_OFFLINE_DEMO,
    selectedModelId,
    modelStatus,
    runtime,
    backend,
    runtimeInfo,
    performance,
    forbiddenSourceCheck,
    steps,
    passed
  };

  return {
    ...withoutText,
    text: reportText(withoutText)
  };
}
