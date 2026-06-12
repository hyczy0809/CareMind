import { Platform } from "react-native";

export type CareMindIntent =
  | "daily_log"
  | "communication"
  | "communication_simple"
  | "communication_complex"
  | "caregiver_support"
  | "follow_up"
  | "follow_up_summary"
  | "followup_document"
  | "medical_boundary"
  | "crisis"
  | "offline_summary"
  | "onboarding"
  | "today_care"
  | "android_system_prompt";

export type ModelProfile =
  | "on_device_e2b"
  | "on_device_e4b"
  | "cloud_26b"
  | "cloud_31b"
  | "cloud_31b_long_context"
  | "cloud_26b_multimodal"
  | "android_aicore_optional"
  | "deterministic_fallback";

export type CareMindPlatform = "ios" | "android" | "backend";

export type RoutingRuntimePlatform = CareMindPlatform | "web" | "unknown";

export type RoutingPrivacyMode = "standard" | "local_first";

export type RuntimeInitializationState =
  | "uninitialized"
  | "downloading"
  | "ready"
  | "missing_model"
  | "unsupported_device"
  | "memory_pressure"
  | "init_failed"
  | "timed_out";

export interface LocalFirstPrivacyConfig {
  local_first_enabled: boolean;
  cloud_fallback_allowed: boolean;
  cloud_summary_allowed: boolean;
  raw_text_upload_allowed: boolean;
  document_cloud_parse_allowed: boolean;
  structured_metrics_upload_allowed: boolean;
}

export interface MobileModelAvailability {
  platform: RoutingRuntimePlatform;
  model_id: string | null;
  profile: ModelProfile | null;
  installed: boolean;
  downloadable: boolean;
  runtime_supported: boolean;
  memory_eligible: boolean;
  recommended_backend?: "AUTO" | "CPU" | "GPU" | "aicore" | "unknown";
  size_bytes?: number;
  reason?: string;
}

export interface RuntimeInitializationStatus {
  status: RuntimeInitializationState;
  runtime: string;
  model_id: string | null;
  backend: "AUTO" | "CPU" | "GPU" | "aicore" | "unknown";
  error_code: string | null;
  error_message: string | null;
  initialized_at: string | null;
}

export interface ModelRoutingPolicy {
  intent: CareMindIntent;
  normalized_intent: CareMindIntent;
  default_model_profile: ModelProfile;
  local_profiles: ModelProfile[];
  cloud_profile: ModelProfile | null;
  fallback_model_profile: ModelProfile;
  timeout_ms: number;
  privacy_note: string;
}

export interface RoutingDecision {
  intent: CareMindIntent;
  normalized_intent: CareMindIntent;
  platform: RoutingRuntimePlatform;
  selected_model_profile: ModelProfile;
  default_model_profile: ModelProfile;
  fallback_model_profile: ModelProfile;
  timeout_ms: number;
  requires_user_consent: boolean;
  privacy_mode: RoutingPrivacyMode;
  network_required: boolean;
  local_model_required: boolean;
  reason: string;
  telemetry_id: string;
}

export interface RouteIntentInput {
  intent: CareMindIntent;
  platform?: RoutingRuntimePlatform;
  privacy: LocalFirstPrivacyConfig;
  model_availability?: MobileModelAvailability | null;
  network_available?: boolean;
  user_confirmed_cloud?: boolean;
  complexity?: "simple" | "complex";
}

export const DEFAULT_LOCAL_FIRST_PRIVACY_CONFIG: LocalFirstPrivacyConfig = {
  local_first_enabled: false,
  cloud_fallback_allowed: true,
  cloud_summary_allowed: true,
  raw_text_upload_allowed: true,
  document_cloud_parse_allowed: true,
  structured_metrics_upload_allowed: true
};

export const STRICT_LOCAL_FIRST_PRIVACY_CONFIG: LocalFirstPrivacyConfig = {
  local_first_enabled: true,
  cloud_fallback_allowed: false,
  cloud_summary_allowed: false,
  raw_text_upload_allowed: false,
  document_cloud_parse_allowed: false,
  structured_metrics_upload_allowed: true
};

