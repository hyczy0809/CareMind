// Prompt templates for XML-style on-device LLM output.
//
// Each builder returns a complete prompt whose instructions ask for an XML
// output format. The corresponding XML parser (xml-extract.ts) reads the
// response back into the same TypeScript types the JSON path uses, so
// callers (care-workflow-local.ts etc.) only need to swap prompt builder +
// parser — the rest of the normalisation logic is shared.
//
// Why XML? Small models are much more reliable at writing `<tag>value</tag>`
// than at maintaining correct JSON syntax. A single malformed tag never
// poisons other fields, and we can parse incrementally.

const COMMON_SYSTEM_XML = `你是 CareMind 的本地中文助手，为失智症照护家属服务。
严格规则：
1. 仅使用 XML 格式输出，不要任何前后说明文字、不要 markdown 代码围栏。
2. 不做医学诊断、不建议改用药、不预测病情发展。
3. 依据用户提供的原文输出，不要编造。
4. 不确定的字段使用空标签或 "unknown"。
5. 字符串保持简洁的中文，不要英文。`;

// ---------------------------------------------------------------------------
// Care workflow
// ---------------------------------------------------------------------------

export interface LocalCareWorkflowXml {
  structuredLog?: {
    sleep?: { nightWakings?: number | null; note?: string };
    behavior?: Array<{ label?: string; evidence?: string; frequency?: string }>;
    nutrition?: {
      mealIntake?: string;
      waterIntake?: string;
      choking?: unknown;
      weightChange?: string;
      note?: string;
    };
    medication?: {
      mentioned?: boolean;
      refusalCount?: number | null;
      missedDose?: unknown;
      duplicateDose?: unknown;
      medicationNames?: string[];
      note?: string;
    };
    safety?: {
      nightWandering?: unknown;
      doorExitAttempt?: unknown;
      fall?: unknown;
      wandering?: unknown;
      acuteDanger?: boolean;
      note?: string;
    };
    caregiver?: {
      quote?: string;
      stressLevel?: string;
    };
  };
  attentionItems?: Array<{
    type?: string;
    severity?: string;
    title?: string;
    evidence?: string;
    doctorFeedbackHint?: string;
    actions?: Array<{ label?: string; alternativeLabel?: string }>;
  }>;
  memoryCandidates?: Array<{
    type?: string;
    title?: string;
    description?: string;
    evidence?: string[];
    requiresConfirmation?: boolean;
  }>;
  communicationScript?: { notRecommended?: string; recommended?: string; principle?: string } | null;
  guardrail?: { triggered?: boolean; type?: string; message?: string | null };
}

export function buildCareWorkflowXmlPrompt(note: string): string {
  return `${COMMON_SYSTEM_XML}

任务：把家属照护笔记转成结构化照护记录、关注事项与可记忆模式。
最多生成 3 条关注事项，每条最多 3 个具体行动。
最多生成 1 条记忆候选（仅在有明显可复用模式时）。

用 XML 格式输出。标签超级简单，相信你能正确处理。
不需要严格的单根节点，直接平铺标签即可。

例如：
<sleep><night_wakings>3</night_wakings><note>夜里起了三次</note></sleep>
<behavior><item><label>反复想回家</label><evidence>说想回老家</evidence><frequency>偶发</frequency></item></behavior>
<nutrition><meal_intake>few_bites</meal_intake><water_intake>less</water_intake><choking>false</choking><weight_change>stable</weight_change><note>中午只吃了几口</note></nutrition>
<medication><mentioned>true</mentioned><refusal_count>0</refusal_count><missed_dose>unknown</missed_dose><duplicate_dose>false</duplicate_dose><medication_names/><note>今天按时吃药</note></medication>
<safety><night_wandering>true</night_wandering><door_exit_attempt>false</door_exit_attempt><fall>false</fall><wandering>false</wandering><acute_danger>false</acute_danger><note>夜里起床一次但没出门</note></safety>
<caregiver><quote>很累</quote><stress_level>medium</stress_level></caregiver>

<attention_item type="night_safety" severity="high">
  <title>今晚留意夜间起床安全</title>
  <evidence>记录到夜间起床 3 次</evidence>
  <doctor_feedback_hint>如有疑问，可在复诊时告知医生</doctor_feedback_hint>
  <actions>
    <action><label>打开走廊夜灯</label></action>
  </actions>
</attention_item>

<memory_item type="behavior_pattern" requires_confirmation="true">
  <title>出现"想回家"表达</title>
  <description>晚上特别想回老家</description>
  <evidence_items><item>刚才这条记录</item></evidence_items>
</memory_item>

<communication_script>
  <not_recommended>不要说"你记错了"</not_recommended>
  <recommended>说"我知道你想家"</recommended>
  <principle>先共情再转移注意力</principle>
</communication_script>

<guardrail triggered="false" type="none"><message/></guardrail>

家属笔记：
"""${note}"""

请仅输出 XML 标签。`;
}

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

export function buildGuardrailXmlPrompt(note: string): string {
  return `${COMMON_SYSTEM_XML}

任务：判断家属笔记是否触及以下边界，需要软提醒：
- 诊断请求（如"是不是阿尔茨海默？"）
- 用药调整请求
- 影像/检查项目建议
- 急性危机（失踪、走失、自伤、呼吸困难、胸痛、意识丧失等）

用 XML 输出。仅两个短标签：
<guardrail triggered="false" type="none"><message/></guardrail>

或者：
<guardrail triggered="true" type="diagnosis"><message>诊断需要医生判断，建议把这条记录带到复诊时与医生确认。</message><alternative_cta><label>保存观察</label><action>save_observation</action></alternative_cta></guardrail>

家属笔记：
"""${note}"""

请仅输出 XML。`;
}

// ---------------------------------------------------------------------------
// Follow-up summary
// ---------------------------------------------------------------------------

export interface LocalFollowupXml {
  metrics?: Array<{ label?: string; value?: string; helper?: string; tone?: string }>;
  followupPatch?: {
    summaryBullets?: string[];
    doctorQuestions?: string[];
    materialsToBring?: string[];
  };
  triedStrategies?: string[];
  boundaryNotice?: string;
}

export function buildFollowupXmlPrompt(input: {
  dateRange: string;
  recordCount: number;
  attentionItems: Array<{ type: string; severity: string; title: string; evidence: string }>;
  memoryItems: Array<{ type: string; status: string; title: string; description: string }>;
  followupDocuments: Array<{ type: string; title: string; summary: string }>;
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
    summary: doc.summary
  }));

  return `${COMMON_SYSTEM_XML}

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

用 XML 输出。不需要过多的思考时间，直接输出以下格式：

<followup>
  <metrics>
    <item><label>记录数</label><value>5</value><helper>近期</helper><tone>brand</tone></item>
    <item><label>夜间安全</label><value>1</value><helper>关注事项</helper><tone>alert</tone></item>
  </metrics>
  <followup_patch>
    <summary_bullets>
      <item>近期已保存 5 条照护记录</item>
      <item>其中 1 条为高优先级关注事项</item>
    </summary_bullets>
    <doctor_questions>
      <item>夜间起床和外出冲动是否需要进一步评估？</item>
    </doctor_questions>
    <materials_to_bring>
      <item>近期用药记录</item>
    </materials_to_bring>
  </followup_patch>
  <tried_strategies>
    <item>打开走廊夜灯</item>
  </tried_strategies>
  <boundary_notice>以上仅用于复诊沟通整理，诊断与用药请以医生判断为准。</boundary_notice>
</followup>

请仅输出 XML。`;
}