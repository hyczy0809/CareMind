# CareMind Memory 模块设计与 Agent 调用方案

> 面向失智症家庭照护的多步规划 AI Agent  
> Memory-Augmented Care Planning Agent  
> 版本：Memory 接入现有 Agent 设计版

---

## 1. 设计目标

CareMind 的核心任务不是做一次性的照护问答，而是帮助家庭照护者持续记录、理解、计划和复诊沟通。失智症家庭照护具有明显的长期性、重复性和个体差异，因此系统必须具备长期记忆能力。

在现有 CareMind Agent 架构中，系统已经包含：

- `event_structuring_agent`：自然语言事件抽取与结构化；
- `patient_risk_agent`：患者侧非诊断性风险评估；
- `caregiver_support_agent`：照护者压力与耗竭识别；
- `care_plan_agent`：行动计划、提醒和沟通话术生成；
- `doctor_summary_agent`：复诊摘要与长期报告生成；
- `caremind_cloud_root_agent`：云侧总调度 Agent。

Memory 模块需要接入上述现有 Agent，而不是另起一套孤立流程。它的作用是在每一步 Agent 执行前后提供上下文、历史证据、个性化偏好和专业知识支持，使 CareMind 从“单轮照护助手”升级为“长期家庭照护智能体”。

---

## 2. Memory 的核心定位

CareMind 中的 Memory 不只是保存聊天记录，而是 Agent 的长期状态层。它主要承担三类功能：

1. **个性化支持**  
   记住患者的沟通方式、行为模式、用药细节、日常作息、有效安抚策略和家庭环境，使系统输出更符合具体家庭的建议。

2. **长期追踪与趋势分析**  
   记录每日照护事件，追踪夜间起床、拒药、走失倾向、情绪激化、照护者压力等变化，为周报、月报和复诊摘要提供依据。

3. **专业知识调用**  
   在云侧维护失智症照护知识、沟通原则、安全风险规则和复诊摘要模板，使 Agent 在不越界诊断和处方的前提下提供专业支持。

因此，CareMind 的 Memory 可以定义为：

> Memory 是 CareMind 多步规划 Agent 的状态管理与知识增强层，用于连接“当前输入”“历史照护过程”“个性化患者画像”和“专业照护知识”，从而支持可解释、可追踪、可个性化的家庭照护规划。

---

## 3. 端侧 Memory 与云侧 Memory 的分工

CareMind 的 Memory 建议采用端云协同架构。

端侧 Memory 主要保存家庭高度敏感、个体化、低延迟调用的信息；云侧 Memory 主要保存专业知识、长期趋势和脱敏后的结构化摘要。

| 层级 | Memory 类型 | 保存内容 | 主要作用 | 隐私策略 |
|---|---|---|---|---|
| 端侧 | Patient Profile Memory | 年龄、诊断阶段、病史、作息、沟通偏好 | 个性化理解患者 | 默认本地保存 |
| 端侧 | Medication Memory | 当前用药、剂量、时间、拒药/漏服记录 | 支持服药提醒和复诊记录 | 默认本地保存 |
| 端侧 | Behavior Baseline Memory | 常见行为、触发因素、有效/无效应对方式 | 支持个性化沟通和计划 | 默认本地保存 |
| 端侧 | Recent Episodic Memory | 最近几天照护事件、对话上下文 | 支持连续多轮照护规划 | 可摘要后上传 |
| 云侧 | Knowledge Memory | 失智症照护指南、沟通原则、安全边界 | 提供专业知识支持 | 云侧维护 |
| 云侧 | Trend Memory | 脱敏结构化事件、周/月变化趋势 | 生成复诊摘要和长期趋势 | 仅上传结构化信号 |
| 云侧 | Safety Memory | 禁止输出、急症规则、医疗边界 | 防止越界医疗建议 | 云侧统一维护 |

推荐的数据流是：

```text
端侧保存原始家庭细节
    ↓
端侧抽取结构化照护信号
    ↓
脱敏摘要同步到云侧
    ↓
云侧调用专业知识与趋势分析
    ↓
端侧结合患者画像生成最终个性化建议
```

这种设计可以兼顾隐私保护、个性化支持和专业可靠性。

---

## 4. Memory 模块的总体架构

在现有 CareMind Agent 结构上，可以新增三个与 Memory 相关的模块：

1. `memory_router_agent`  
   判断当前任务需要读取哪些记忆，包括患者画像、用药信息、行为基线、近期事件和云侧知识。

2. `memory_update_agent`  
   在 Agent 完成事件抽取、风险评估和计划生成后，判断哪些内容需要写入或更新 Memory。