function normalizedIntent(intent: CareMindIntent, complexity?: "simple" | "complex"): CareMindIntent {
  if (intent === "communication") {
    return complexity === "complex" ? "communication_complex" : "communication_simple";
  }
  if (intent === "follow_up") return "follow_up_summary";
  if (intent === "today_care" || intent === "onboarding") return "daily_log";
  return intent;
}

const POLICY_BY_NORMALIZED_INTENT: Record<string, Omit<ModelRoutingPolicy, "intent" | "normalized_intent">> = {
  daily_log: {
    default_model_profile: "on_device_e2b",
    local_profiles: ["on_device_e2b", "on_device_e4b"],
    cloud_profile: "cloud_26b",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 4_000,
    privacy_note: "Local first; upload structured metrics only when local-first is enabled."
  },
  communication_simple: {
    default_model_profile: "on_device_e2b",
    local_profiles: ["on_device_e2b", "on_device_e4b"],
    cloud_profile: "cloud_26b",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 4_000,
    privacy_note: "Local preferred for short phrasing."
  },
  communication_complex: {
    default_model_profile: "cloud_31b",
    local_profiles: [],
    cloud_profile: "cloud_31b",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 10_000,
    privacy_note: "Requires cloud consent in local-first mode."
  },
  caregiver_support: {
    default_model_profile: "on_device_e2b",
    local_profiles: ["on_device_e2b", "on_device_e4b"],
    cloud_profile: "cloud_26b",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 4_000,
    privacy_note: "Configurable local/cloud profile based on device capability and privacy mode."
  },
  follow_up_summary: {
    default_model_profile: "cloud_31b_long_context",
    local_profiles: [],
    cloud_profile: "cloud_31b_long_context",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 10_000,
    privacy_note: "Cloud summary requires explicit confirmation in local-first mode."
  },
  followup_document: {
    default_model_profile: "cloud_26b_multimodal",
    local_profiles: [],
    cloud_profile: "cloud_26b_multimodal",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 15_000,
    privacy_note: "Document files stay local unless cloud parsing is explicitly confirmed."
  },
  medical_boundary: {
    default_model_profile: "on_device_e2b",
    local_profiles: ["on_device_e2b", "on_device_e4b"],
    cloud_profile: "cloud_31b",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 4_000,
    privacy_note: "Basic boundary locally; complex explanation only with cloud permission."
  },
  crisis: {
    default_model_profile: "deterministic_fallback",
    local_profiles: ["on_device_e2b", "on_device_e4b"],
    cloud_profile: "cloud_26b",
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 0,
    privacy_note: "Local detector and emergency template must be immediate."
  },
  offline_summary: {
    default_model_profile: "on_device_e2b",
    local_profiles: ["on_device_e2b", "on_device_e4b"],
    cloud_profile: null,
    fallback_model_profile: "deterministic_fallback",
    timeout_ms: 4_000,
    privacy_note: "Local only."
  },
  android_system_prompt: {
    default_model_profile: "android_aicore_optional",
    local_profiles: ["android_aicore_optional"],
    cloud_profile: null,
    fallback_model_profile: "on_device_e2b",
    timeout_ms: 4_000,
    privacy_note: "Android-only optional AICore/ML Kit route; fall back to LiteRT-LM."
  }
};

export function getCurrentRoutingPlatform(): RoutingRuntimePlatform {
  if (Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web") {
    return Platform.OS;
  }
  return "unknown";
}

export function buildPrivacyConfig(localFirstEnabled: boolean): LocalFirstPrivacyConfig {
  return localFirstEnabled ? STRICT_LOCAL_FIRST_PRIVACY_CONFIG : DEFAULT_LOCAL_FIRST_PRIVACY_CONFIG;
}

