"""
CareMind Memory Schema
定义所有 Memory 数据结构的默认模板与工厂函数。
遵循 CareMind_Memory.md 第 5 节设计。

Memory 知识体系分层：
  内置知识（KNOWLEDGE_DB）── 失智症照护通用知识（硬编码，始终可用）
  外部知识（MCP 源）    ── DrugBank / PubMed / OpenFDA 等专业医疗数据源
                          ── 动态查询，按需缓存，静默降级

外部知识源配置在 mcp_knowledge_client.py 的 MCP_SOURCE_REGISTRY 中统一管理。
"""
from datetime import datetime
from typing import Any


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


# ─────────────────────────────────────────────
# 5.1 Patient Profile Memory
# ─────────────────────────────────────────────

def default_patient_profile(patient_id: str) -> dict[str, Any]:
    return {
        "patient_id": patient_id,
        "basic_profile": {
            "age": None,
            "diagnosis": "失智症/阿尔兹海默病家庭照护场景",
            "stage": "未知",
            "primary_language": "普通话",
            "hearing_or_vision_issue": None,
        },
        "daily_routine": {
            "wake_time": None,
            "nap_time": None,
            "sleep_time": None,
            "usual_agitation_time": "17:00-19:00",
        },
        "communication_style": {
            "preferred_tone": "温和、慢速、少纠正",
            "effective_phrases": [],
            "ineffective_phrases": [],
        },
        "created_at": _now(),
        "updated_at": _now(),
    }


# ─────────────────────────────────────────────
# 5.2 Medication Memory
# ─────────────────────────────────────────────

def default_medication_memory(patient_id: str) -> dict[str, Any]:
    return {
        "patient_id": patient_id,
        "current_medications": [],
        "medication_events": [],
        "doctor_notes": [
            "不要自行调整药量",
            "持续记录拒药和漏服情况",
        ],
        "updated_at": _now(),
    }


def make_medication_event(event_type: str, evidence: str, action: str) -> dict[str, Any]:
    return {
        "event_type": event_type,
        "time": _now(),
        "evidence": evidence,
        "action": action,
    }


# ─────────────────────────────────────────────
# 5.3 Behavior Baseline Memory
# ─────────────────────────────────────────────

def default_behavior_baseline(patient_id: str) -> dict[str, Any]:
    return {
        "patient_id": patient_id,
        "behavior_baselines": [],
        "updated_at": _now(),
    }


def default_behavior_entry(behavior_type: str) -> dict[str, Any]:
    return {
        "behavior_type": behavior_type,
        "description": "",
        "usual_time": None,
        "known_triggers": [],
        "effective_interventions": [],
        "ineffective_interventions": [],
        "last_updated": _today(),
    }


# ─────────────────────────────────────────────
# 5.4 Episodic Event Memory
# ─────────────────────────────────────────────

def make_episodic_event(
    patient_id: str,
    event_type: str,
    severity: str,
    description: str,
    evidence_text: str,
    frequency: int | None = None,
) -> dict[str, Any]:
    ts = _now()
    return {
        "event_id": f"evt_{ts[:10].replace('-', '')}_{event_type[:8]}",
        "patient_id": patient_id,
        "timestamp": ts,
        "event_type": event_type,
        "severity": severity,
        "description": description,
        "evidence_text": evidence_text,
        "frequency": frequency,
        "linked_plan_id": None,
        "outcome": "unknown",
    }


# ─────────────────────────────────────────────
# 5.5 Caregiver State Memory
# ─────────────────────────────────────────────

def default_caregiver_state(caregiver_id: str) -> dict[str, Any]:
    return {
        "caregiver_id": caregiver_id,
        "recent_state": {
            "sleep_status": "unknown",
            "distress_level": "unknown",
            "evidence": [],
            "last_updated": _today(),
        },
        "support_resources": {
            "family_members": [],
            "community_support": [],
            "preferred_support_strategy": "",
        },
        "history": [],
        "updated_at": _now(),
    }


# ─────────────────────────────────────────────
# 5.6 Knowledge Memory（内置静态知识库）
# ─────────────────────────────────────────────