3. `knowledge_retrieval_agent`  
   从云侧专业知识库中检索与当前照护事件相关的知识条目、安全规则和沟通原则。

整体结构如下：

```text
caremind_cloud_root_agent
├── event_structuring_agent
│   └── 抽取自然语言照护事件
│
├── memory_router_agent
│   ├── retrieve_patient_profile
│   ├── retrieve_medication_memory
│   ├── retrieve_behavior_baseline
│   ├── retrieve_recent_events
│   └── retrieve_similar_cases
│
├── knowledge_retrieval_agent
│   ├── retrieve_care_guidelines
│   ├── retrieve_communication_principles
│   └── retrieve_safety_rules
│
├── patient_risk_agent
│   └── 结合当前事件 + 历史记忆评估患者侧风险
│
├── caregiver_support_agent
│   └── 结合当前表达 + 历史压力记录评估照护者状态
│
├── care_plan_agent
│   └── 结合风险卡片 + Memory + 专业知识生成行动计划
│
├── memory_update_agent
│   ├── update_event_memory
│   ├── update_profile_memory
│   ├── update_behavior_baseline
│   ├── update_medication_memory
│   └── update_caregiver_state
│
└── doctor_summary_agent
    └── 调用长期趋势 Memory 生成复诊摘要
```

---

## 5. Memory 的数据结构设计

### 5.1 Patient Profile Memory

用于保存患者基础信息、病程阶段、日常习惯和沟通偏好。

```json
{
  "patient_id": "demo_patient",
  "basic_profile": {
    "age": 78,
    "diagnosis": "阿尔兹海默病",
    "stage": "中度",
    "primary_language": "普通话",
    "hearing_or_vision_issue": "听力稍弱"
  },
  "daily_routine": {
    "wake_time": "07:30",
    "nap_time": "14:00",
    "sleep_time": "21:30",
    "usual_agitation_time": "17:00-19:00"
  },
  "communication_style": {
    "preferred_tone": "温和、慢速、少纠正",
    "effective_phrases": [
      "先陪她坐下喝水",
      "提到老家时不要直接否定",
      "用老照片转移注意力"
    ],
    "ineffective_phrases": [
      "你已经在家了",
      "你怎么又忘了",
      "别闹了"
    ]
  }
}
```

### 5.2 Medication Memory

用于保存当前用药信息、服药时间、拒药/漏药历史和医生备注。

```json
{
  "patient_id": "demo_patient",
  "current_medications": [
    {
      "name": "药物A",
      "dose": "5mg",
      "schedule": "晚饭后",
      "source": "doctor",
      "last_confirmed_at": "2026-05-30",
      "note": "晚饭后情绪稳定时提醒，避免争执"
    }
  ],
  "medication_events": [
    {
      "event_type": "medication_refusal",
      "time": "2026-05-29 20:00",
      "evidence": "晚上不肯吃药",
      "action": "记录并建议复诊时与医生讨论"
    }
  ],
  "doctor_notes": [
    "不要自行调整药量",
    "持续记录拒药和漏服情况"
  ]
}
```

### 5.3 Behavior Baseline Memory

用于保存患者常见行为模式、触发因素和有效干预方式。

```json
{
  "patient_id": "demo_patient",
  "behavior_baselines": [
    {
      "behavior_type": "home_seeking",
      "description": "反复说要回老家",
      "usual_time": "下午或黄昏",
      "known_triggers": [
        "下午睡太久",
        "环境嘈杂",
        "家中来陌生人"
      ],
      "effective_interventions": [
        "陪她坐下喝水",
        "看老照片",
        "播放熟悉的老歌"
      ],
      "ineffective_interventions": [
        "直接纠正说这里就是家",
        "反复讲道理"
      ]
    }
  ]
}
```

### 5.4 Episodic Event Memory

用于保存每天发生的结构化照护事件。

```json
{
  "event_id": "evt_20260530_001",
  "patient_id": "demo_patient",
  "timestamp": "2026-05-30 21:30",
  "event_type": "night_wandering",
  "severity": "high",
  "description": "半夜起来三次，并尝试开门出去",
  "evidence_text": "半夜起来三次，还想开门出去",
  "linked_plan_id": "plan_20260530_001",
  "outcome": "unknown"
}
```

### 5.5 Caregiver State Memory

用于保存照护者睡眠、压力、情绪耗竭和支持资源。

```json
{
  "caregiver_id": "demo_caregiver",
  "recent_state": {
    "sleep_status": "severe_deprivation",
    "distress_level": "high",
    "evidence": [
      "我昨天几乎没睡",
      "整个人很烦躁"
    ],
    "last_updated": "2026-05-30"
  },
  "support_resources": {
    "family_members": [
      "配偶",
      "子女"
    ],
    "community_support": [],
    "preferred_support_strategy": "夜间轮替照护"
  }
}
```

