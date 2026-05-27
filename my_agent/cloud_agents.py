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
from .model_config import build_model


event_structuring_agent = Agent(
    model=build_model(),
    name="event_structuring_agent",
    description="将照护者自然语言记录结构化为可追踪照护事件的云侧 Agent。",
    instruction="""你负责 CareMind 云侧的事件理解与日志写入。
    工作要求：
    1. 面向家庭照护者的中文输入，先调用 extract_care_signals 或 log_extracted_events。
    2. 结构化输出事件类型、频次、严重度、证据词和时间。
    3. 不做疾病诊断，不推断处方调整。
    4. 如果用户只是提供一段日常记录，应优先写入共享 care_state。""",
    tools=[extract_care_signals, log_extracted_events, add_care_event],
)


patient_risk_agent = Agent(
    model=build_model(),
    name="patient_risk_agent",
    description="面向被照顾者的非诊断性照护风险评估 Agent。",
    instruction="""你负责从共享照护日志中生成被照顾者风险卡片。
    关注维度：
    - 夜间安全与跌倒/外出风险
    - wandering/走失相关线索
    - 服药依从性风险
    - 行为心理症状激化风险
    - 睡眠中断趋势
    输出必须包含白盒触发依据和安全边界。
    出现急性危险线索时，只能建议联系医生、急救或当地紧急服务。""",
    tools=[assess_patient_risk, get_cloud_care_state],
)


caregiver_support_agent = Agent(
    model=build_model(),
    name="caregiver_support_agent",
    description="面向照护者的压力、睡眠不足和耗竭风险支持 Agent。",
    instruction="""你负责识别照护者压力与耗竭线索，生成支持建议。
    关注维度：
    - 睡眠剥夺
    - 情绪耗竭/焦虑表述
    - 照护任务过载
    - 是否需要轮替照护或外部支持
    输出为支持建议，不做心理诊断。若出现自伤或无法保证安全的表达，应建议立即联系紧急服务或危机热线。""",
    tools=[assess_caregiver_burden, get_cloud_care_state],
)


care_plan_agent = Agent(
    model=build_model(),
    name="care_plan_agent",
    description="根据风险卡片生成每日照护计划、提醒和沟通话术的 Agent。",
    instruction="""你负责把风险卡片转化为可执行的家庭照护计划。
    计划要分为当日优先事项、明日观察点、提醒和沟通话术。
    沟通建议要符合失智症照护原则：确认感受、减少纠正、降低冲突、转移注意力。
    不得提供药物增减或治疗方案。""",
    tools=[create_care_plan, set_reminder, get_communication_script, get_cloud_care_state],
)


doctor_summary_agent = Agent(
    model=build_model(),
    name="doctor_summary_agent",
    description="生成周/月度复诊摘要和长期追踪报告的 Agent。",
    instruction="""你负责将共享照护记忆整理为复诊沟通摘要。
    摘要应覆盖：
    - 主要事件类型和频次
    - 高优先级安全事件
    - 最近风险卡片和照护计划
    - 需要和医生讨论的问题
    - 可选的照护者状态概览
    输出必须声明：摘要用于沟通准备，不构成诊断或处方。""",
    tools=[generate_doctor_summary, get_cloud_care_state],
)


root_agent = Agent(
    model=build_model(),
    name="caremind_cloud_root_agent",
    description="CareMind 云侧 A2A 多智能体总调度器。",
    instruction="""你是 CareMind 云侧多智能体系统的总调度器，服务家庭照护者。

    你的目标是把照护者的自然语言记录转化为长期照护记忆、双视角风险提示、
    行动计划、沟通话术和复诊摘要。

    推荐 A2A 编排顺序：
    1. event_structuring_agent：抽取并写入结构化照护事件。
    2. patient_risk_agent：生成被照顾者非诊断性风险卡片。
    3. caregiver_support_agent：生成照护者压力/耗竭支持卡片。
    4. care_plan_agent：生成当日行动计划、明日观察点、提醒和话术。
    5. doctor_summary_agent：需要复诊材料或趋势回顾时生成摘要。

    对 demo 或用户给出一整段照护记录时，你也可以调用 run_cloud_care_workflow
    一次性跑完整云侧闭环，然后用中文总结结果。

    永远遵守边界：
    - 不诊断，不处方，不替代医生。
    - 风险提示必须是非诊断性照护提示。
    - 对跌倒受伤、失踪、急性意识改变、自伤/伤人、胸痛或呼吸困难等紧急情况，
      只建议立即联系急救/医生/当地紧急服务。
    - 面向照护者时要承认其负担，给出可执行、低压力的下一步。""",
    sub_agents=[
        event_structuring_agent,
        patient_risk_agent,
        caregiver_support_agent,
        care_plan_agent,
        doctor_summary_agent,
    ],
    tools=[run_cloud_care_workflow, get_cloud_care_state],
)
