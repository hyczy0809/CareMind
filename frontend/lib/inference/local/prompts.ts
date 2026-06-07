// Prompt templates for the 4 on-device tasks. We deliberately use a tighter
// schema than the full V2 types — Gemma 3 is more reliable when asked to
// emit a small object. Fields the app needs but the model would be unreliable
// at (UUIDs, timestamps, derived counters) are filled in TS-side.

import type {
  AttentionItem,
  FollowupDocumentRecord,
  MemoryItem
} from "../../../types/caremind";
import type { FollowupRange } from "../../../types/care-workflow";

const COMMON_SYSTEM = `你是 CareMind 的本地中文助手，为失智症照护家属服务。
严格规则：
1. 仅输出一个 JSON 对象，不要任何前后文字、不要 markdown 代码围栏。
2. 不做医学诊断、不建议改用药、不预测病情发展。
3. 证据字段必须基于用户输入原文，不得编造。
4. 不确定的字段使用 null、"unknown" 或空数组（按各字段说明）。
5. 字符串保持简洁的中文，不要英文。`;

// --- Care workflow -----------------------------------------------------------

export interface LocalCareWorkflowJson {
  structured_log?: {
    sleep?: { night_wakings?: number | null; note?: string };
    behavior?: { label?: string; evidence?: string; frequency?: string }[];
    nutrition?: {
      meal_intake?: string;
      water_intake?: string;
      choking?: unknown;
      weight_change?: string;
      note?: string;
    };
    medication?: {
      mentioned?: boolean;
      refusal_count?: number | null;
      missed_dose?: unknown;
      duplicate_dose?: unknown;
      medication_names?: string[];
      note?: string;
    };
    safety?: {
      night_wandering?: unknown;
      door_exit_attempt?: unknown;
      fall?: unknown;
      wandering?: unknown;
      acute_danger?: boolean;
      note?: string;
    };
    caregiver?: {
      quote?: string;
      stress_level?: string;
    };
  };
  attention_items?: Array<{
    type?: string;
    severity?: string;
    title?: string;
    evidence?: string;
    doctor_feedback_hint?: string;
    actions?: { id?: string; label?: string; alternative_label?: string }[];
  }>;
  memory_candidates?: Array<{
    type?: string;
    title?: string;
    description?: string;
    evidence?: string[];
    requires_confirmation?: boolean;
  }>;
  communication_script?: {
    not_recommended?: string;
    recommended?: string;
    principle?: string;
  } | null;
  guardrail?: {
    triggered?: boolean;
    type?: string;
    message?: string | null;
  };
}

export function buildCareWorkflowPrompt(note: string): string {
  return `${COMMON_SYSTEM}

任务：把家属照护笔记转成结构化照护记录、关注事项与可记忆模式。
最多生成 3 条关注事项，每条最多 3 个具体行动。
最多生成 1 条记忆候选（仅在有明显可复用模式时）。

输出 JSON Schema（字段缺失即省略，不要使用 \`undefined\`）：
{
  "structured_log": {
    "sleep": { "night_wakings": number|null, "note": string },
    "behavior": [{ "label": string, "evidence": string, "frequency": "待确认"|"偶发"|"频繁" }],
    "nutrition": {
      "meal_intake": "normal"|"less"|"few_bites"|"refused"|"unknown",
      "water_intake": "normal"|"less"|"more"|"unknown",
      "choking": true|false|"unknown",
      "weight_change": "loss"|"gain"|"stable"|"unknown",
      "note": string
    },
    "medication": {
      "mentioned": boolean,
      "refusal_count": number|null,
      "missed_dose": true|false|"unknown",
      "duplicate_dose": true|false|"unknown",
      "medication_names": string[],
      "note": string
    },
    "safety": {
      "night_wandering": true|false|"unknown",
      "door_exit_attempt": true|false|"unknown",
      "fall": true|false|"unknown",
      "wandering": true|false|"unknown",
      "acute_danger": boolean,
      "note": string
    },
    "caregiver": { "quote": string, "stress_level": "low"|"medium"|"high"|"crisis" }
  },
  "attention_items": [{
    "type": "night_safety"|"nutrition"|"medication"|"wandering"|"caregiver"|"behavior",
    "severity": "low"|"medium"|"high"|"crisis",
    "title": string,
    "evidence": string,
    "doctor_feedback_hint": string,
    "actions": [{ "label": string, "alternative_label": string }]
  }],
  "memory_candidates": [{
    "type": "behavior_pattern"|"effective_strategy"|"ineffective_strategy"|"medication_observation"|"caregiver_support"|"communication_preference",
    "title": string,
    "description": string,
    "evidence": [string],
    "requires_confirmation": true
  }],
  "communication_script": { "not_recommended": string, "recommended": string, "principle": string } | null,
  "guardrail": { "triggered": boolean, "type": "none"|"diagnosis"|"medication"|"imaging_or_test"|"crisis"|"emergency", "message": string|null }
}

家属笔记：
"""${note}"""

请仅输出 JSON。`;
}