### 5.6 Knowledge Memory

用于保存云侧专业知识、照护原则和安全边界。

```json
{
  "knowledge_id": "night_wandering_safety_001",
  "topic": "night_wandering",
  "source": "public_care_guideline",
  "content": "夜间起床和尝试外出时，应优先关注门锁、照明、动线障碍和跌倒风险。",
  "applicable_when": [
    "夜间起床",
    "开门外出",
    "曾经走失"
  ],
  "safety_boundary": [
    "不承诺完全避免走失",
    "如已失踪或发生跌倒，应联系急救或当地紧急服务"
  ]
}
```

---

## 6. 现有 Agent 中如何调用 Memory

Memory 模块应该以工具函数的形式接入现有 Agent。也就是说，现有 Agent 不需要重写，只需要在关键节点增加 Memory 调用。

### 6.1 新增文件建议

可以在当前项目中新增：

```text
my_agent/
├── memory_state.py           # Memory 的读写与本地/云侧状态管理
├── memory_tools.py           # 提供给 Agent 调用的 Memory 工具函数
├── memory_schema.py          # 定义 Memory 数据结构
├── memory_router.py          # 判断当前任务需要读取哪些 Memory
└── memory_policy.py          # Memory 写入门控与安全策略
```

与现有文件的关系：

```text
my_agent/
├── agent.py
├── cloud_agents.py
├── cloud_tools.py
├── care_state.py
├── memory_state.py           # 新增
├── memory_tools.py           # 新增
├── memory_schema.py          # 新增
├── memory_router.py          # 新增
└── memory_policy.py          # 新增
```

---

## 7. Memory 工具函数设计

### 7.1 读取类工具

```python
def retrieve_patient_profile(patient_id: str) -> dict:
    """
    读取患者基础画像、作息、沟通偏好和家庭环境。
    主要供 memory_router_agent、patient_risk_agent、care_plan_agent 调用。
    """
    ...


def retrieve_medication_memory(patient_id: str) -> dict:
    """
    读取当前用药清单、服药时间、拒药/漏服历史和医生备注。
    主要供 event_structuring_agent、patient_risk_agent、care_plan_agent 调用。
    """
    ...


def retrieve_behavior_baseline(patient_id: str, event_types: list[str]) -> dict:
    """
    根据当前事件类型读取相关行为基线。
    例如 home_seeking、night_wandering、agitation、medication_refusal。
    """
    ...


def retrieve_recent_events(
    patient_id: str,
    date_range: str = "7d",
    event_types: list[str] | None = None
) -> list[dict]:
    """
    读取最近一段时间内的结构化照护事件，用于趋势判断。
    """
    ...


def retrieve_similar_care_cases(
    patient_id: str,
    current_event: dict,
    top_k: int = 3
) -> list[dict]:
    """
    检索过去相似照护事件及对应处理结果。
    用于回答“以前类似情况怎么处理有效”。
    """
    ...


def retrieve_professional_knowledge(
    topics: list[str],
    risk_level: str | None = None
) -> list[dict]:
    """
    从云侧专业知识库中检索相关照护知识、沟通原则和安全边界。
    """
    ...
```

### 7.2 写入类工具

```python
def update_event_memory(patient_id: str, extracted_events: list[dict]) -> dict:
    """
    将 event_structuring_agent 抽取出的结构化事件写入 Episodic Event Memory。
    """
    ...


def update_caregiver_state(caregiver_id: str, caregiver_signals: dict) -> dict:
    """
    更新照护者睡眠、压力、情绪耗竭等状态。
    """
    ...


def propose_memory_update(
    patient_id: str,
    extracted_events: list[dict],
    care_plan: dict
) -> list[dict]:
    """
    根据当前事件和计划，提出候选 Memory 更新。
    例如发现“下午经常想回家”可能需要写入行为基线。
    """
    ...


def confirm_and_update_memory(
    patient_id: str,
    memory_items: list[dict],
    user_confirmed: bool = False
) -> dict:
    """
    对需要用户确认的长期 Memory 进行写入。
    例如沟通偏好、长期触发因素、药物相关观察。
    """
    ...


def update_behavior_baseline(
    patient_id: str,
    behavior_type: str,
    trigger: str | None,
    effective_strategy: str | None,
    ineffective_strategy: str | None,
    evidence: str
) -> dict:
    """
    更新患者行为基线，包括触发因素和有效/无效干预方式。
    """
    ...
```

---

## 8. 在现有工作流中的调用位置

### 8.1 原始工作流

