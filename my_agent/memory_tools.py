"""
CareMind Memory Tools
供 Agent 直接调用的 Memory 工具函数（读取类 + 写入类）。
对应 CareMind_Memory.md 第 7 节设计。
所有函数签名与 ADK Agent tools 接口兼容。
"""
from datetime import datetime
from typing import Any

from .memory_schema import (
    KNOWLEDGE_DB,
    SAFETY_MEMORY,
    KnowledgeSource,
    default_behavior_entry,
    knowledge_entry_from_mcp,
    make_episodic_event,
    make_medication_event,
    merge_knowledge,
)
from .memory_state import (
    append_episodic_events,
    append_medication_event,
    get_behavior_entries,
    get_recent_episodic_events,
    get_similar_events,
    read_caregiver_state,
    read_medication_memory,
    read_patient_profile,
    update_patient_profile_fields,
    upsert_behavior_entry,
    write_caregiver_state,
)


# ═══════════════════════════════════════════════════════════════
# 读取类工具（Retrieve）
# ═══════════════════════════════════════════════════════════════

def retrieve_patient_profile(patient_id: str = "demo_patient") -> dict[str, Any]:
    """
    读取患者基础画像、作息、沟通偏好。
    供 memory_router_agent、patient_risk_agent、care_plan_agent 调用。
    """
    return read_patient_profile(patient_id)


def retrieve_medication_memory(patient_id: str = "demo_patient") -> dict[str, Any]:
    """
    读取当前用药清单、服药时间、拒药/漏服历史和医生备注。
    供 event_structuring_agent、patient_risk_agent、care_plan_agent 调用。
    """
    mem = read_medication_memory(patient_id)
    # 统计近 7 天拒药次数
    recent = get_recent_episodic_events(patient_id, days=7, event_types=["medication_refusal"])
    mem["recent_refusal_count_7d"] = len(recent)
    return mem


def retrieve_behavior_baseline(
    patient_id: str = "demo_patient",
    event_types: list[str] | None = None,
) -> dict[str, Any]:
    """
    读取与当前事件类型相关的行为基线。
    event_types 例如 ["home_seeking", "night_wandering", "agitation"]。
    """
    if event_types is None:
        event_types = []
    matched = get_behavior_entries(patient_id, event_types)
    return {
        "patient_id": patient_id,
        "requested_event_types": event_types,
        "matched_baselines": matched,
    }


