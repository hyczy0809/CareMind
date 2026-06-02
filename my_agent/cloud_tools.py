import re
from datetime import datetime
from typing import Any

from .care_state import care_state

# Memory 模块（懒加载，避免循环依赖）
def _mem_tools():
    from . import memory_tools
    return memory_tools

def _mem_router():
    from . import memory_router
    return memory_router

def _mem_policy():
    from . import memory_policy
    return memory_policy


SEVERITY_SCORE = {"low": 1, "medium": 2, "high": 3}

EVENT_RULES = [
    {
        "type": "home_seeking",
        "label": "反复想回家/寻找旧家",
        "patterns": ["回家", "回老家", "要走", "找家"],
        "default_severity": "medium",
    },
    {
        "type": "medication_refusal",
        "label": "拒绝服药/漏服",
        "patterns": ["不肯吃药", "拒绝服药", "没吃药", "漏服", "藏药"],
        "default_severity": "medium",
    },
    {
        "type": "night_wandering",
        "label": "夜间起床/外出企图",
        "patterns": ["半夜", "夜里", "凌晨", "开门", "出去", "外出", "走出去"],
        "default_severity": "high",
    },
    {
        "type": "suspicion",
        "label": "怀疑/被害感表达",
        "patterns": ["偷", "害我", "骗我", "有人", "被害", "不是我"],
        "default_severity": "medium",
    },
    {
        "type": "agitation",
        "label": "激越/争吵/攻击风险",
        "patterns": ["骂", "打", "摔", "吵", "激动", "烦躁", "发火"],
        "default_severity": "medium",
    },
    {
        "type": "sleep_disruption",
        "label": "睡眠中断",
        "patterns": ["没睡", "睡不着", "起夜", "醒", "整夜"],
        "default_severity": "medium",
    },
    {
        "type": "caregiver_distress",
        "label": "照护者压力/耗竭",
        "patterns": ["崩溃", "撑不下去", "很烦", "很累", "焦虑", "抑郁", "想哭"],
        "default_severity": "high",
    },
]


def _count_frequency(text: str) -> int | None:
    match = re.search(r"(\d+)\s*(次|回|遍)", text)
    if match:
        return int(match.group(1))
    chinese_numbers = {
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
    }
    for char, value in chinese_numbers.items():
        if f"{char}次" in text or f"{char}回" in text:
            return value
    return None


def _level(score: int) -> str:
    if score >= 6:
        return "high"
    if score >= 3:
        return "medium"
    return "low"