当前云侧工作流可以抽象为：

```text
note
  -> event_structuring_agent
  -> patient_risk_agent
  -> caregiver_support_agent
  -> care_plan_agent
  -> doctor_summary_agent
```

### 8.2 接入 Memory 后的工作流

接入 Memory 后，推荐改为：

```text
note
  -> event_structuring_agent
     抽取当前事件
  -> memory_router_agent
     根据事件类型读取相关患者画像、行为基线、用药记忆和近期事件
  -> knowledge_retrieval_agent
     检索云侧专业知识和安全规则
  -> patient_risk_agent
     基于当前事件 + 历史记忆 + 专业知识进行风险评估
  -> caregiver_support_agent
     基于当前压力信号 + 历史压力状态进行照护者支持评估
  -> care_plan_agent
     基于风险卡片 + 个性化 Memory + 专业知识生成行动计划
  -> memory_update_agent
     写入事件、更新照护者状态、提出长期记忆更新
  -> doctor_summary_agent
     读取长期趋势，生成复诊摘要
```

### 8.3 代码级伪实现

可以将原本的 `run_cloud_care_workflow` 扩展为：

```python
def run_cloud_care_workflow(
    note: str,
    patient_id: str = "demo_patient",
    caregiver_id: str = "demo_caregiver"
) -> dict:
    """
    CareMind 云侧完整工作流：
    1. 事件抽取
    2. Memory 检索
    3. 专业知识检索
    4. 患者风险评估
    5. 照护者压力评估
    6. 照护计划生成
    7. Memory 更新
    8. 复诊摘要生成
    """

    # Step 1. 从自然语言中抽取照护事件
    extracted = extract_care_signals(note)

    # Step 2. 写入当天事件 Memory
    event_write_result = update_event_memory(
        patient_id=patient_id,
        extracted_events=extracted["events"]
    )

    # Step 3. 根据当前事件类型检索个性化 Memory
    event_types = [event["event_type"] for event in extracted["events"]]

    patient_profile = retrieve_patient_profile(patient_id)
    medication_memory = retrieve_medication_memory(patient_id)
    behavior_baseline = retrieve_behavior_baseline(
        patient_id=patient_id,
        event_types=event_types
    )
    recent_events = retrieve_recent_events(
        patient_id=patient_id,
        date_range="7d",
        event_types=event_types
    )
    similar_cases = retrieve_similar_care_cases(
        patient_id=patient_id,
        current_event=extracted
    )

    # Step 4. 从云侧知识库检索专业知识和安全边界
    professional_knowledge = retrieve_professional_knowledge(
        topics=event_types
    )
    safety_rules = retrieve_professional_knowledge(
        topics=["safety_boundary", "emergency_rules"]
    )

    # Step 5. 患者侧风险评估
    patient_risk = assess_patient_risk(
        patient_id=patient_id,
        events_today=extracted["events"],
        patient_profile=patient_profile,
        medication_memory=medication_memory,
        behavior_baseline=behavior_baseline,
        recent_events=recent_events,
        professional_knowledge=professional_knowledge
    )

    # Step 6. 照护者侧支持评估
    caregiver_risk = assess_caregiver_burden(
        caregiver_id=caregiver_id,
        note=note,
        extracted_events=extracted["events"],
        recent_events=recent_events
    )

    # Step 7. 生成照护计划
    care_plan = create_care_plan(
        patient_id=patient_id,
        risk_profile=patient_risk,
        caregiver_profile=caregiver_risk,
        patient_profile=patient_profile,
        medication_memory=medication_memory,
        behavior_baseline=behavior_baseline,
        similar_cases=similar_cases,
        professional_knowledge=professional_knowledge,
        safety_rules=safety_rules
    )

    # Step 8. 更新照护者状态 Memory
    caregiver_update = update_caregiver_state(
        caregiver_id=caregiver_id,
        caregiver_signals=caregiver_risk
    )

    # Step 9. 提出长期 Memory 更新候选
    memory_update_candidates = propose_memory_update(
        patient_id=patient_id,
        extracted_events=extracted["events"],
        care_plan=care_plan
    )

    # Step 10. 生成复诊摘要
    doctor_summary = generate_doctor_summary(
        patient_id=patient_id,
        date_range="7d",
        include_caregiver_state=True
    )

    return {
        "extracted_events": extracted,
        "memory_context": {
            "patient_profile": patient_profile,
            "medication_memory": medication_memory,
            "behavior_baseline": behavior_baseline,
            "recent_events": recent_events,
            "similar_cases": similar_cases
        },
        "professional_knowledge": professional_knowledge,
        "patient_risk": patient_risk,
        "caregiver_risk": caregiver_risk,
        "care_plan": care_plan,
        "memory_update_candidates": memory_update_candidates,
        "doctor_summary": doctor_summary
    }
```

