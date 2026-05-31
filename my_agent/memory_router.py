"""
CareMind Memory Router
根据当前照护事件类型，决定需要读取哪些 Memory，避免冗余调用。
对应 CareMind_Memory.md 第 9 节设计。
"""
from typing import Any


# ─────────────────────────────────────────────
# 路由规则映射表
# event_type -> 需要请求的 Memory 类型
# ─────────────────────────────────────────────

_EVENT_TO_MEMORY_RULES: dict[str, dict[str, Any]] = {
    "home_seeking": {
        "behavior_baseline": True,
        "professional_topics": ["communication_home_seeking"],
    },
    "medication_refusal": {
        "medication_memory": True,
        "professional_topics": ["medication_refusal"],
    },
    "night_wandering": {
        "behavior_baseline": True,
        "professional_topics": ["night_wandering"],
    },
    "caregiver_distress": {
        "caregiver_state": True,
        "professional_topics": ["caregiver_burden"],
    },
    "agitation": {
        "behavior_baseline": True,
        "professional_topics": ["agitation"],
    },
    "suspicion": {
        "behavior_baseline": True,
        "professional_topics": ["communication_home_seeking"],
    },
    "sleep_disruption": {
        "caregiver_state": True,
        "professional_topics": ["caregiver_burden"],
    },
    "general_note": {
        "professional_topics": [],
    },
}


def route_memory_requests(
    extracted_events: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    根据抽取的事件列表，生成 Memory 请求路由计划。

    返回结构：
    {
      "retrieve_patient_profile": True,        # 始终获取
      "retrieve_recent_events": True,          # 始终获取
      "retrieve_medication_memory": bool,
      "retrieve_caregiver_state": bool,
      "behavior_baseline_types": [...],        # 需要读取的行为基线类型
      "professional_knowledge_topics": [...],  # 需要检索的专业知识主题
    }
    """
    event_types = {ev.get("event_type", "") for ev in extracted_events}

    plan: dict[str, Any] = {
        "retrieve_patient_profile": True,   # 始终读取患者画像
        "retrieve_recent_events": True,     # 始终读取近期事件
        "retrieve_medication_memory": False,
        "retrieve_caregiver_state": False,
        "behavior_baseline_types": [],
        "professional_knowledge_topics": [],
        "detected_event_types": list(event_types),
    }

    for etype in event_types:
        rule = _EVENT_TO_MEMORY_RULES.get(etype, {})
        if rule.get("medication_memory"):
            plan["retrieve_medication_memory"] = True
        if rule.get("caregiver_state"):
            plan["retrieve_caregiver_state"] = True
        if rule.get("behavior_baseline"):
            if etype not in plan["behavior_baseline_types"]:
                plan["behavior_baseline_types"].append(etype)
        for topic in rule.get("professional_topics", []):
            if topic not in plan["professional_knowledge_topics"]:
                plan["professional_knowledge_topics"].append(topic)

    # 安全知识始终附加
    for always in ["safety_boundary", "emergency_rules"]:
        if always not in plan["professional_knowledge_topics"]:
            plan["professional_knowledge_topics"].append(always)

    return plan


def execute_memory_retrieval(
    patient_id: str,
    caregiver_id: str,
    route_plan: dict[str, Any],
) -> dict[str, Any]:
    """
    根据路由计划实际执行 Memory 检索，返回汇聚后的上下文字典。
    调用 memory_tools 中的 retrieve_* 函数。
    """
    from .memory_tools import (
        retrieve_behavior_baseline,
        retrieve_caregiver_state,
        retrieve_medication_memory,
        retrieve_patient_profile,
        retrieve_professional_knowledge,
        retrieve_recent_events,
    )

    context: dict[str, Any] = {}

    if route_plan.get("retrieve_patient_profile"):
        context["patient_profile"] = retrieve_patient_profile(patient_id)

    if route_plan.get("retrieve_recent_events"):
        context["recent_events"] = retrieve_recent_events(patient_id, days=7)

    if route_plan.get("retrieve_medication_memory"):
        context["medication_memory"] = retrieve_medication_memory(patient_id)

    if route_plan.get("retrieve_caregiver_state"):
        context["caregiver_state"] = retrieve_caregiver_state(caregiver_id)

    baseline_types = route_plan.get("behavior_baseline_types", [])
    if baseline_types:
        context["behavior_baseline"] = retrieve_behavior_baseline(
            patient_id, event_types=baseline_types
        )

    topics = route_plan.get("professional_knowledge_topics", [])
    if topics:
        context["professional_knowledge"] = retrieve_professional_knowledge(topics)

    return context
