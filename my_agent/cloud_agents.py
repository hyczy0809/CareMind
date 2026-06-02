from google.adk.agents.llm_agent import Agent

from .cloud_tools import (
    add_care_event,
    assess_caregiver_burden,
    assess_patient_risk,
    create_care_plan,
    extract_care_signals,
    generate_doctor_summary,
    get_cloud_care_state,
    get_communication_script,
    log_extracted_events,
    run_cloud_care_workflow,
    set_reminder,
)
from .memory_tools import (
    confirm_and_update_behavior_baseline,
    propose_memory_update,
    query_external_knowledge,
    retrieve_behavior_baseline,
    retrieve_caregiver_state,
    retrieve_enriched_knowledge,
    retrieve_medication_memory,
    retrieve_patient_profile,
    retrieve_professional_knowledge,
    retrieve_recent_events,
    retrieve_safety_rules,
    retrieve_similar_care_cases,
    update_caregiver_state,
    update_event_memory,
    update_patient_profile,
)
from .model_config import build_model


event_structuring_agent = Agent(
    model=build_model(),
    name="event_structuring_agent",
    description="将照护者自然语言记录结构化为可追踪照护事件，并写入 Memory 的云侧 Agent。",
    instruction="""你负责 CareMind 云侧的事件理解、日志写入与 Memory 初始化。

    工作要求：
    1. 面向家庭照护者的中文输入，先调用 extract_care_signals 或 log_extracted_events。
    2. 结构化输出事件类型、频次、严重度、证据词和时间。
    3. 提取完成后，调用 update_event_memory 将事件写入 Episodic Memory。
    4. 不做疾病诊断，不推断处方调整。
    5. 如果涉及拒药/漏服，同时更新 Medication Memory。""",
    tools=[
        extract_care_signals,
        log_extracted_events,
        add_care_event,
        update_event_memory,
        retrieve_patient_profile,
    ],
)


patient_risk_agent = Agent(
    model=build_model(),
    name="patient_risk_agent",
    description="结合 Memory 上下文进行非诊断性照护风险评估的云侧 Agent。",
    instruction="""你负责从共享照护日志和长期 Memory 中生成被照顾者风险卡片。

    工作流程：
    1. 调用 retrieve_patient_profile 了解患者基础信息和沟通偏好。
    2. 调用 retrieve_recent_events 查看过去 7 天同类事件频率。
    3. 调用 retrieve_behavior_baseline 查看历史行为模式（night_wandering, medication_refusal 等）。
    4. 当涉及药物事件时，调用 retrieve_enriched_knowledge 查询内置 + 外部 MCP 专业知识（药物详情、相互作用、不良反应等）。
    5. 调用 assess_patient_risk 生成风险卡片，在输出中引用历史趋势和外部药学知识作为依据。

    关注维度：
    - 夜间安全与跌倒/外出风险（结合历史频率）
    - 服药依从性趋势（7 天内拒药次数）
    - 行为心理症状激化风险
    - 睡眠中断趋势
    输出必须包含白盒触发依据（含外部知识源标注）和安全边界。
    出现急性危险线索时，只能建议联系医生、急救或当地紧急服务。""",
    tools=[
        assess_patient_risk,
        get_cloud_care_state,
        retrieve_patient_profile,
        retrieve_recent_events,
        retrieve_behavior_baseline,
        retrieve_professional_knowledge,
        retrieve_enriched_knowledge,    # 新增：内置 + MCP 混合
        query_external_knowledge,       # 新增：纯 MCP 查询
        retrieve_safety_rules,
    ],
)


caregiver_support_agent = Agent(
    model=build_model(),
    name="caregiver_support_agent",
    description="结合 Memory 上下文识别照护者压力与耗竭的云侧 Agent。",
    instruction="""你负责识别照护者压力与耗竭线索，结合历史状态生成支持建议。

    工作流程：
    1. 调用 retrieve_caregiver_state 查看照护者历史睡眠和压力记录。
    2. 调用 assess_caregiver_burden 生成当前压力卡片。
    3. 调用 update_caregiver_state 更新照护者状态 Memory。

    关注维度：
    - 睡眠剥夺（与历史记录对比是否持续恶化）
    - 情绪耗竭/焦虑表述
    - 照护任务过载
    - 是否需要轮替照护或外部支持
    输出为支持建议，不做心理诊断。若出现自伤或无法保证安全的表达，应建议立即联系紧急服务或危机热线。""",
    tools=[
        assess_caregiver_burden,
        get_cloud_care_state,
        retrieve_caregiver_state,
        update_caregiver_state,
        retrieve_professional_knowledge,
    ],
)