export function getRoutingPolicy(intent: CareMindIntent, complexity?: "simple" | "complex"): ModelRoutingPolicy {
  const normalized = normalizedIntent(intent, complexity);
  const policy = POLICY_BY_NORMALIZED_INTENT[normalized] ?? POLICY_BY_NORMALIZED_INTENT.daily_log;
  return {
    intent,
    normalized_intent: normalized,
    ...policy
  };
}

function isLocalUsable(policy: ModelRoutingPolicy, availability?: MobileModelAvailability | null): boolean {
  if (!availability) return false;
  if (!availability.installed || !availability.runtime_supported || !availability.memory_eligible) return false;
  if (!availability.profile) return policy.local_profiles.length > 0;
  return policy.local_profiles.includes(availability.profile);
}

function isCloudAllowed(policy: ModelRoutingPolicy, privacy: LocalFirstPrivacyConfig, userConfirmedCloud: boolean): boolean {
  if (!policy.cloud_profile) return false;
  if (!privacy.local_first_enabled) return true;
  if (policy.normalized_intent === "follow_up_summary") {
    return privacy.cloud_summary_allowed && userConfirmedCloud;
  }
  if (policy.normalized_intent === "followup_document") {
    return privacy.document_cloud_parse_allowed && userConfirmedCloud;
  }
  return privacy.cloud_fallback_allowed && userConfirmedCloud;
}

export function routeIntent(input: RouteIntentInput): RoutingDecision {
  const policy = getRoutingPolicy(input.intent, input.complexity);
  const platform = input.platform ?? getCurrentRoutingPlatform();
  const networkAvailable = input.network_available ?? true;
  const userConfirmedCloud = input.user_confirmed_cloud ?? false;
  const telemetryId = `route_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (isLocalUsable(policy, input.model_availability)) {
    const selected = input.model_availability?.profile ?? policy.local_profiles[0] ?? policy.default_model_profile;
    return {
      intent: input.intent,
      normalized_intent: policy.normalized_intent,
      platform,
      selected_model_profile: selected,
      default_model_profile: policy.default_model_profile,
      fallback_model_profile: policy.cloud_profile ?? policy.fallback_model_profile,
      timeout_ms: policy.timeout_ms,
      requires_user_consent: false,
      privacy_mode: input.privacy.local_first_enabled ? "local_first" : "standard",
      network_required: false,
      local_model_required: true,
      reason: "local model is installed, supported, and eligible for this intent",
      telemetry_id: telemetryId
    };
  }

  const cloudAllowed = isCloudAllowed(policy, input.privacy, userConfirmedCloud);
  if (policy.cloud_profile && networkAvailable && cloudAllowed) {
    return {
      intent: input.intent,
      normalized_intent: policy.normalized_intent,
      platform,
      selected_model_profile: policy.cloud_profile,
      default_model_profile: policy.default_model_profile,
      fallback_model_profile: policy.fallback_model_profile,
      timeout_ms: policy.timeout_ms,
      requires_user_consent: input.privacy.local_first_enabled && !userConfirmedCloud,
      privacy_mode: input.privacy.local_first_enabled ? "local_first" : "standard",
      network_required: true,
      local_model_required: false,
      reason: "cloud profile selected because local model is unavailable or not eligible",
      telemetry_id: telemetryId
    };
  }

  return {
    intent: input.intent,
    normalized_intent: policy.normalized_intent,
    platform,
    selected_model_profile:
      policy.normalized_intent === "android_system_prompt" ? "on_device_e2b" : policy.fallback_model_profile,
    default_model_profile: policy.default_model_profile,
    fallback_model_profile: policy.fallback_model_profile,
    timeout_ms: policy.timeout_ms,
    requires_user_consent: !!policy.cloud_profile && input.privacy.local_first_enabled && !userConfirmedCloud,
    privacy_mode: input.privacy.local_first_enabled ? "local_first" : "standard",
    network_required: false,
    local_model_required: policy.local_profiles.length > 0,
    reason: "using deterministic/local fallback because cloud is unavailable, denied, or requires consent",
    telemetry_id: telemetryId
  };
}
