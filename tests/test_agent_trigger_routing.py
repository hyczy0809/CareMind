import importlib
import os
import sys
import tempfile
import types
import unittest
from unittest import mock


from my_agent.agent_trigger_router import classify_agent_intent, classify_caremind_intent


class AgentTriggerRouterTests(unittest.TestCase):
    def test_daily_log_routes_without_doctor_summary(self):
        route = classify_agent_intent("妈妈昨晚半夜起床三次，还说要回家")

        self.assertEqual(route.intent, "daily_log")
        self.assertIn("event_structuring_agent", route.agents)
        self.assertIn("patient_risk_agent", route.agents)
        self.assertIn("care_plan_agent", route.agents)
        self.assertNotIn("doctor_summary_agent", route.agents)
        self.assertFalse(route.allows_doctor_summary)

    def test_daily_log_with_caregiver_signal_keeps_daily_flow(self):
        route = classify_agent_intent("妈妈昨晚半夜起床三次，还说要回家，我也一整晚没睡。")

        self.assertEqual(route.intent, "daily_log")
        self.assertIn("event_structuring_agent", route.agents)
        self.assertIn("patient_risk_agent", route.agents)
        self.assertIn("care_plan_agent", route.agents)
        self.assertIn("caregiver_support_agent", route.agents)
        self.assertFalse(route.allows_doctor_summary)

    def test_follow_up_is_the_only_doctor_summary_route(self):
        route = classify_agent_intent("帮我整理近 7 天复诊时给医生看的摘要和问题清单")

        self.assertEqual(route.intent, "follow_up")
        self.assertEqual(route.agents, ("doctor_summary_agent",))
        self.assertTrue(route.allows_doctor_summary)

    def test_medical_boundary_blocks_ordinary_workflow(self):
        route = classify_agent_intent("这个药要不要停？剂量是不是该减一点？")

        self.assertEqual(route.intent, "medical_boundary")
        self.assertTrue(route.guardrail_first)
        self.assertTrue(route.blocks_ordinary_workflow)
        self.assertEqual(route.agents, ())

    def test_crisis_blocks_ordinary_workflow(self):
        route = classify_agent_intent("老人走失了，现在找不到人")

        self.assertEqual(route.intent, "crisis")
        self.assertTrue(route.guardrail_first)
        self.assertTrue(route.blocks_ordinary_workflow)
        self.assertEqual(route.agents, ())

    def test_caregiver_support_signal_routes_to_support_agent(self):
        route = classify_agent_intent("我整夜没睡，真的快崩溃了")

        self.assertEqual(route.intent, "caregiver_support")
        self.assertEqual(route.agents, ("caregiver_support_agent",))

    def test_communication_request_routes_to_care_plan_agent(self):
        route = classify_agent_intent("她一直说要回家，我该怎么回应？")

        self.assertEqual(route.intent, "communication")
        self.assertEqual(route.agents, ("care_plan_agent",))

    def test_followup_document_does_not_trigger_doctor_summary(self):
        route = classify_agent_intent("我想上传检查报告，补充一份复诊资料")

        self.assertEqual(route.intent, "followup_document")
        self.assertNotIn("doctor_summary_agent", route.agents)
        self.assertFalse(route.allows_doctor_summary)

    def test_tool_shape_is_adk_safe_and_read_only(self):
        route = classify_caremind_intent("帮我整理近 30 天复诊摘要")

        self.assertEqual(route["intent"], "follow_up")
        self.assertEqual(route["agents"], ["doctor_summary_agent"])
        self.assertTrue(route["allows_doctor_summary"])
        self.assertFalse(route["blocks_ordinary_workflow"])
        self.assertEqual(route["model_routing"]["selected_model_profile"], "cloud_31b_long_context")
        self.assertEqual(route["model_routing"]["normalized_intent"], "follow_up_summary")