KNOWLEDGE_DB: list[dict[str, Any]] = [
    {
        "knowledge_id": "night_wandering_safety_001",
        "topic": "night_wandering",
        "source": "public_care_guideline",
        "content": "夜间起床和尝试外出时，应优先关注门锁、照明、动线障碍和跌倒风险。如已失踪或发生跌倒，应联系急救或当地紧急服务。",
        "applicable_when": ["夜间起床", "开门外出", "曾经走失"],
        "safety_boundary": ["不承诺完全避免走失", "如已失踪或发生跌倒，应联系急救或当地紧急服务"],
    },
    {
        "knowledge_id": "communication_home_seeking_001",
        "topic": "communication_home_seeking",
        "source": "dementia_care_principle",
        "content": "面对想回家表达时，应减少事实纠正，优先共情、安抚和转移注意力。可以说：'你是不是有点想老家？我们先坐下来喝点水。'看老照片或播放熟悉音乐通常有效。",
        "applicable_when": ["home_seeking", "反复想回家"],
        "safety_boundary": [],
    },
    {
        "knowledge_id": "medication_refusal_001",
        "topic": "medication_refusal",
        "source": "dementia_care_principle",
        "content": "拒药时不应强迫或自行补药，应记录发生时间、场景和持续频率，并在复诊时与医生讨论。情绪平稳时再尝试，服药前避免正面争执。",
        "applicable_when": ["medication_refusal", "漏服", "拒绝服药"],
        "safety_boundary": [
            "不建议自行补服、停药、加量或换药",
            "如拒药持续出现，需咨询医生",
        ],
    },
    {
        "knowledge_id": "caregiver_burden_001",
        "topic": "caregiver_burden",
        "source": "dementia_care_guideline",
        "content": "连续睡眠不足和明显烦躁提示照护者需要轮替照护、休息和外部支持。照护者的健康是持续照护的基础，应尽快安排其他家庭成员或社区服务介入。",
        "applicable_when": ["caregiver_distress", "sleep_disruption", "照护者疲惫"],
        "safety_boundary": ["若照护者出现自伤念头，应立即联系危机热线或紧急服务"],
    },
    {
        "knowledge_id": "agitation_management_001",
        "topic": "agitation",
        "source": "dementia_care_principle",
        "content": "激越行为应避免争辩和纠正，优先识别触发因素（饥饿、疼痛、环境嘈杂、陌生人），用平静语气转移注意力，降低环境刺激。",
        "applicable_when": ["agitation", "激越", "情绪激化"],
        "safety_boundary": ["如出现攻击行为或安全风险，应保持安全距离并考虑专业介入"],
    },
    {
        "knowledge_id": "safety_boundary_001",
        "topic": "safety_boundary",
        "source": "caremind_system",
        "content": "CareMind 提供照护支持，不替代医生诊断和处方。所有建议均为非诊断性照护提示。",
        "applicable_when": ["all"],
        "safety_boundary": [],
    },
    {
        "knowledge_id": "emergency_rules_001",
        "topic": "emergency_rules",
        "source": "caremind_system",
        "content": "遇跌倒受伤、急性意识改变、呼吸困难、胸痛、失踪、自伤或伤人风险时，立即联系急救或当地紧急服务，不要依赖 AI 指导。",
        "applicable_when": ["emergency", "急症", "跌倒", "失踪"],
        "safety_boundary": ["立即联系急救"],
    },
]

# ─────────────────────────────────────────────
# 5.6b 外部知识源集成（MCP 知识）
# ─────────────────────────────────────────────

class KnowledgeSource:
    """单个知识源的元数据"""
    INLINE = "inline"       # 内置 KNOWLEDGE_DB
    MCP = "mcp"             # 外部 MCP 源
    RAG = "rag"             # 预留：向量检索


def knowledge_entry_from_mcp(
    ext_result: Any,  # ExternalKnowledgeResult（避免循环导入）
) -> dict[str, Any]:
    """将外部 MCP 结果转换为与 KNOWLEDGE_DB 兼容的 dict"""
    return {
        "knowledge_id": getattr(ext_result, "knowledge_id", ""),
        "topic": getattr(ext_result, "topic", ""),
        "source": getattr(ext_result, "source", "external_mcp"),
        "source_type": KnowledgeSource.MCP,
        "content": getattr(ext_result, "content", ""),
        "applicable_when": getattr(ext_result, "applicable_when", []),
        "safety_boundary": getattr(ext_result, "safety_boundary", []),
        "fetched_at": getattr(ext_result, "fetched_at", ""),
        "confidence": getattr(ext_result, "confidence", "medium"),
    }


def merge_knowledge(
    builtin: list[dict[str, Any]],
    external: list[dict[str, Any]],
    topic_filter: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    混合检索：合并内置 + 外部知识，按 topic 去重（外部优先覆盖内置）。

    返回时内置条目标注 source_type = "inline"，
    外部条目标注 source_type = "mcp"。
    """
    merged: dict[str, dict[str, Any]] = {}

    # 先放入内置知识
    for entry in builtin:
        tid = entry.get("knowledge_id", "")
        entry_copy = dict(entry)
        entry_copy.setdefault("source_type", KnowledgeSource.INLINE)
        merged[tid] = entry_copy

    # 外部知识覆盖同 knowledge_id 的内置条目
    for entry in external:
        tid = entry.get("knowledge_id", "")
        entry_copy = dict(entry)
        entry_copy.setdefault("source_type", KnowledgeSource.MCP)
        merged[tid] = entry_copy

    results = list(merged.values())

    # topic 过滤
    if topic_filter:
        results = [
            r for r in results
            if r.get("topic") in topic_filter
            or any(t for t in r.get("applicable_when", []) if t in topic_filter)
        ]

    return results


# ─────────────────────────────────────────────
# 5.7 Safety Memory（固定规则，不可修改）
# ─────────────────────────────────────────────

SAFETY_MEMORY: dict[str, Any] = {
    "medical_boundary": [
        "不诊断疾病",
        "不判断病情是否恶化",
        "不建议增减药物",
        "不替代医生或急救服务",
    ],
    "medication_boundary": [
        "面对拒药、漏药或疑似副作用，只能建议记录并咨询医生",
        "不得建议自行补服、停药、加量或换药",
    ],
    "emergency_rules": [
        {
            "condition": "跌倒受伤、急性意识改变、呼吸困难、胸痛、失踪、自伤或伤人风险",
            "action": "建议立即联系急救或当地紧急服务",
        }
    ],
    "language_style": [
        "使用非诊断性表述",
        "输出照护优先级而不是医学结论",
        "说明触发依据",
        "必要时建议联系医生",
    ],
}