def extract_care_signals(
    note: str,
    patient_id: str = "demo_patient",
    caregiver_id: str = "demo_caregiver",
) -> dict[str, Any]:
    """Extract white-box care events from a natural-language care note."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    events = []
    frequency = _count_frequency(note)

    for rule in EVENT_RULES:
        matched = [pattern for pattern in rule["patterns"] if pattern in note]
        if not matched:
            continue
        severity = rule["default_severity"]
        if frequency and frequency >= 3 and rule["type"] in {
            "night_wandering",
            "sleep_disruption",
            "medication_refusal",
        }:
            severity = "high"
        events.append(
            {
                "patient_id": patient_id,
                "caregiver_id": caregiver_id,
                "event_type": rule["type"],
                "event_label": rule["label"],
                "description": note,
                "severity": severity,
                "frequency": frequency,
                "evidence": matched,
                "timestamp": now,
            }
        )

    if not events:
        events.append(
            {
                "patient_id": patient_id,
                "caregiver_id": caregiver_id,
                "event_type": "general_note",
                "event_label": "一般照护记录",
                "description": note,
                "severity": "low",
                "frequency": frequency,
                "evidence": [],
                "timestamp": now,
            }
        )

    white_box_metrics = {
        "event_count": len(events),
        "high_severity_count": sum(1 for e in events if e["severity"] == "high"),
        "night_safety_markers": sum(
            1
            for e in events
            if e["event_type"] in {"night_wandering", "sleep_disruption"}
        ),
        "medication_markers": sum(
            1 for e in events if e["event_type"] == "medication_refusal"
        ),
        "caregiver_distress_markers": sum(
            1 for e in events if e["event_type"] == "caregiver_distress"
        ),
    }
    return {"events": events, "white_box_metrics": white_box_metrics}


def add_care_event(
    patient_id: str,
    event_type: str,
    description: str,
    severity: str = "medium",
    timestamp: str | None = None,
    caregiver_id: str = "demo_caregiver",
    evidence: list[str] | None = None,
    frequency: int | None = None,
) -> dict[str, Any]:
    """Persist one structured care event to cloud-side care memory."""
    event = {
        "patient_id": patient_id,
        "caregiver_id": caregiver_id,
        "event_type": event_type,
        "description": description,
        "severity": severity,
        "timestamp": timestamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "evidence": evidence or [],
        "frequency": frequency,
    }
    return care_state.add_event(patient_id, event)


def log_extracted_events(
    note: str,
    patient_id: str = "demo_patient",
    caregiver_id: str = "demo_caregiver",
) -> dict[str, Any]:
    """Extract and persist all care events from one note."""
    extracted = extract_care_signals(note, patient_id, caregiver_id)
    saved = [
        care_state.add_event(event["patient_id"], event)
        for event in extracted["events"]
    ]
    return {"saved_events": saved, "white_box_metrics": extracted["white_box_metrics"]}


def assess_patient_risk(patient_id: str = "demo_patient") -> dict[str, Any]:
    """Create a non-diagnostic patient risk card from recent care events."""
    state = care_state.get_state()
    events = state["patients"].get(patient_id, {}).get("events", [])[-20:]
    scores = {
        "night_safety": 0,
        "wandering": 0,
        "medication_adherence": 0,
        "behavior_escalation": 0,
        "sleep_disruption": 0,
    }
    reasons = []

    for event in events:
        severity_score = SEVERITY_SCORE.get(event.get("severity", "low"), 1)
        event_type = event.get("event_type")
        if event_type == "night_wandering":
            scores["night_safety"] += 2 + severity_score
            scores["wandering"] += 2 + severity_score
            reasons.append("夜间起床/开门/外出线索")
        elif event_type == "medication_refusal":
            scores["medication_adherence"] += 2 + severity_score
            reasons.append("拒药或漏服线索")
        elif event_type in {"suspicion", "agitation", "home_seeking"}:
            scores["behavior_escalation"] += 1 + severity_score
            reasons.append(event.get("event_label") or event_type)
        elif event_type == "sleep_disruption":
            scores["sleep_disruption"] += 1 + severity_score
            scores["night_safety"] += severity_score
            reasons.append("睡眠中断/起夜线索")

    card = {
        "patient_id": patient_id,
        "scope": "patient",
        "risk_levels": {key: _level(value) for key, value in scores.items()},
        "scores": scores,
        "trigger_reasons": sorted(set(reasons)),
        "safety_boundary": "非诊断性照护风险提示；如出现急性意识改变、跌倒受伤、失踪、胸痛、呼吸困难、自伤/伤人风险，应立即联系急救或医生。",
    }
    return care_state.add_patient_risk(patient_id, card)


def assess_caregiver_burden(
    caregiver_id: str = "demo_caregiver",
    patient_id: str = "demo_patient",
) -> dict[str, Any]:
    """Create a non-diagnostic caregiver support card from recent notes."""
    state = care_state.get_state()
    events = state["patients"].get(patient_id, {}).get("events", [])[-20:]
    scores = {
        "sleep_deprivation": 0,
        "emotional_distress": 0,
        "overload": 0,
        "need_for_respite": 0,
    }
    reasons = []

    for event in events:
        text = event.get("description", "")
        severity_score = SEVERITY_SCORE.get(event.get("severity", "low"), 1)
        if any(word in text for word in ["没睡", "整夜", "睡不着", "半夜"]):
            scores["sleep_deprivation"] += 2 + severity_score
            scores["need_for_respite"] += 1
            reasons.append("照护者睡眠不足表述")
        if any(word in text for word in ["崩溃", "撑不下去", "烦躁", "焦虑", "想哭"]):
            scores["emotional_distress"] += 2 + severity_score
            scores["overload"] += 1 + severity_score
            reasons.append("照护者情绪耗竭/焦虑表述")
        if event.get("event_type") in {"night_wandering", "medication_refusal"}:
            scores["overload"] += severity_score
            scores["need_for_respite"] += 1

    card = {
        "caregiver_id": caregiver_id,
        "patient_id": patient_id,
        "scope": "caregiver",
        "risk_levels": {key: _level(value) for key, value in scores.items()},
        "scores": scores,
        "trigger_reasons": sorted(set(reasons)),
        "support_boundary": "支持照护者自我照护与求助，不提供心理诊断；如出现自伤念头或无法保证安全，应立即联系当地紧急服务/危机热线/医疗专业人员。",
    }
    return care_state.add_caregiver_card(caregiver_id, card)


def create_care_plan(patient_id: str = "demo_patient") -> dict[str, Any]:
    """Create a prioritized daily care plan from latest patient/caregiver cards."""
    state = care_state.get_state()
    patient = state["patients"].get(patient_id, {})
    patient_card = (patient.get("risk_cards") or [{}])[-1]
    caregiver_card = (
        state["caregivers"].get("demo_caregiver", {}).get("support_cards") or [{}]
    )[-1]
    levels = patient_card.get("risk_levels", {})
    caregiver_levels = caregiver_card.get("risk_levels", {})

    priorities = []
    if levels.get("night_safety") == "high" or levels.get("wandering") == "high":
        priorities.append("今晚优先检查门锁、夜间动线、地面障碍与照明，降低夜间外出/跌倒风险。")
    if levels.get("medication_adherence") in {"medium", "high"}:
        priorities.append("服药前避免正面争执，先安抚和转移注意力，再按医嘱记录服药情况。")
    if levels.get("behavior_escalation") in {"medium", "high"}:
        priorities.append("减少纠正与争辩，使用确认感受、陪伴和转移注意力的话术。")
    if caregiver_levels.get("sleep_deprivation") in {"medium", "high"}:
        priorities.append("请尽量安排家人轮替一个夜间时段，照护者先补足连续睡眠。")
    if not priorities:
        priorities.append("维持日常记录，观察睡眠、服药、情绪和安全事件是否出现变化。")

    plan = {
        "patient_id": patient_id,
        "priorities": priorities,
        "tomorrow_observation": [
            "记录夜间起床/外出企图次数",
            "记录拒药/漏服是否持续",
            "记录触发行为变化的时间、场景和回应效果",
            "记录照护者睡眠和情绪负担",
        ],
        "non_diagnostic_note": "本计划用于家庭照护支持和复诊沟通准备，不替代医生诊疗。",
    }
    return care_state.add_care_plan(patient_id, plan)


def set_reminder(
    patient_id: str,
    reminder_type: str,
    time: str,
    message: str,
    level: str = "medium",
) -> dict[str, Any]:
    """Persist a mock reminder for cloud-side scheduling."""
    return care_state.add_reminder(
        patient_id,
        {
            "reminder_type": reminder_type,
            "time": time,
            "message": message,
            "level": level,
        },
    )


def get_communication_script(
    scenario_type: str,
    patient_id: str = "demo_patient",
) -> dict[str, Any]:
    """Return dementia-friendly communication scripts for common situations."""
    scripts = {
        "想回家": [
            "你是不是有点不安心？我陪你坐一会儿，我们先喝点水。",
            "那个地方对你很重要吧。你愿意和我讲讲那里吗？",
            "我们先把外套拿好，等一下我陪你一起看看。",
        ],
        "被害感": [
            "找不到东西真的会很着急，我陪你一起找。",
            "我相信你现在很不安，我们先把常用的地方看一遍。",
        ],
        "拒绝服药": [
            "我知道你现在不想吃，我们先休息两分钟。",
            "这是医生让我们每天固定做的一件小事，我陪你一起完成。",
        ],
        "拒绝洗澡": [
            "现在洗澡让你不舒服吗？我们先洗脸，等会儿再决定。",
            "水温我帮你调好，你可以慢慢来。",
        ],
    }
    matched = scripts.get(scenario_type, scripts.get("想回家"))
    return {
        "patient_id": patient_id,
        "scenario_type": scenario_type,
        "recommended_scripts": matched,
        "avoid": ["不要直接说“你记错了”", "不要用命令式催促", "不要在情绪高点争辩事实"],
    }


def generate_doctor_summary(
    patient_id: str = "demo_patient",
    date_range: str = "recent",
    include_caregiver_state: bool = True,
) -> dict[str, Any]:
    """Generate a structured follow-up summary from cloud care memory."""
    state = care_state.get_state()
    patient = state["patients"].get(patient_id, {})
    events = patient.get("events", [])[-30:]
    counts: dict[str, int] = {}
    high_events = []
    for event in events:
        counts[event.get("event_type", "unknown")] = (
            counts.get(event.get("event_type", "unknown"), 0) + 1
        )
        if event.get("severity") == "high":
            high_events.append(event)

    summary = {
        "patient_id": patient_id,
        "date_range": date_range,
        "event_counts": counts,
        "high_priority_events": high_events[-5:],
        "latest_patient_risk": (patient.get("risk_cards") or [{}])[-1],
        "latest_care_plan": (patient.get("care_plans") or [{}])[-1],
        "doctor_discussion_points": [
            "近期夜间起床/外出企图是否增加",
            "拒药或漏服是否持续、是否需要医生评估用药方案",
            "行为心理症状的触发场景和有效回应方式",
            "照护者睡眠不足和轮替照护需求",
        ],
        "boundary": "摘要用于复诊沟通，不构成诊断、处方或急救分诊。",
    }
    if include_caregiver_state:
        summary["latest_caregiver_support"] = (
            state["caregivers"].get("demo_caregiver", {}).get("support_cards") or [{}]
        )[-1]
    return summary


def get_cloud_care_state() -> dict[str, Any]:
    """Return the current shared care state for debugging and demo narration."""
    return care_state.get_state()


def run_cloud_care_workflow(
    note: str,
    patient_id: str = "demo_patient",
    caregiver_id: str = "demo_caregiver",
) -> dict[str, Any]:
    """
    CareMind Memory 增强云侧工作流（对应 CareMind_Memory.md 第 8.2 节 + MCP 扩展）：

    Step 1.  事件抽取 — extract_care_signals
    Step 2.  Memory 写入（自动）— update_event_memory
    Step 3.  Memory Router — 决定检索哪些 Memory（含 MCP 路由）
    Step 4.  执行 Memory 检索 — patient_profile / behavior_baseline / medication / recent_events
    Step 5.  专业知识检索 — retrieve_enriched_knowledge（内置 + MCP 外部混合）
    Step 6.  患者风险评估 — assess_patient_risk（结果附带 memory_context + external_knowledge）
    Step 7.  照护者压力评估 — assess_caregiver_burden
    Step 8.  照护计划生成 — create_care_plan
    Step 9.  更新照护者状态 Memory — update_caregiver_state
    Step 10. 提出长期 Memory 候选 + 门控分类 — propose_memory_update
    Step 11. 复诊摘要生成 — generate_doctor_summary
    """
    mt = _mem_tools()
    mr = _mem_router()
    mp = _mem_policy()

    # ── Step 1: 事件抽取 ────────────────────────────────
    extracted = log_extracted_events(note, patient_id, caregiver_id)
    raw_events = extracted.get("saved_events", [])

    # ── Step 2: 自动写入 Episodic Memory ────────────────
    auto_events = [ev for ev in raw_events if mp.should_auto_write(ev)]
    event_write_result = mt.update_event_memory(
        patient_id=patient_id,
        extracted_events=auto_events,
    )

    # ── Step 3: Memory Router 路由 ───────────────────────
    route_plan = mr.route_memory_requests(raw_events)

    # ── Step 4: 执行 Memory 检索 ─────────────────────────
    memory_context = mr.execute_memory_retrieval(
        patient_id=patient_id,
        caregiver_id=caregiver_id,
        route_plan=route_plan,
    )

    # ── Step 5: 患者风险评估（结果注入 memory_context 摘要）───
    patient_risk = assess_patient_risk(patient_id)
    # 将近期趋势注入风险卡片，供后续 Agent 使用
    patient_risk["memory_context_summary"] = {
        "recent_event_counts": memory_context.get("recent_events", {}).get(
            "event_type_counts", {}
        ),
        "behavior_baselines_found": list(
            memory_context.get("behavior_baseline", {})
            .get("matched_baselines", {})
            .keys()
        ),
        "medication_refusal_7d": memory_context.get("medication_memory", {}).get(
            "recent_refusal_count_7d", 0
        ),
    }

    # ── Step 6: 照护者压力评估 ────────────────────────────
    caregiver_support = assess_caregiver_burden(caregiver_id, patient_id)

    # ── Step 7: 照护计划生成（计划文本注入个性化 Memory 提示）───
    care_plan = create_care_plan(patient_id)
    # 将行为基线中的有效话术追加到计划 priorities
    matched_baselines = (
        memory_context.get("behavior_baseline", {}).get("matched_baselines", {})
    )
    for btype, bentry in matched_baselines.items():
        eff = bentry.get("effective_interventions", [])
        if eff:
            hint = f"[{bentry.get('behavior_type', btype)} 历史有效方式] " + "；".join(eff[:3])
            care_plan.setdefault("memory_enriched_hints", []).append(hint)
    # 注入专业知识摘要
    prof_knowledge = memory_context.get("professional_knowledge", [])
    if prof_knowledge:
        care_plan["professional_knowledge_applied"] = [
            k["topic"] for k in prof_knowledge
        ]

    # ── Step 8: 更新照护者状态 Memory ────────────────────
    caregiver_update = mt.update_caregiver_state(
        caregiver_id=caregiver_id,
        caregiver_signals=caregiver_support,
    )

    # ── Step 9: 提出长期 Memory 候选 + 门控分类 ────────────
    candidates = mt.propose_memory_update(
        patient_id=patient_id,
        extracted_events=raw_events,
        care_plan=care_plan,
    )
    classified = mp.classify_memory_candidates(candidates)

    # 自动写入照护者状态类候选（auto_confirm=True）
    for item in classified.get("auto_write", []):
        if item.get("memory_type") == "caregiver_state":
            pass  # 已在 Step 8 更新

    # 生成用户确认提示语
    confirmation_prompt = mp.build_confirmation_prompt(
        classified.get("needs_confirmation", [])
    )

    # ── Step 10: 复诊摘要 ──────────────────────────────────
    doctor_summary = generate_doctor_summary(patient_id, "recent", True)

    return {
        # 事件抽取
        "extracted": extracted,
        # Memory 相关
        "memory_context": {
            "route_plan": route_plan,
            "patient_profile": memory_context.get("patient_profile"),
            "medication_memory": memory_context.get("medication_memory"),
            "behavior_baseline": memory_context.get("behavior_baseline"),
            "recent_events": memory_context.get("recent_events"),
            "caregiver_state": memory_context.get("caregiver_state"),
        },
        "professional_knowledge": prof_knowledge,
        # MCP 外部知识摘要
        "mcp_knowledge_summary": memory_context.get("mcp_knowledge_summary"),
        # 各 Agent 输出
        "patient_risk": patient_risk,
        "caregiver_support": caregiver_support,
        "care_plan": care_plan,
        # Memory 更新
        "event_memory_write": event_write_result,
        "caregiver_memory_update": caregiver_update,
        "memory_update_candidates": classified,
        "memory_confirmation_prompt": confirmation_prompt,
        # 复诊摘要
        "doctor_summary": doctor_summary,
    }