---

## 9. Memory Router 的设计

Memory Router 的作用是根据当前输入决定“该查哪些记忆”。它避免所有 Agent 每次都读取全部 Memory，降低冗余和隐私暴露。

### 9.1 输入

```json
{
  "note": "妈妈今天下午一直说要回老家，晚上不肯吃药，半夜起来三次，还想开门出去。我昨天几乎没睡，整个人很烦躁。",
  "extracted_events": [
    "home_seeking",
    "medication_refusal",
    "night_wandering",
    "caregiver_distress"
  ]
}
```

### 9.2 Router 规则

```python
def route_memory_requests(extracted_events: list[dict]) -> dict:
    event_types = {event["event_type"] for event in extracted_events}

    requests = {
        "patient_profile": True,
        "recent_events": True,
        "behavior_baseline": [],
        "medication_memory": False,
        "caregiver_state": False,
        "professional_topics": []
    }

    if "home_seeking" in event_types:
        requests["behavior_baseline"].append("home_seeking")
        requests["professional_topics"].append("communication_home_seeking")

    if "medication_refusal" in event_types:
        requests["medication_memory"] = True
        requests["professional_topics"].append("medication_refusal")

    if "night_wandering" in event_types:
        requests["behavior_baseline"].append("night_wandering")
        requests["professional_topics"].append("night_wandering_safety")

    if "caregiver_distress" in event_types:
        requests["caregiver_state"] = True
        requests["professional_topics"].append("caregiver_burden")

    return requests
```

### 9.3 输出

```json
{
  "retrieve_patient_profile": true,
  "retrieve_medication_memory": true,
  "retrieve_behavior_baseline": [
    "home_seeking",
    "night_wandering"
  ],
  "retrieve_recent_events": {
    "date_range": "7d",
    "event_types": [
      "home_seeking",
      "medication_refusal",
      "night_wandering"
    ]
  },
  "retrieve_caregiver_state": true,
  "retrieve_professional_knowledge": [
    "communication_home_seeking",
    "medication_refusal",
    "night_wandering_safety",
    "caregiver_burden"
  ]
}
```

---

## 10. Memory 写入门控机制

Memory 不能什么都写。尤其是医疗相邻场景，错误记忆、过期记忆和未经确认的推断都可能影响后续建议。

因此需要 Memory Gate。

### 10.1 自动写入

以下内容可以自动写入 Episodic Event Memory：

- 当天夜间起床次数；
- 当天拒药/漏药事件；
- 当天外出或开门尝试；
- 当天反复说“要回家”；
- 照护者明确表达“没睡”“很累”“崩溃”等压力信号。

示例：

```json
{
  "memory_type": "episodic_event",
  "write_policy": "auto",
  "content": {
    "event_type": "night_wandering",
    "frequency": 3,
    "evidence": "半夜起来三次，还想开门出去"
  }
}
```

### 10.2 需要用户确认后写入

以下内容会影响长期个性化策略，需要确认：

- “患者通常在下午想回家”；
- “看老照片能缓解焦虑”；
- “直接纠正会激化情绪”；
- “某个药物后似乎更烦躁”；
- “某个家庭成员适合夜间轮替”。

示例确认语：

```text
我注意到“下午说要回家”似乎反复出现。是否将它记录为一个常见行为模式，以便之后优先提醒你在下午提前安抚？
```

### 10.3 不应写成确定事实

以下内容不能直接写成确定 Memory：

- “药物导致情绪波动”；
- “患者病情加重”；
- “照护者有抑郁症”；
- “患者一定存在某种疾病变化”。

应该写成观察线索：

```json
{
  "memory_type": "observation",
  "content": "服药后曾出现烦躁，建议持续记录并在复诊时与医生讨论。",
  "certainty": "observed_signal_not_medical_conclusion"
}
```

---

## 11. 示例：一次输入中的完整 Memory 调用链

### 11.1 用户输入

```text
妈妈今天下午一直说要回老家，晚上不肯吃药，半夜起来三次，还想开门出去。我昨天几乎没睡，整个人很烦躁。
```

### 11.2 Step 1：事件抽取 Agent

`event_structuring_agent` 输出：

