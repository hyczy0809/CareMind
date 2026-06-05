export type ConfidenceLevel = "low" | "medium" | "high";

export type CareSeverity = "low" | "medium" | "high" | "crisis";

export type UnknownBoolean = boolean | "unknown";

export type ActionStatusV2 = "pending" | "done" | "blocked";

export type GuardrailType = "none" | "diagnosis" | "medication" | "imaging_or_test" | "crisis" | "emergency";

export type CareWorkflowStatus = "ok" | "guardrail" | "error";

export type CareLogSource = "manual" | "voice" | "onboarding" | "quick_chip";

export type FollowupRange = "7d" | "30d" | "custom";

export type FollowupSummaryStatus = "ok" | "error";

export type FollowupReadinessLevel = "empty" | "early" | "ready";

export type ReportMetricTone = "brand" | "watch" | "alert" | "info";

export interface CareWorkflowRequest {
  patient_id: string;
  caregiver_id: string;
  note: string;
  source: CareLogSource;
  client_event_id?: string;
  timezone?: string;
}

export interface GuardrailCheckRequest {
  patient_id?: string;
  caregiver_id?: string;
  note: string;
  timezone?: string;
}

export interface AlternativeCtaV2 {
  label: string;
  action: "create_doctor_question" | "open_emergency_support" | "save_observation" | "open_followup_prep";
  payload?: Record<string, unknown>;
}

export interface GuardrailResultV2 {
  triggered: boolean;
  type: GuardrailType;
  message: string | null;
  alternative_cta: AlternativeCtaV2 | null;
}

export interface SleepLogV2 {
  night_wakings: number | null;
  note: string;
  evidence: string[];
  confidence: ConfidenceLevel;
}

export interface BehaviorEventV2 {
  event_type: string;
  label: string;
  frequency: string;
  severity: CareSeverity;
  evidence: string;
  needs_communication_script: boolean;
  confidence: ConfidenceLevel;
}

export interface NutritionLogV2 {
  meal_intake: "normal" | "less" | "few_bites" | "refused" | "unknown";
  water_intake: "normal" | "less" | "more" | "unknown";
  choking: UnknownBoolean;
  weight_change: "loss" | "gain" | "stable" | "unknown";
  note: string;
  evidence: string[];
  confidence: ConfidenceLevel;
}

export interface MedicationLogV2 {
  mentioned: boolean;
  refusal_count: number | null;
  missed_dose: UnknownBoolean;
  duplicate_dose: UnknownBoolean;
  medication_names: string[];
  note: string;
  evidence: string[];
  confidence: ConfidenceLevel;
}

export interface SafetyLogV2 {
  night_wandering: UnknownBoolean;
  door_exit_attempt: UnknownBoolean;
  fall: UnknownBoolean;
  wandering: UnknownBoolean;
  acute_danger: boolean;
  note: string;
  evidence: string[];
  confidence: ConfidenceLevel;
}

export interface CaregiverLogV2 {
  quote: string;
  sleep_hours_bucket: "lt_4h" | "4_6h" | "gt_6h" | "unknown";
  mood_score: 1 | 2 | 3 | 4 | 5 | null;
  support_today: "yes" | "no" | "partial" | "unknown";
  personal_time: boolean | null;
  stress_level: CareSeverity;
  evidence: string[];
  confidence: ConfidenceLevel;
}

export interface StructuredLogV2 {
  source_text: string;
  log_date: string;
  sleep: SleepLogV2;
  behavior: BehaviorEventV2[];
  nutrition: NutritionLogV2;
  medication: MedicationLogV2;
  safety: SafetyLogV2;
  caregiver: CaregiverLogV2;
}

export interface AttentionActionV2 {
  id: string;
  label: string;
  status: ActionStatusV2;
  blocked_reason?: string | null;
  alternative_label?: string | null;
}

export interface AttentionItemV2 {
  id: string;
  type: "night_safety" | "nutrition" | "medication" | "wandering" | "caregiver" | "behavior";
  severity: CareSeverity;
  title: string;
  evidence: string;
  doctor_feedback_hint: string;
  actions: AttentionActionV2[];
}

export interface CommunicationScriptV2 {
  scenario_type: string;
  not_recommended: string;
  recommended: string;
  principle: string;
  speech_text: string;
}

export interface CaregiverSupportV2 {
  stress_level: CareSeverity;
  message: string;
  suggested_action: string;
  crisis: boolean;
}

export interface MemoryCandidateV2 {
  id: string;
  type:
    | "behavior_pattern"
    | "effective_strategy"
    | "ineffective_strategy"
    | "medication_observation"
    | "caregiver_support"
    | "communication_preference";
  title: string;
  description: string;
  evidence: string[];
  requires_confirmation: boolean;
}

export interface FollowupPatchV2 {
  summary_bullets: string[];
  doctor_questions: string[];
  materials_to_bring: string[];
}

export interface FollowupMemoryItemV2 {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string;
  evidence: string[];
}

export interface FollowupDocumentItemV2 {
  id: string;
  type: string;
  status: string;
  title: string;
  summary?: string | null;
  confirmed_items: string[];
  reviewed_at?: string | null;
}

export interface FollowupSummaryRequest {
  patient_id: string;
  caregiver_id: string;
  date_range: FollowupRange;
  record_count: number;
  attention_items: AttentionItemV2[];
  memory_items: FollowupMemoryItemV2[];
  followup_documents: FollowupDocumentItemV2[];
  timezone?: string;
}

export interface ReportMetricV2 {
  label: string;
  value: string;
  helper: string;
  tone: ReportMetricTone;
}

export interface FollowupReadinessV2 {
  level: FollowupReadinessLevel;
  record_count: number;
  message: string;
}

export interface CareWorkflowAnalyticsContext {
  event_count: number;
  high_attention_count: number;
  guardrail_type: GuardrailType;
  memory_candidate_count: number;
}

export interface CareWorkflowError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface CareWorkflowResponse {
  workflow_id: string;
  status: CareWorkflowStatus;
  patient_id: string;
  caregiver_id: string;
  generated_at: string;
  guardrail: GuardrailResultV2;
  structured_log: StructuredLogV2 | null;
  attention_items: AttentionItemV2[];
  communication_script: CommunicationScriptV2 | null;
  caregiver_support: CaregiverSupportV2 | null;
  memory_candidates: MemoryCandidateV2[];
  followup_patch: FollowupPatchV2 | null;
  analytics_context: CareWorkflowAnalyticsContext;
  error?: CareWorkflowError;
}

export interface GuardrailCheckResponse {
  checked_at: string;
  patient_id: string;
  caregiver_id: string;
  guardrail: GuardrailResultV2;
}

export interface FollowupSummaryResponse {
  report_id: string;
  status: FollowupSummaryStatus;
  patient_id: string;
  caregiver_id: string;
  date_range: FollowupRange;
  generated_at: string;
  readiness: FollowupReadinessV2;
  metrics: ReportMetricV2[];
  followup_patch: FollowupPatchV2;
  tried_strategies: string[];
  boundary_notice: string;
  error?: CareWorkflowError | null;
}
