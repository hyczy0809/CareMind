"""Deterministic CareMind agent trigger routing.

This module mirrors the PRD 6.2 intent table so the cloud agent prompts,
workflow tools, and tests share one explicit routing contract.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .model_routing import route_intent

CareMindIntent = Literal[
    "daily_log",
    "communication",
    "follow_up",
    "followup_document",
    "caregiver_support",
    "medical_boundary",
    "crisis",
    "onboarding",
    "today_care",
]


@dataclass(frozen=True)
class AgentRoutePlan:
    intent: CareMindIntent
    agents: tuple[str, ...]
    capabilities: tuple[str, ...]
    guardrail_first: bool = False
    blocks_ordinary_workflow: bool = False
    allows_doctor_summary: bool = False
    reason: str = ""


_CRISIS_RE = re.compile(
    r"自伤|伤害自己|伤人|打人|不想活|活不下去|走失|失踪|找不到人|无法保证安全|控制不住|呼吸困难|胸痛|意识不清|昏迷"
)
_DIAGNOSIS_RE = re.compile(r"诊断|确诊|是不是.*病|是不是.*阿尔|是不是.*失智|病情.*加重|是不是加重")
_MEDICATION_DECISION_RE = re.compile(
    r"停药|换药|加药|减药|补药|药量|剂量|处方|能不能.*药|要不要.*药|该不该.*药"
)
_IMAGING_DECISION_RE = re.compile(
    r"要不要.*(MRI|CT|核磁|检查|量表)|该不该.*(MRI|CT|核磁|检查|量表)|需不需要.*(MRI|CT|核磁|检查|量表)"
)
_FOLLOWUP_DOCUMENT_RE = re.compile(
    r"上传|病历|检查报告|影像报告|用药清单|医生记录|医嘱|报告单|化验单|资料补充|复诊资料"
)
_FOLLOW_UP_RE = re.compile(
    r"复诊|随访|问医生|给医生|跟医生说|医生.*(看|说|问|摘要|总结)|近\s*(一周|7\s*天|一个月|30\s*天)|最近\s*(一周|7\s*天|一个月|30\s*天)|问题清单|资料清单|导出|PDF"
)
_COMMUNICATION_RE = re.compile(r"怎么说|怎么回应|怎么劝|怎么哄|话术|沟通|怎么跟.*说|怎么安慰")
_CAREGIVER_SUPPORT_RE = re.compile(
    r"我.*(累|崩溃|撑不住|撑不下去|睡不着|没睡|焦虑|想哭|压力)|照护者|家属.*(累|压力|崩溃)|喘息|轮替"
)
_CARE_EVENT_RE = re.compile(
    r"妈妈|爸爸|老人|患者|病人|奶奶|爷爷|外婆|外公|她|他|昨晚|今晚|半夜|凌晨|起床|起夜|要回家|回老家|拒药|漏药|不吃药|吃饭|饮水|呛咳|开门|出去|外出|跌倒|摔|走失|东西|偷|骂|打|烦躁|激动"
)
_TODAY_CARE_RE = re.compile(
    r"今日照护|今天.*(留意|关注|先做|该做|怎么办|安排)|今晚.*(注意|怎么做)|下一步|行动项|提醒"
)
_ONBOARDING_RE = re.compile(r"首次|刚开始|新用户|基础信息|患者资料")


ROUTE_INSTRUCTION_TABLE = """PRD 6.2 Agent 路由规则：
- crisis：命中自伤、伤人、走失、无法保证安全等危机表达时，先执行危机规则，阻断普通工作流。
- medical_boundary：询问诊断、用药调整或检查决策时，只执行 Guardrail + 替代行动，不进入普通照护建议。
- daily_log：描述今日发生事项时，进入 event_structuring_agent -> patient_risk_agent -> care_plan_agent；只有出现照护者疲惫/睡眠/崩溃线索时再进入 caregiver_support_agent。daily_log 不触发 doctor_summary_agent。
- communication：询问“怎么说/怎么回应/话术”时，进入 care_plan_agent 生成沟通话术；必要时先读取历史偏好。
- today_care：询问今天先做什么/今日关注时，进入 patient_risk_agent -> care_plan_agent；同类型关注事项只保留一张卡。
- caregiver_support：表达疲惫、崩溃、睡眠不足时，进入 caregiver_support_agent，不做心理诊断。
- follow_up：明确提到复诊、医生、近 7 天/30 天摘要、问题清单或资料清单时，才进入 doctor_summary_agent。
- followup_document：上传/补充病历、检查、用药、医生记录时，只做资料保存、非诊断整理草稿和家属确认；未确认资料不得进入摘要。
- onboarding：首次使用或补充患者资料时，保存用户填写资料，并把最担心的一件事作为第一条 daily_log。"""


def classify_agent_intent(text: str, source: str | None = None) -> AgentRoutePlan:
    """Classify a user request into the PRD-backed agent route plan."""
    note = (text or "").strip()
    source_value = (source or "").strip()

    if _CRISIS_RE.search(note):
        return AgentRoutePlan(
            intent="crisis",
            agents=(),
            capabilities=("crisis_rule", "emergency_support_card"),
            guardrail_first=True,
            blocks_ordinary_workflow=True,
            reason="crisis or immediate safety expression",
        )

    if _DIAGNOSIS_RE.search(note) or _MEDICATION_DECISION_RE.search(note) or _IMAGING_DECISION_RE.search(note):
        return AgentRoutePlan(
            intent="medical_boundary",
            agents=(),
            capabilities=("guardrail", "alternative_action"),
            guardrail_first=True,
            blocks_ordinary_workflow=True,
            reason="diagnosis, medication, or test-decision request",
        )

    if source_value == "onboarding" or _ONBOARDING_RE.search(note):
        return AgentRoutePlan(
            intent="onboarding",
            agents=("event_structuring_agent", "patient_risk_agent", "care_plan_agent"),
            capabilities=("patient_profile", "first_care_log", "today_attention"),
            reason="first-use or patient-profile setup signal",
        )

    if _FOLLOWUP_DOCUMENT_RE.search(note):
        return AgentRoutePlan(
            intent="followup_document",
            agents=(),
            capabilities=("document_save", "non_diagnostic_draft", "family_confirmation"),
            reason="follow-up document or medical material signal",
        )

    if _FOLLOW_UP_RE.search(note):
        return AgentRoutePlan(
            intent="follow_up",
            agents=("doctor_summary_agent",),
            capabilities=("followup_summary", "doctor_questions", "materials_list"),
            allows_doctor_summary=True,
            reason="explicit follow-up summary or doctor-communication request",
        )

    if _COMMUNICATION_RE.search(note):
        return AgentRoutePlan(
            intent="communication",
            agents=("care_plan_agent",),
            capabilities=("communication_script", "patient_preference_lookup"),
            reason="communication-script request",
        )

    if _TODAY_CARE_RE.search(note):
        agents = ["patient_risk_agent", "care_plan_agent"]
        if _CAREGIVER_SUPPORT_RE.search(note):
            agents.append("caregiver_support_agent")
        return AgentRoutePlan(
            intent="today_care",
            agents=tuple(agents),
            capabilities=("today_attention", "action_plan", "next_day_followup"),
            reason="today-care or next-action request",
        )

    if _CAREGIVER_SUPPORT_RE.search(note) and not _CARE_EVENT_RE.search(note):
        return AgentRoutePlan(
            intent="caregiver_support",
            agents=("caregiver_support_agent",),
            capabilities=("caregiver_checkin", "burden_support", "respite_suggestion"),
            reason="caregiver fatigue, sleep, or overload signal",
        )

    daily_agents = ["event_structuring_agent", "patient_risk_agent", "care_plan_agent"]
    if _CAREGIVER_SUPPORT_RE.search(note):
        daily_agents.append("caregiver_support_agent")

    return AgentRoutePlan(
        intent="daily_log",
        agents=tuple(daily_agents),
        capabilities=("structured_log", "attention_items", "communication_script", "followup_patch"),
        reason="default care-note flow",
    )


def classify_caremind_intent(text: str, source: str = "manual") -> dict[str, object]:
    """ADK-safe read-only tool for root-agent intent routing."""
    route = classify_agent_intent(text, source)
    model_routing = route_intent(route.intent, platform="backend").as_dict()
    return {
        "intent": route.intent,
        "agents": list(route.agents),
        "capabilities": list(route.capabilities),
        "guardrail_first": route.guardrail_first,
        "blocks_ordinary_workflow": route.blocks_ordinary_workflow,
        "allows_doctor_summary": route.allows_doctor_summary,
        "reason": route.reason,
        "model_routing": model_routing,
    }