```json
{
  "events": [
    {
      "event_type": "home_seeking",
      "time": "afternoon",
      "frequency": "repeated",
      "severity": "medium",
      "evidence": "今天下午一直说要回老家"
    },
    {
      "event_type": "medication_refusal",
      "time": "evening",
      "frequency": 1,
      "severity": "medium",
      "evidence": "晚上不肯吃药"
    },
    {
      "event_type": "night_wandering",
      "time": "night",
      "frequency": 3,
      "severity": "high",
      "evidence": "半夜起来三次，还想开门出去"
    },
    {
      "event_type": "caregiver_distress",
      "time": "recent",
      "severity": "high",
      "evidence": "我昨天几乎没睡，整个人很烦躁"
    }
  ]
}
```

### 11.3 Step 2：Memory Router 决定检索内容

系统识别到四类事件：

```text
home_seeking
medication_refusal
night_wandering
caregiver_distress
```

因此需要检索：

```text
1. 患者画像：了解患者阶段、作息、沟通偏好；
2. 行为基线：查找“想回家”和“夜间起床”的历史模式；
3. 用药记忆：查找当前药物、服药时间、既往拒药记录；
4. 近期事件：查找过去 7 天是否有类似事件；
5. 照护者状态：查找是否连续睡眠不足；
6. 云侧知识：检索夜间 wandering、拒药沟通、照护者压力支持。
```

### 11.4 Step 3：端侧 Memory 返回个性化上下文

```json
{
  "patient_profile": {
    "stage": "中度",
    "usual_agitation_time": "17:00-19:00",
    "preferred_tone": "温和、慢速、少纠正"
  },
  "behavior_baseline": {
    "home_seeking": {
      "usual_time": "下午或黄昏",
      "effective_interventions": [
        "陪她坐下喝水",
        "看老照片",
        "播放熟悉老歌"
      ],
      "ineffective_interventions": [
        "直接说这里就是家",
        "反复讲道理"
      ]
    },
    "night_wandering": {
      "known_risk": "夜间可能开门外出",
      "home_environment_note": "家门目前没有门磁提醒"
    }
  },
  "medication_memory": {
    "schedule": "晚饭后",
    "recent_refusal_count_7d": 2,
    "doctor_note": "不要自行调整药量，持续记录拒药情况"
  },
  "caregiver_state": {
    "recent_sleep_deprivation": true,
    "distress_level": "high"
  }
}
```

### 11.5 Step 4：云侧 Knowledge Memory 返回专业知识

```json
{
  "professional_knowledge": [
    {
      "topic": "night_wandering_safety",
      "content": "夜间起床和开门外出时，应优先检查门锁、照明、动线障碍和跌倒风险。"
    },
    {
      "topic": "communication_home_seeking",
      "content": "面对想回家表达时，应减少事实纠正，优先共情、安抚和转移注意力。"
    },
    {
      "topic": "medication_refusal",
      "content": "拒药时不应强迫或自行补药，应记录发生时间、场景和持续频率，并在复诊时与医生讨论。"
    },
    {
      "topic": "caregiver_burden",
      "content": "连续睡眠不足和明显烦躁提示照护者需要轮替照护、休息和外部支持。"
    }
  ]
}
```

### 11.6 Step 5：患者风险 Agent

`patient_risk_agent` 结合当前事件、近期趋势和专业知识，输出：

```json
{
  "patient_risk": {
    "night_safety": {
      "level": "high",
      "reason": "半夜起床 3 次并尝试开门外出，且近期已有夜间安全相关记录。"
    },
    "medication_adherence": {
      "level": "medium",
      "reason": "今日拒药 1 次，过去 7 天已有 2 次拒药记录。"
    },
    "behavior_escalation": {
      "level": "medium_high",
      "reason": "下午反复想回家，与既往黄昏时段行为基线一致。"
    }
  }
}
```

### 11.7 Step 6：照护者支持 Agent

`caregiver_support_agent` 输出：

```json
{
  "caregiver_risk": {
    "sleep_deprivation": {
      "level": "high",
      "reason": "照护者明确表达几乎没睡。"
    },
    "emotional_burden": {
      "level": "high",
      "reason": "照护者表达烦躁，且当前患者夜间安全风险较高。"
    },
    "support_need": {
      "level": "high",
      "recommendation": "建议尽快安排家庭成员轮替照护。"
    }
  }
}
```

### 11.8 Step 7：照护计划 Agent

`care_plan_agent` 生成个性化计划：

```text
今晚优先事项：

1. 夜间安全优先
   - 睡前检查门锁；
   - 保持走廊小夜灯；
   - 移开门口和床边障碍物；
   - 如果条件允许，临时增加门口提醒装置。

2. 对“要回家”的沟通建议
   - 不建议直接说“这里就是家”；
   - 可以说：“你是不是有点想老家？我们先坐下来喝点水，我陪你看看照片。”
   - 如果她继续焦虑，可以播放她熟悉的老歌或转移到安静环境。

3. 关于拒药
   - 记录今晚拒药时间和场景；
   - 不建议自行加量或补药；
   - 如果拒药持续出现，建议复诊时与医生讨论。

4. 照护者支持
   - 你昨晚几乎没睡，今晚建议尽量请其他家庭成员轮替；
   - 如果无法轮替，至少安排一段固定休息时间；
   - 当前优先级不是把所有事情都做完，而是先保证夜间安全和你的基本睡眠。
```