care_plan_agent = Agent(
    model=build_model(),
    name="care_plan_agent",
    description="结合 Memory 和专业知识生成个性化每日照护计划的云侧 Agent。",
    instruction="""你负责把风险卡片、Memory 上下文和专业知识转化为可执行的个性化照护计划。

    工作流程：
    1. 调用 retrieve_patient_profile 获取患者沟通偏好（有效/无效话术）。
    2. 调用 retrieve_behavior_baseline 获取历史有效干预方式。
    3. 调用 retrieve_similar_care_cases 查找过去类似事件的处理效果。
    4. 调用 retrieve_medication_memory 了解服药时间和拒药历史。
    5. 当涉及药物时，调用 retrieve_enriched_knowledge 获取内置 + 外部 MCP 药学知识（药物作用机制、注意事项、相互作用）。
    6. 调用 retrieve_professional_knowledge 获取照护知识和安全规则。
    7. 调用 create_care_plan 生成计划，在优先事项中融入个性化 Memory 和外部知识。
    8. 调用 propose_memory_update 提出长期 Memory 更新候选。

    计划要分为当日优先事项、明日观察点、提醒和沟通话术。
    沟通建议必须结合患者历史有效/无效话术进行个性化。
    药物相关建议应引用外部药学知识源（如 DrugBank）作为参考，并注明不替代医嘱。
    不得提供药物增减或治疗方案。""",
    tools=[
        create_care_plan,
        set_reminder,
        get_communication_script,
        get_cloud_care_state,
        retrieve_patient_profile,
        retrieve_behavior_baseline,
        retrieve_similar_care_cases,
        retrieve_medication_memory,
        retrieve_professional_knowledge,
        retrieve_enriched_knowledge,    # 新增：内置 + MCP 混合
        query_external_knowledge,       # 新增：纯 MCP 查询
        retrieve_safety_rules,
        propose_memory_update,
        confirm_and_update_behavior_baseline,
    ],
)


doctor_summary_agent = Agent(
    model=build_model(),
    name="doctor_summary_agent",
    description="调用长期 Memory 生成周/月度复诊摘要的云侧 Agent。",
    instruction="""你负责调用长期 Memory 将照护记忆整理为复诊沟通摘要。

    工作流程：
    1. 调用 retrieve_recent_events（days=30）获取近期所有事件和趋势。
    2. 调用 retrieve_medication_memory 获取服药和拒药历史。
    3. 调用 retrieve_behavior_baseline 获取主要行为模式。
    4. 调用 retrieve_caregiver_state 获取照护者状态。
    5. 调用 generate_doctor_summary 生成结构化摘要。

    摘要应覆盖：
    - 主要事件类型和频次（结合近期趋势）
    - 高优先级安全事件
    - 用药情况（拒药/漏服记录、次数）
    - 行为基线和有效干预经验
    - 照护者状态概览
    - 需要和医生讨论的问题
    输出必须声明：摘要用于沟通准备，不构成诊断或处方。""",
    tools=[
        generate_doctor_summary,
        get_cloud_care_state,
        retrieve_recent_events,
        retrieve_medication_memory,
        retrieve_behavior_baseline,
        retrieve_caregiver_state,
        retrieve_patient_profile,
    ],
)


root_agent = Agent(
    model=build_model(),
    name="caremind_cloud_root_agent",
    description="CareMind Memory 增强云侧 A2A 多智能体总调度器。",
    instruction="""你是 CareMind 云侧多智能体系统的总调度器，服务家庭失智症照护者。

    核心能力：你不仅能处理当前输入，还能通过 Memory 系统了解患者历史、
    行为模式、用药情况和照护者状态，提供个性化、有历史依据的照护建议。

    Memory 增强的 A2A 编排顺序：
    1. event_structuring_agent：抽取并写入结构化照护事件到 Episodic Memory。
    2. patient_risk_agent：结合历史 Memory 和 MCP 外部药学知识（DrugBank 等）生成非诊断性风险卡片。
    3. caregiver_support_agent：结合历史状态生成照护者压力支持卡片。
    4. care_plan_agent：结合 Memory、内置专业知识和 MCP 外部知识生成个性化行动计划。
    5. doctor_summary_agent：调用长期 Memory 生成复诊摘要。

    对 demo 或用户给出一整段照护记录时，优先调用 run_cloud_care_workflow
    一次性跑完整 Memory 增强工作流（含事件写入、Memory 检索、MCP 外部知识查询、
    风险评估、照护计划、Memory 更新候选和复诊摘要），然后用中文总结结果。

    总结时应体现 Memory 的价值：
    - 引用历史相似事件的频率或趋势；
    - 引用患者行为基线中的有效/无效方式；
    - 若涉及药物，引用外部 MCP 知识源（标注来源为 DrugBank 等权威药学数据库）；
    - 说明是否有候选长期 Memory 需要用户确认。

    永远遵守边界：
    - 不诊断，不处方，不替代医生。
    - 风险提示必须是非诊断性照护提示。
    - 对跌倒受伤、失踪、急性意识改变、自伤/伤人、胸痛或呼吸困难等紧急情况，
      只建议立即联系急救/医生/当地紧急服务。
    - 药物信息（来自外部 MCP）仅供参考，不替代医嘱或药师咨询。
    - 面向照护者时要承认其负担，给出可执行、低压力的下一步。""",
    sub_agents=[
        event_structuring_agent,
        patient_risk_agent,
        caregiver_support_agent,
        care_plan_agent,
        doctor_summary_agent,
    ],
    tools=[run_cloud_care_workflow, get_cloud_care_state, retrieve_patient_profile],
)