// --- Guardrail ---------------------------------------------------------------

export interface LocalGuardrailJson {
  triggered?: boolean;
  type?: string;
  message?: string | null;
  alternative_cta?: {
    label?: string;
    action?: string;
  } | null;
}

export function buildGuardrailPrompt(note: string): string {
  return `${COMMON_SYSTEM}

任务：判断家属笔记是否触及以下边界，需要软提醒：
- 诊断请求（如"是不是阿尔茨海默？"）
- 用药调整请求
- 影像/检查项目建议
- 急性危机（失踪、走失、自伤、呼吸困难、胸痛、意识丧失等）

输出 JSON：
{
  "triggered": boolean,
  "type": "none"|"diagnosis"|"medication"|"imaging_or_test"|"crisis"|"emergency",
  "message": string|null,    // triggered 时给出温和的中文提醒；否则 null
  "alternative_cta": { "label": string, "action": "create_doctor_question"|"open_emergency_support"|"save_observation"|"open_followup_prep" } | null
}

家属笔记：
"""${note}"""

请仅输出 JSON。`;
}

// --- Follow-up summary -------------------------------------------------------

export interface LocalFollowupJson {
  metrics?: { label?: string; value?: string; helper?: string; tone?: string }[];
  followup_patch?: {
    summary_bullets?: string[];
    doctor_questions?: string[];
    materials_to_bring?: string[];
  };
  tried_strategies?: string[];
  boundary_notice?: string;
}

export function buildFollowupPrompt(input: {
  dateRange: FollowupRange;
  recordCount: number;
  attentionItems: AttentionItem[];
  memoryItems: MemoryItem[];
  followupDocuments: FollowupDocumentRecord[];
}): string {
  const compactAttention = input.attentionItems.slice(0, 12).map((item) => ({
    type: item.type,
    severity: item.severity,
    title: item.title,
    evidence: item.evidence
  }));
  const compactMemory = input.memoryItems.slice(0, 8).map((item) => ({
    type: item.type,
    status: item.status,
    title: item.title,
    description: item.description
  }));
  const compactDocs = input.followupDocuments.slice(0, 6).map((doc) => ({
    type: doc.type,
    title: doc.title,
    summary: doc.summary,
    confirmed_items: doc.confirmedItems ?? []
  }));

  return `${COMMON_SYSTEM}

任务：根据近期照护数据，为家属准备复诊沟通要点。
不要做诊断或建议用药改动。

输入数据：
{
  "date_range": "${input.dateRange}",
  "record_count": ${input.recordCount},
  "attention_items": ${JSON.stringify(compactAttention)},
  "memory_items": ${JSON.stringify(compactMemory)},
  "followup_documents": ${JSON.stringify(compactDocs)}
}

输出 JSON：
{
  "metrics": [{ "label": string, "value": string, "helper": string, "tone": "brand"|"watch"|"alert"|"info" }],
  "followup_patch": {
    "summary_bullets": [string],     // 3-6 条总结要点（中文）
    "doctor_questions": [string],     // 3-6 条建议提问（中文）
    "materials_to_bring": [string]    // 0-4 条建议带去的材料
  },
  "tried_strategies": [string],       // 0-4 条家属已尝试有效/无效的方法
  "boundary_notice": string            // 1 句中文边界提示，例如"以上仅用于复诊沟通整理，诊断与用药请以医生判断为准。"
}

请仅输出 JSON。`;
}

// --- Audio transcription -----------------------------------------------------

export function buildTranscriptionPrompt(language: string): string {
  // No JSON for this task — Gemma multimodal returns the transcript text directly.
  return `请将以下音频内容逐字转写为${language === "zh" ? "中文（简体）" : language}文本。
只输出转写后的文字，不要任何前言、标签或解释。如果听不清，请输出最接近的字词。`;
}
