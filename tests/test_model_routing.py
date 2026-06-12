import unittest

from my_agent.model_routing import (
    MobileModelAvailability,
    STRICT_LOCAL_FIRST_PRIVACY_CONFIG,
    STANDARD_PRIVACY_CONFIG,
    build_privacy_config,
    get_routing_policy,
    route_intent,
)


class ModelRoutingTests(unittest.TestCase):
    def test_daily_log_uses_on_device_e2b_when_available(self):
        availability = MobileModelAvailability(
            platform="ios",
            model_id="gemma-4-E2B-it.litertlm",
            profile="on_device_e2b",
            installed=True,
            downloadable=True,
            runtime_supported=True,
            memory_eligible=True,
        )

        decision = route_intent(
            "daily_log",
            platform="ios",
            privacy=STANDARD_PRIVACY_CONFIG,
            model_availability=availability,
        )

        self.assertEqual(decision.selected_model_profile, "on_device_e2b")
        self.assertFalse(decision.network_required)
        self.assertEqual(decision.timeout_ms, 4000)

    def test_local_first_without_local_model_does_not_fallback_to_cloud_without_consent(self):
        decision = route_intent(
            "daily_log",
            platform="android",
            privacy=STRICT_LOCAL_FIRST_PRIVACY_CONFIG,
            model_availability=None,
            user_confirmed_cloud=False,
        )

        self.assertEqual(decision.selected_model_profile, "deterministic_fallback")
        self.assertTrue(decision.requires_user_consent)
        self.assertFalse(decision.network_required)

    def test_follow_up_summary_requires_cloud_consent_in_local_first_mode(self):
        denied = route_intent(
            "follow_up",
            platform="backend",
            privacy=STRICT_LOCAL_FIRST_PRIVACY_CONFIG,
            user_confirmed_cloud=False,
        )

        self.assertEqual(denied.normalized_intent, "follow_up_summary")
        self.assertEqual(denied.selected_model_profile, "deterministic_fallback")
        self.assertTrue(denied.requires_user_consent)

        allowed = route_intent(
            "follow_up",
            platform="backend",
            privacy=build_privacy_config(False),
            user_confirmed_cloud=False,
        )

        self.assertEqual(allowed.selected_model_profile, "cloud_31b_long_context")
        self.assertTrue(allowed.network_required)

    def test_document_parsing_routes_to_multimodal_cloud_profile(self):
        policy = get_routing_policy("followup_document")
        decision = route_intent(
            "followup_document",
            platform="backend",
            privacy=STANDARD_PRIVACY_CONFIG,
        )

        self.assertEqual(policy.default_model_profile, "cloud_26b_multimodal")
        self.assertEqual(decision.selected_model_profile, "cloud_26b_multimodal")
        self.assertEqual(decision.timeout_ms, 15000)

    def test_android_aicore_optional_falls_back_to_litert_lm_profile(self):
        decision = route_intent(
            "android_system_prompt",
            platform="android",
            privacy=STANDARD_PRIVACY_CONFIG,
            model_availability=None,
        )

        self.assertEqual(decision.default_model_profile, "android_aicore_optional")
        self.assertEqual(decision.selected_model_profile, "on_device_e2b")
        self.assertFalse(decision.network_required)


if __name__ == "__main__":
    unittest.main()