def retrieve_recent_events(
    patient_id: str = "demo_patient",
    days: int = 7,
    event_types: list[str] | None = None,
) -> dict[str, Any]:
    """
    读取最近 N 天内的结构化照护事件，用于趋势判断。
    """
    events = get_recent_episodic_events(patient_id, days=days, event_types=event_types)
    type_counts: dict[str, int] = {}
    for ev in events:
        t = ev.get("event_type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
    return {
        "patient_id": patient_id,
        "date_range": f"{days}d",
        "total_events": len(events),
        "event_type_counts": type_counts,
        "events": events,
    }


def retrieve_similar_care_cases(
    patient_id: str = "demo_patient",
    current_event_types: list[str] | None = None,
    top_k: int = 3,
) -> dict[str, Any]:
    """
    检索过去相似类型的照护事件，用于回答"以前类似情况怎么处理有效"。
    """
    if current_event_types is None:
        current_event_types = []
    similar = get_similar_events(patient_id, current_event_types, top_k)
    return {
        "patient_id": patient_id,
        "query_event_types": current_event_types,
        "similar_cases": similar,
    }


def retrieve_professional_knowledge(
    topics: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    从内置云侧专业知识库中检索相关照护知识、沟通原则和安全边界。
    topics 例如 ["night_wandering", "medication_refusal", "caregiver_burden"]。
    """
    if not topics:
        return []
    result = []
    for entry in KNOWLEDGE_DB:
        if entry["topic"] in topics or any(
            t in entry.get("applicable_when", []) for t in topics
        ):
            result.append(entry)
    return result


def query_external_knowledge(
    topics: list[str] | None = None,
    drug_names: list[str] | None = None,
) -> dict[str, Any]:
    """
    查询外部 MCP 医疗知识源（如 DrugBank）。

    根据 topics 判断是否需要查询药物信息，然后调用 MCPKnowledgeHub。
    返回结构：
    {
      "source_summary": {...},
      "drug_info": [...],
      "interactions": [...],
      "errors": [...],
    }

    注意：此函数需要 DRUGBANK_API_KEY 环境变量。
    """
    from .mcp_knowledge_client import get_mcp_hub

    hub = get_mcp_hub()
    topics = topics or []
    drug_names = drug_names or []

    result: dict[str, Any] = {
        "source_summary": {
            "available_sources": hub.list_available_sources(),
            "queried_topics": topics,
            "queried_drug_names": drug_names,
        },
        "drug_info": [],
        "interactions": [],
        "errors": [],
    }

    # 药物名查询（同步调用 async 函数）
    for drug in drug_names:
        try:
            import asyncio
            info = asyncio.run(hub.query_drug_info(drug, force_refresh=False))
            for item in info:
                result["drug_info"].append(knowledge_entry_from_mcp(item))
        except Exception as e:
            result["errors"].append({"drug": drug, "error": str(e)})

    # 药物相互作用查询
    if len(drug_names) >= 2:
        try:
            import asyncio
            interactions = asyncio.run(hub.check_drug_interactions(drug_names))
            for item in interactions:
                result["interactions"].append(knowledge_entry_from_mcp(item))
        except Exception as e:
            result["errors"].append({"action": "drug_interactions", "error": str(e)})

    return result


def retrieve_enriched_knowledge(
    topics: list[str] | None = None,
    drug_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    增强知识检索：合并内置 KNOWLEDGE_DB + 外部 MCP 知识。

    优先级：
    1. MCP 外部知识（权威药学数据，高置信度）
    2. 内置 KNOWLEDGE_DB（照护通用知识，始终可用）

    返回时每条知识标注 source_type（"inline" 或 "mcp"）。
    """
    topics = topics or []
    drug_names = drug_names or []

    # 内置知识
    builtin = retrieve_professional_knowledge(topics)

    # 外部知识
    external = query_external_knowledge(topics=topics, drug_names=drug_names)
    external_entries = external.get("drug_info", []) + external.get("interactions", [])

    # 合并（外部优先覆盖同 knowledge_id 的内置条目）
    return merge_knowledge(builtin, external_entries, topic_filter=topics)


def retrieve_safety_rules() -> dict[str, Any]:
    """
    返回 CareMind Safety Memory（固定规则，不可修改）。
    所有 Agent 在生成输出前应调用此函数做安全审查。
    """
    return SAFETY_MEMORY


def retrieve_caregiver_state(caregiver_id: str = "demo_caregiver") -> dict[str, Any]:
    """
    读取照护者最新状态（睡眠、压力、支持资源）。
    """
    return read_caregiver_state(caregiver_id)


# ═══════════════════════════════════════════════════════════════
# 写入类工具（Update）
# ═══════════════════════════════════════════════════════════════

def update_event_memory(
    patient_id: str = "demo_patient",
    extracted_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    将 event_structuring_agent 抽取的结构化事件写入 Episodic Event Memory。
    对应 Memory Gate 第 10.1 节：自动写入策略。
    """
    if not extracted_events:
        return {"status": "no_events", "written": 0}

    to_write = []
    for ev in extracted_events:
        episodic = make_episodic_event(
            patient_id=patient_id,
            event_type=ev.get("event_type", "general_note"),
            severity=ev.get("severity", "low"),
            description=ev.get("description", ""),
            evidence_text="; ".join(ev.get("evidence", [])),
            frequency=ev.get("frequency"),
        )
        to_write.append(episodic)

        # 同时将拒药事件追加到 Medication Memory
        if ev.get("event_type") == "medication_refusal":
            med_ev = make_medication_event(
                event_type="medication_refusal",
                evidence="; ".join(ev.get("evidence", [])),
                action="记录并建议复诊时与医生讨论",
            )
            append_medication_event(patient_id, med_ev)

    saved = append_episodic_events(patient_id, to_write)
    return {"status": "ok", "written": len(saved), "events": saved}


def update_caregiver_state(
    caregiver_id: str = "demo_caregiver",
    caregiver_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    根据照护者压力评估结果更新照护者状态 Memory。
    """
    if not caregiver_signals:
        return {"status": "no_update"}

    risk_levels = caregiver_signals.get("risk_levels", {})
    evidence_list: list[str] = []

    # 从 care_state 的 trigger_reasons 中提取 evidence
    for reason in caregiver_signals.get("trigger_reasons", []):
        evidence_list.append(reason)

    sleep_level = risk_levels.get("sleep_deprivation", "unknown")
    distress_level = risk_levels.get("emotional_distress", "unknown")

    state_update = {
        "sleep_status": sleep_level,
        "distress_level": distress_level,
        "evidence": evidence_list,
    }
    result = write_caregiver_state(caregiver_id, state_update)
    return {"status": "ok", "caregiver_id": caregiver_id, "updated_state": result}


def propose_memory_update(
    patient_id: str = "demo_patient",
    extracted_events: list[dict[str, Any]] | None = None,
    care_plan: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    根据当前事件和计划，提出候选 Memory 更新（需要用户确认才写入长期 Memory）。
    对应 Memory Gate 第 10.2 节。
    """
    if not extracted_events:
        return []

    candidates = []
    event_types = {ev.get("event_type") for ev in extracted_events}

    if "home_seeking" in event_types:
        candidates.append({
            "memory_type": "behavior_baseline",
            "behavior_type": "home_seeking",
            "content": "患者下午或黄昏更容易出现想回家的表达。",
            "suggestion": "是否将下午容易想回家记录为常见行为模式，以便之后提前提醒做准备？",
            "requires_confirmation": True,
            "auto_confirm": False,
        })

    if "night_wandering" in event_types:
        candidates.append({
            "memory_type": "behavior_baseline",
            "behavior_type": "night_wandering",
            "content": "患者存在夜间起床和尝试外出的行为，需关注门锁和照明安全。",
            "suggestion": "是否将夜间起床/开门记录为高风险行为基线？",
            "requires_confirmation": True,
            "auto_confirm": False,
        })

    if "caregiver_distress" in event_types:
        candidates.append({
            "memory_type": "caregiver_state",
            "content": "照护者近期存在明显睡眠不足和情绪耗竭。",
            "suggestion": None,
            "requires_confirmation": False,
            "auto_confirm": True,  # 照护者状态自动写入
        })

    return candidates


def confirm_and_update_behavior_baseline(
    patient_id: str = "demo_patient",
    behavior_type: str = "home_seeking",
    trigger: str | None = None,
    effective_strategy: str | None = None,
    ineffective_strategy: str | None = None,
    evidence: str = "",
) -> dict[str, Any]:
    """
    用户确认后写入行为基线 Memory。
    对应 CareMind_Memory.md 第 7.2 节 update_behavior_baseline。
    """
    existing = get_behavior_entries(patient_id, [behavior_type])
    entry = existing.get(behavior_type) or default_behavior_entry(behavior_type)

    if trigger and trigger not in entry["known_triggers"]:
        entry["known_triggers"].append(trigger)
    if effective_strategy and effective_strategy not in entry["effective_interventions"]:
        entry["effective_interventions"].append(effective_strategy)
    if ineffective_strategy and ineffective_strategy not in entry["ineffective_interventions"]:
        entry["ineffective_interventions"].append(ineffective_strategy)
    if evidence:
        entry["description"] = evidence
    entry["last_updated"] = datetime.now().strftime("%Y-%m-%d")

    saved = upsert_behavior_entry(patient_id, entry)
    return {"status": "ok", "behavior_type": behavior_type, "entry": saved}


def update_patient_profile(
    patient_id: str = "demo_patient",
    updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    更新患者画像字段（深度合并，不覆盖整个文档）。
    """
    if not updates:
        return read_patient_profile(patient_id)
    return update_patient_profile_fields(patient_id, updates)
