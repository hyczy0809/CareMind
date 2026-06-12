"""Gemma 4 model-profile routing contracts for CareMind.

This module is intentionally deterministic. It mirrors the mobile TypeScript
router so backend tests, cloud adapters, and future ADK orchestration can agree
on the same intent/profile/fallback language before model calls are changed.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Literal, Optional


CareMindIntent = Literal[
    "daily_log",
    "communication",
    "communication_simple",
    "communication_complex",
    "caregiver_support",
    "follow_up",
    "follow_up_summary",
    "followup_document",
    "medical_boundary",
    "crisis",
    "offline_summary",
    "onboarding",
    "today_care",
    "android_system_prompt",
]

ModelProfile = Literal[
    "on_device_e2b",
    "on_device_e4b",
    "cloud_26b",
    "cloud_31b",
    "cloud_31b_long_context",
    "cloud_26b_multimodal",
    "android_aicore_optional",
    "deterministic_fallback",
]

CareMindPlatform = Literal["ios", "android", "backend", "web", "unknown"]
RoutingPrivacyMode = Literal["standard", "local_first"]


@dataclass(frozen=True)
class LocalFirstPrivacyConfig:
    local_first_enabled: bool = False
    cloud_fallback_allowed: bool = True
    cloud_summary_allowed: bool = True
    raw_text_upload_allowed: bool = True
    document_cloud_parse_allowed: bool = True
    structured_metrics_upload_allowed: bool = True


@dataclass(frozen=True)
class MobileModelAvailability:
    platform: CareMindPlatform
    model_id: Optional[str]
    profile: Optional[ModelProfile]
    installed: bool
    downloadable: bool
    runtime_supported: bool
    memory_eligible: bool
    recommended_backend: str = "AUTO"
    size_bytes: Optional[int] = None
    reason: Optional[str] = None


@dataclass(frozen=True)
class ModelRoutingPolicy:
    intent: CareMindIntent
    normalized_intent: CareMindIntent
    default_model_profile: ModelProfile
    local_profiles: tuple[ModelProfile, ...]
    cloud_profile: Optional[ModelProfile]
    fallback_model_profile: ModelProfile
    timeout_ms: int
    privacy_note: str


@dataclass(frozen=True)
class RoutingDecision:
    intent: CareMindIntent
    normalized_intent: CareMindIntent
    platform: CareMindPlatform
    selected_model_profile: ModelProfile
    default_model_profile: ModelProfile
    fallback_model_profile: ModelProfile
    timeout_ms: int
    requires_user_consent: bool
    privacy_mode: RoutingPrivacyMode
    network_required: bool
    local_model_required: bool
    reason: str
    telemetry_id: str

    def as_dict(self) -> dict[str, object]:
        return {
            "intent": self.intent,
            "normalized_intent": self.normalized_intent,
            "platform": self.platform,
            "selected_model_profile": self.selected_model_profile,
            "default_model_profile": self.default_model_profile,
            "fallback_model_profile": self.fallback_model_profile,
            "timeout_ms": self.timeout_ms,
            "requires_user_consent": self.requires_user_consent,
            "privacy_mode": self.privacy_mode,
            "network_required": self.network_required,
            "local_model_required": self.local_model_required,
            "reason": self.reason,
            "telemetry_id": self.telemetry_id,
        }


STANDARD_PRIVACY_CONFIG = LocalFirstPrivacyConfig()
STRICT_LOCAL_FIRST_PRIVACY_CONFIG = LocalFirstPrivacyConfig(
    local_first_enabled=True,
    cloud_fallback_allowed=False,
    cloud_summary_allowed=False,
    raw_text_upload_allowed=False,
    document_cloud_parse_allowed=False,
    structured_metrics_upload_allowed=True,
)


def build_privacy_config(local_first_enabled: bool) -> LocalFirstPrivacyConfig:
    return STRICT_LOCAL_FIRST_PRIVACY_CONFIG if local_first_enabled else STANDARD_PRIVACY_CONFIG


def normalize_intent(intent: CareMindIntent, complexity: Literal["simple", "complex"] = "simple") -> CareMindIntent:
    if intent == "communication":
        return "communication_complex" if complexity == "complex" else "communication_simple"
    if intent == "follow_up":
        return "follow_up_summary"
    if intent in ("today_care", "onboarding"):
        return "daily_log"
    return intent


_POLICY_BY_NORMALIZED_INTENT: dict[CareMindIntent, dict[str, object]] = {
    "daily_log": {
        "default_model_profile": "on_device_e2b",
        "local_profiles": ("on_device_e2b", "on_device_e4b"),
        "cloud_profile": "cloud_26b",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 4000,
        "privacy_note": "Local first; upload structured metrics only when local-first is enabled.",
    },
    "communication_simple": {
        "default_model_profile": "on_device_e2b",
        "local_profiles": ("on_device_e2b", "on_device_e4b"),
        "cloud_profile": "cloud_26b",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 4000,
        "privacy_note": "Local preferred for short phrasing.",
    },
    "communication_complex": {
        "default_model_profile": "cloud_31b",
        "local_profiles": (),
        "cloud_profile": "cloud_31b",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 10000,
        "privacy_note": "Requires cloud consent in local-first mode.",
    },
    "caregiver_support": {
        "default_model_profile": "on_device_e2b",
        "local_profiles": ("on_device_e2b", "on_device_e4b"),
        "cloud_profile": "cloud_26b",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 4000,
        "privacy_note": "Configurable local/cloud profile based on device capability and privacy mode.",
    },
    "follow_up_summary": {
        "default_model_profile": "cloud_31b_long_context",
        "local_profiles": (),
        "cloud_profile": "cloud_31b_long_context",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 10000,
        "privacy_note": "Cloud summary requires explicit confirmation in local-first mode.",
    },
    "followup_document": {
        "default_model_profile": "cloud_26b_multimodal",
        "local_profiles": (),
        "cloud_profile": "cloud_26b_multimodal",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 15000,
        "privacy_note": "Document files stay local unless cloud parsing is explicitly confirmed.",
    },
    "medical_boundary": {
        "default_model_profile": "on_device_e2b",
        "local_profiles": ("on_device_e2b", "on_device_e4b"),
        "cloud_profile": "cloud_31b",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 4000,
        "privacy_note": "Basic boundary locally; complex explanation only with cloud permission.",
    },
    "crisis": {
        "default_model_profile": "deterministic_fallback",
        "local_profiles": ("on_device_e2b", "on_device_e4b"),
        "cloud_profile": "cloud_26b",
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 0,
        "privacy_note": "Local detector and emergency template must be immediate.",
    },
    "offline_summary": {
        "default_model_profile": "on_device_e2b",
        "local_profiles": ("on_device_e2b", "on_device_e4b"),
        "cloud_profile": None,
        "fallback_model_profile": "deterministic_fallback",
        "timeout_ms": 4000,
        "privacy_note": "Local only.",
    },
    "android_system_prompt": {
        "default_model_profile": "android_aicore_optional",
        "local_profiles": ("android_aicore_optional",),
        "cloud_profile": None,
        "fallback_model_profile": "on_device_e2b",
        "timeout_ms": 4000,
        "privacy_note": "Android-only optional AICore/ML Kit route; fall back to LiteRT-LM.",
    },
}


def get_routing_policy(
    intent: CareMindIntent,
    complexity: Literal["simple", "complex"] = "simple",
) -> ModelRoutingPolicy:
    normalized = normalize_intent(intent, complexity)
    raw = _POLICY_BY_NORMALIZED_INTENT.get(normalized, _POLICY_BY_NORMALIZED_INTENT["daily_log"])
    return ModelRoutingPolicy(
        intent=intent,
        normalized_intent=normalized,
        default_model_profile=raw["default_model_profile"],  # type: ignore[arg-type]
        local_profiles=raw["local_profiles"],  # type: ignore[arg-type]
        cloud_profile=raw["cloud_profile"],  # type: ignore[arg-type]
        fallback_model_profile=raw["fallback_model_profile"],  # type: ignore[arg-type]
        timeout_ms=raw["timeout_ms"],  # type: ignore[arg-type]
        privacy_note=raw["privacy_note"],  # type: ignore[arg-type]
    )


def _local_usable(policy: ModelRoutingPolicy, availability: Optional[MobileModelAvailability]) -> bool:
    if availability is None:
        return False
    if not (availability.installed and availability.runtime_supported and availability.memory_eligible):
        return False
    if availability.profile is None:
        return bool(policy.local_profiles)
    return availability.profile in policy.local_profiles


def _cloud_allowed(
    policy: ModelRoutingPolicy,
    privacy: LocalFirstPrivacyConfig,
    user_confirmed_cloud: bool,
) -> bool:
    if policy.cloud_profile is None:
        return False
    if not privacy.local_first_enabled:
        return True
    if policy.normalized_intent == "follow_up_summary":
        return privacy.cloud_summary_allowed and user_confirmed_cloud
    if policy.normalized_intent == "followup_document":
        return privacy.document_cloud_parse_allowed and user_confirmed_cloud
    return privacy.cloud_fallback_allowed and user_confirmed_cloud


def _telemetry_id() -> str:
    return f"route_{int(time.time() * 1000):x}_{uuid.uuid4().hex[:8]}"


def route_intent(
    intent: CareMindIntent,
    *,
    platform: CareMindPlatform = "backend",
    privacy: LocalFirstPrivacyConfig = STANDARD_PRIVACY_CONFIG,
    model_availability: Optional[MobileModelAvailability] = None,
    network_available: bool = True,
    user_confirmed_cloud: bool = False,
    complexity: Literal["simple", "complex"] = "simple",
) -> RoutingDecision:
    policy = get_routing_policy(intent, complexity)

    if _local_usable(policy, model_availability):
        selected = model_availability.profile or policy.local_profiles[0] or policy.default_model_profile
        return RoutingDecision(
            intent=intent,
            normalized_intent=policy.normalized_intent,
            platform=platform,
            selected_model_profile=selected,
            default_model_profile=policy.default_model_profile,
            fallback_model_profile=policy.cloud_profile or policy.fallback_model_profile,
            timeout_ms=policy.timeout_ms,
            requires_user_consent=False,
            privacy_mode="local_first" if privacy.local_first_enabled else "standard",
            network_required=False,
            local_model_required=True,
            reason="local model is installed, supported, and eligible for this intent",
            telemetry_id=_telemetry_id(),
        )

    if policy.cloud_profile and network_available and _cloud_allowed(policy, privacy, user_confirmed_cloud):
        return RoutingDecision(
            intent=intent,
            normalized_intent=policy.normalized_intent,
            platform=platform,
            selected_model_profile=policy.cloud_profile,
            default_model_profile=policy.default_model_profile,
            fallback_model_profile=policy.fallback_model_profile,
            timeout_ms=policy.timeout_ms,
            requires_user_consent=privacy.local_first_enabled and not user_confirmed_cloud,
            privacy_mode="local_first" if privacy.local_first_enabled else "standard",
            network_required=True,
            local_model_required=False,
            reason="cloud profile selected because local model is unavailable or not eligible",
            telemetry_id=_telemetry_id(),
        )

    return RoutingDecision(
        intent=intent,
        normalized_intent=policy.normalized_intent,
        platform=platform,
        selected_model_profile="on_device_e2b" if policy.normalized_intent == "android_system_prompt" else policy.fallback_model_profile,
        default_model_profile=policy.default_model_profile,
        fallback_model_profile=policy.fallback_model_profile,
        timeout_ms=policy.timeout_ms,
        requires_user_consent=bool(policy.cloud_profile and privacy.local_first_enabled and not user_confirmed_cloud),
        privacy_mode="local_first" if privacy.local_first_enabled else "standard",
        network_required=False,
        local_model_required=bool(policy.local_profiles),
        reason="using deterministic/local fallback because cloud is unavailable, denied, or requires consent",
        telemetry_id=_telemetry_id(),
    )
