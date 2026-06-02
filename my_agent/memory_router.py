"""
CareMind Memory Router
根据当前照护事件类型，决定需要读取哪些 Memory，避免冗余调用。
对应 CareMind_Memory.md 第 9 节设计。

MCP 知识路由：
  当事件涉及药物相关话题（medication_refusal、polypharmacy 等）时，
  路由计划中会附加 mcp_knowledge_topics，由 execute_memory_retrieval
  调用 MCPKnowledgeHub 查询外部药学数据库（如 DrugBank）。
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
        "professional_topics": ["medication_refusal", "medication", "adverse_effects"],
        "mcp_knowledge_topics": ["medication", "medication_refusal"],  # ← 路由到 MCP
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
      "mcp_knowledge_topics": [...],           # 新增：MCP 外部知识主题
      "extract_drug_names": bool,              # 新增：是否需从用药记忆中提取药名
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
        "mcp_knowledge_topics": [],         # 新增
        "extract_drug_names": False,        # 新增
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
        # MCP 外部知识路由
        for mtopic in rule.get("mcp_knowledge_topics", []):
            if mtopic not in plan["mcp_knowledge_topics"]:
                plan["mcp_knowledge_topics"].append(mtopic)
                plan["extract_drug_names"] = True

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

    Memory 知识层级：
    1. 端侧 Memory（patient_profile, medication_memory, behavior_baseline 等）
    2. 内置专业知识（KNOWLEDGE_DB）
    3. 外部 MCP 知识（DrugBank 等，按需异步查询）← 新增

    当 route_plan["extract_drug_names"] == True 时，
    从 medication_memory 中提取当前用药名，查询外部 MCP 源。
    """
    from .memory_tools import (
        retrieve_behavior_baseline,
        retrieve_caregiver_state,
        retrieve_medication_memory,
        retrieve_patient_profile,
        retrieve_professional_knowledge,
        retrieve_recent_events,
        retrieve_enriched_knowledge,       # 新增：内置 + 外部混合
        query_external_knowledge,          # 新增：纯外部查询
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

    # ── 专业知识检索（内置 + 外部 MCP）──
    topics = route_plan.get("professional_knowledge_topics", [])
    mcp_topics = route_plan.get("mcp_knowledge_topics", [])
    should_query_mcp = route_plan.get("extract_drug_names", False)

    if topics and should_query_mcp:
        # 提取当前用药名，作为 MCP 查询关键词
        med_mem = context.get("medication_memory", {})
        current_meds = med_mem.get("current_medications", [])
        drug_names = [m.get("name", "") for m in current_meds if m.get("name")]

        # 增强检索：内置 + 外部混合
        all_topics = list(set(topics + mcp_topics))
        context["professional_knowledge"] = retrieve_enriched_knowledge(
            topics=all_topics,
            drug_names=drug_names,
        )

        # 附加 MCP 源摘要（用于 Agent 输出可解释性）
        mcp_info = query_external_knowledge(topics=mcp_topics, drug_names=drug_names)
        context["mcp_knowledge_summary"] = {
            "available_sources": mcp_info.get("source_summary", {}).get("available_sources", []),
            "drug_info_count": len(mcp_info.get("drug_info", [])),
            "interactions_count": len(mcp_info.get("interactions", [])),
            "errors": mcp_info.get("errors", []),
        }
    elif topics:
        # 无 MCP 查询需求时，仅使用内置知识
        context["professional_knowledge"] = retrieve_professional_knowledge(topics)

    return context