### 11.9 Step 8：Memory Update Agent

系统写入当天事件：

```json
{
  "auto_written_memory": [
    "home_seeking event",
    "medication_refusal event",
    "night_wandering event",
    "caregiver_distress event"
  ]
}
```

系统提出候选长期 Memory 更新：

```json
{
  "memory_update_candidates": [
    {
      "memory_type": "behavior_baseline",
      "content": "患者下午或黄昏更容易出现想回家的表达。",
      "requires_confirmation": true
    },
    {
      "memory_type": "communication_preference",
      "content": "直接纠正“这里就是家”可能使患者更焦虑，建议优先共情和转移注意力。",
      "requires_confirmation": true
    },
    {
      "memory_type": "caregiver_state",
      "content": "照护者近期存在明显睡眠不足。",
      "requires_confirmation": false
    }
  ]
}
```

系统可以追问：

```text
我注意到“下午说要回家”和“夜间起床”可能已经成为近期反复出现的模式。是否将它们记录为常见照护模式，以便之后提前提醒你做准备？
```

---

## 12. Doctor Summary Agent 如何调用 Memory

复诊摘要不应该只根据最近一次输入生成，而应调用长期 Memory。

### 12.1 读取内容

```python
def generate_doctor_summary(
    patient_id: str,
    date_range: str = "30d",
    include_caregiver_state: bool = True
) -> dict:
    recent_events = retrieve_recent_events(
        patient_id=patient_id,
        date_range=date_range
    )
    medication_memory = retrieve_medication_memory(patient_id)
    behavior_baseline = retrieve_behavior_baseline(
        patient_id=patient_id,
        event_types=[
            "home_seeking",
            "night_wandering",
            "medication_refusal",
            "agitation"
        ]
    )
    caregiver_state = retrieve_caregiver_state(
        caregiver_id="demo_caregiver",
        date_range=date_range
    )

    summary = summarize_for_doctor(
        recent_events=recent_events,
        medication_memory=medication_memory,
        behavior_baseline=behavior_baseline,
        caregiver_state=caregiver_state
    )

    return summary
```

### 12.2 输出示例

```text
过去 30 天复诊摘要：

1. 夜间安全
   - 夜间起床记录共 18 次；
   - 其中 5 次伴随开门或外出意图；
   - 最近一周频率较前一周增加。

2. 服药情况
   - 拒药记录共 6 次；
   - 多发生在晚饭后；
   - 家属未自行调整药量，仅记录情况。

3. 行为心理症状
   - “要回家”表达共记录 12 次；
   - 主要集中在下午或黄昏；
   - 看老照片、喝水和播放熟悉音乐通常有缓解作用。

4. 照护者状态
   - 家属多次表达睡眠不足和明显疲惫；
   - 建议医生或社区照护人员关注家庭照护负担。
```

---

## 13. Safety Memory 与输出边界

CareMind 必须坚持非诊断性照护支持边界。Memory 模块中应显式保存 Safety Memory，供所有 Agent 调用。

### 13.1 Safety Memory 示例

```json
{
  "medical_boundary": [
    "不诊断疾病",
    "不判断病情是否恶化",
    "不建议增减药物",
    "不替代医生或急救服务"
  ],
  "medication_boundary": [
    "面对拒药、漏药或疑似副作用，只能建议记录并咨询医生",
    "不得建议自行补服、停药、加量或换药"
  ],
  "emergency_rules": [
    {
      "condition": "跌倒受伤、急性意识改变、呼吸困难、胸痛、失踪、自伤或伤人风险",
      "action": "建议立即联系急救或当地紧急服务"
    }
  ],
  "language_style": [
    "使用非诊断性表述",
    "输出照护优先级而不是医学结论",
    "说明触发依据",
    "必要时建议联系医生"
  ]
}
```

### 13.2 安全审查流程

```text
care_plan_agent 生成初步计划
  ↓
retrieve_safety_rules
  ↓
safety_check_agent
  ↓
删除或改写越界医疗建议
  ↓
输出最终照护支持建议
```

示例改写：

```text
不安全输出：
“今晚拒药后明天早上补一片。”

安全输出：
“请记录今晚拒药的时间和原因，不建议自行补药或调整剂量。如果拒药持续出现，建议联系医生或在复诊时讨论。”
```