class CloudAgentConfigurationTests(unittest.TestCase):
    def setUp(self):
        self._install_fake_adk()
        fake_model_config = types.ModuleType("my_agent.model_config")
        fake_model_config.build_model = lambda: "fake-model"
        sys.modules["my_agent.model_config"] = fake_model_config
        sys.modules.pop("my_agent.cloud_agents", None)

    def _install_fake_adk(self):
        google = sys.modules.setdefault("google", types.ModuleType("google"))
        adk = types.ModuleType("google.adk")
        agents = types.ModuleType("google.adk.agents")
        llm_agent = types.ModuleType("google.adk.agents.llm_agent")

        class FakeAgent:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        llm_agent.Agent = FakeAgent
        google.adk = adk
        adk.agents = agents
        agents.llm_agent = llm_agent
        sys.modules["google.adk"] = adk
        sys.modules["google.adk.agents"] = agents
        sys.modules["google.adk.agents.llm_agent"] = llm_agent

    def test_root_agent_has_five_specialists_and_no_workflow_tool(self):
        cloud_agents = importlib.import_module("my_agent.cloud_agents")

        subagent_names = tuple(agent.name for agent in cloud_agents.root_agent.sub_agents)
        tool_names = tuple(getattr(tool, "__name__", str(tool)) for tool in cloud_agents.root_agent.tools)

        self.assertEqual(
            subagent_names,
            (
                "event_structuring_agent",
                "patient_risk_agent",
                "caregiver_support_agent",
                "care_plan_agent",
                "doctor_summary_agent",
            ),
        )
        self.assertNotIn("run_cloud_care_workflow", tool_names)
        self.assertEqual(tool_names, ("classify_caremind_intent",))

    def test_root_instruction_contains_prd_trigger_boundaries(self):
        cloud_agents = importlib.import_module("my_agent.cloud_agents")
        instruction = cloud_agents.root_agent.instruction

        self.assertIn("PRD 6.2 Agent 路由规则", instruction)
        self.assertIn("先调用只读工具 classify_caremind_intent", instruction)
        self.assertIn("daily_log 不触发 doctor_summary_agent", instruction)
        self.assertIn("medical_boundary/crisis", instruction)


class CloudWorkflowTriggerTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        os.environ["CARE_STATE_DIR"] = self._tmp.name
        os.environ["CAREMIND_MEMORY_DIR"] = os.path.join(self._tmp.name, "memory_store")
        for module_name in (
            "my_agent.care_state",
            "my_agent.memory_state",
            "my_agent.memory_tools",
            "my_agent.memory_router",
            "my_agent.cloud_tools",
        ):
            sys.modules.pop(module_name, None)

    def tearDown(self):
        self._tmp.cleanup()

    def test_daily_workflow_does_not_generate_doctor_summary_by_default(self):
        cloud_tools = importlib.import_module("my_agent.cloud_tools")

        with mock.patch.object(cloud_tools, "generate_doctor_summary", return_value={"ok": True}) as summary:
            result = cloud_tools.run_cloud_care_workflow(
                note="妈妈昨晚半夜起床三次，还说要回家",
                patient_id="route_test_patient",
                caregiver_id="route_test_caregiver",
            )

        summary.assert_not_called()
        self.assertIsNone(result["doctor_summary"])

    def test_followup_workflow_can_explicitly_generate_doctor_summary(self):
        cloud_tools = importlib.import_module("my_agent.cloud_tools")

        with mock.patch.object(cloud_tools, "generate_doctor_summary", return_value={"ok": True}) as summary:
            result = cloud_tools.run_cloud_care_workflow(
                note="妈妈昨晚半夜起床三次，还说要回家",
                patient_id="route_test_patient",
                caregiver_id="route_test_caregiver",
                include_doctor_summary=True,
            )

        summary.assert_called_once_with("route_test_patient", "recent", True)
        self.assertEqual(result["doctor_summary"], {"ok": True})


class CareWorkflowCommunicationScriptTests(unittest.TestCase):
    def test_communication_script_is_present_for_general_daily_log(self):
        from my_agent.care_workflow_service import build_communication_script, build_structured_log

        log = build_structured_log(
            "今天妈妈上午状态还可以，吃了早饭，下午有点累。",
            [],
            "2026-06-12T00:00:00+08:00",
        )

        script = build_communication_script("今天妈妈上午状态还可以，吃了早饭，下午有点累。", log)

        self.assertIsNotNone(script)
        self.assertEqual(script.scenario_type, "general_support")
        self.assertTrue(script.recommended)
        self.assertTrue(script.record_suggestion)

    def test_communication_script_keeps_specific_home_seeking_copy(self):
        from my_agent.care_workflow_service import build_communication_script, build_structured_log

        note = "妈妈下午一直说要回老家，我不知道该怎么回应。"
        log = build_structured_log(note, [], "2026-06-12T00:00:00+08:00")

        script = build_communication_script(note, log)

        self.assertIsNotNone(script)
        self.assertEqual(script.scenario_type, "home_seeking")
        self.assertIn("想家", script.recommended)
        self.assertTrue(script.record_suggestion)


if __name__ == "__main__":
    unittest.main()