---

## 14. Demo 展示建议

为了突出 Memory 价值，Demo 不要只展示一次输入，而要展示连续多天的变化。

### Day 1

用户输入：

```text
妈妈下午一直说要回老家，晚上不肯吃药，半夜起来两次。
```

系统行为：

```text
- 抽取 home_seeking、medication_refusal、night_wandering；
- 写入事件 Memory；
- 检索通用专业知识；
- 生成当晚安全计划；
- 提出是否记录“下午容易想回家”的候选 Memory。
```

### Day 2

用户输入：

```text
她今天又说要回家了，我按照昨天说的陪她看照片，好像好了点。
```

系统行为：

```text
- 识别与 Day 1 相似事件；
- 调用 Day 1 Memory；
- 将“看照片有效”作为候选沟通策略；
- 询问是否写入 Behavior Baseline Memory。
```

### Day 7

用户输入：

```text
帮我总结一下这周情况，明天要去复诊。
```

系统行为：

```text
- 调用过去 7 天 Episodic Memory；
- 汇总夜间起床、拒药、想回家、照护者压力；
- 调用 Medication Memory；
- 生成复诊摘要；
- 明确提示“不替代医生诊断，仅供复诊沟通参考”。
```

这样可以清楚展示：

```text
没有 Memory：
系统只能每次给通用建议。

有 Memory：
系统能知道这个患者过去发生过什么、哪些方法有效、风险是否变高、复诊应该带什么信息。
```

---

## 15. 最小可行实现版本

建议先实现一个轻量 MVP，而不是一开始就做复杂数据库。

### 15.1 本地 JSON 版本

```text
my_agent/memory_store/
├── patient_profile.json
├── medication_memory.json
├── behavior_baseline.json
├── episodic_events.json
├── caregiver_state.json
├── knowledge_memory.json
└── safety_memory.json
```

优点：

- Demo 容易实现；
- 方便展示端侧 Memory；
- 方便调试；
- 与现有 `care_state.json` 设计兼容。

### 15.2 SQLite 版本

后续可升级为：

```text
patients
medications
care_events
behavior_baselines
caregiver_states
knowledge_chunks
safety_rules
doctor_summaries
```

### 15.3 向量检索版本

再进一步可以加入：

```text
结构化数据库：
- 保存事件、时间、频率、严重度、趋势统计；

向量数据库：
- 保存自然语言描述、医生建议、类似案例、沟通反馈；
- 支持 retrieve_similar_care_cases。
```

---

## 16. 可写入项目文档的总结表述

CareMind 的 Memory 设计可以概括为：

> CareMind 采用端云协同的双层 Memory 架构。端侧 Memory 负责保存患者画像、用药细节、沟通偏好、行为基线和近期照护事件，使 Agent 能够理解“这个家庭”的长期上下文；云侧 Memory 负责维护失智症照护知识、安全边界、长期趋势和复诊摘要模板，使 Agent 能够在不替代医生的前提下提供专业化支持。现有多 Agent 工作流通过 Memory Router 在每一步动态检索相关记忆，并通过 Memory Update Agent 在事件抽取和计划生成后更新长期状态，从而形成“记录—理解—计划—执行—更新—总结”的闭环。

更简短的版本：

> Memory 是 CareMind 从单轮照护问答升级为长期照护 Agent 的关键模块。它一方面在端侧记录患者和照护者的个性化状态，另一方面在云侧调用专业知识和长期趋势，使多步规划 Agent 能够生成更安全、更个性化、更可追踪的照护建议。

---

## 17. 最终推荐实现路径

推荐按照以下顺序实现：

```text
第一步：
在 care_state.json 基础上扩展 memory_store，先支持 JSON 读写。

第二步：
新增 memory_tools.py，提供 retrieve 和 update 两类工具函数。

第三步：
修改 run_cloud_care_workflow，在事件抽取后增加 Memory 检索，在计划生成后增加 Memory 更新。

第四步：
新增 Memory Router，根据事件类型决定读取哪些 Memory。

第五步：
新增 Memory Gate，区分自动写入、用户确认后写入和禁止写入。

第六步：
用连续三天 Demo 展示 Memory 的效果。

第七步：
再考虑 SQLite / 向量数据库 / 云侧 RAG 的增强版本。
```

最终目标是让 CareMind 不只是回答“现在该怎么办”，而是能够持续理解：

```text
这个患者过去发生过什么；
这个家庭怎么沟通更有效；
哪些风险正在升高；
哪些信息应该带给医生；
哪些建议不能越过医疗边界。
```

这才是面向失智症家庭照护的 Memory-Augmented Multi-step Planning Agent。
