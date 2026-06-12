"""Shared CareMind workflow schemas for the MVP business API.

These models mirror ``frontend/types/care-workflow.ts`` and
``docs/schemas/care-workflow.schema.json``. They are intentionally separate
from the ADK/OpenAI-compatible route so the app can integrate with a stable,
typed business contract in later implementation phases.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


ConfidenceLevel = Literal["low", "medium", "high"]
CareSeverity = Literal["low", "medium", "high", "crisis"]
UnknownBool = Union[bool, Literal["unknown"]]
ActionStatusV2 = Literal["pending", "done", "blocked"]
GuardrailType = Literal["none", "diagnosis", "medication", "imaging_or_test", "crisis", "emergency"]
CareWorkflowStatus = Literal["ok", "guardrail", "error"]
CareLogSource = Literal["manual", "voice", "onboarding", "quick_chip"]
FollowupRange = Literal["7d", "30d", "custom"]
FollowupSummaryStatus = Literal["ok", "error"]
FollowupReadinessLevel = Literal["empty", "early", "ready"]
ReportMetricTone = Literal["brand", "watch", "alert", "info"]
ModelProfileV2 = Literal[
    "on_device_e2b",
    "on_device_e4b",
    "cloud_26b",
    "cloud_31b",
    "cloud_31b_long_context",
    "cloud_26b_multimodal",
    "android_aicore_optional",
    "deterministic_fallback",
]
DocumentParseQuality = Literal["readable", "partially_readable", "unreadable", "unsupported"]


class CareWorkflowRequest(BaseModel):
    patient_id: str = Field(min_length=1)
    caregiver_id: str = Field(min_length=1)
    note: str = Field(min_length=1, max_length=1000)
    source: CareLogSource = "manual"
    client_event_id: Optional[str] = None
    timezone: Optional[str] = "Asia/Shanghai"


class GuardrailCheckRequest(BaseModel):
    patient_id: str = Field(default="local_patient", min_length=1)
    caregiver_id: str = Field(default="local_caregiver", min_length=1)
    note: str = Field(min_length=1, max_length=1000)
    timezone: Optional[str] = "Asia/Shanghai"


class AlternativeCtaV2(BaseModel):
    label: str
    action: Literal["create_doctor_question", "open_emergency_support", "save_observation", "open_followup_prep"]
    payload: Optional[dict[str, Any]] = None


class GuardrailResultV2(BaseModel):
    triggered: bool
    type: GuardrailType
    message: Optional[str] = None
    alternative_cta: Optional[AlternativeCtaV2] = None


class SleepLogV2(BaseModel):
    night_wakings: Optional[int] = Field(default=None, ge=0)
    note: str
    evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel


class BehaviorEventV2(BaseModel):
    event_type: str
    label: str
    frequency: str
    severity: CareSeverity
    evidence: str
    needs_communication_script: bool
    confidence: ConfidenceLevel


class NutritionLogV2(BaseModel):
    meal_intake: Literal["normal", "less", "few_bites", "refused", "unknown"]
    water_intake: Literal["normal", "less", "more", "unknown"]
    choking: UnknownBool
    weight_change: Literal["loss", "gain", "stable", "unknown"]
    note: str
    evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel


class MedicationLogV2(BaseModel):
    mentioned: bool
    refusal_count: Optional[int] = Field(default=None, ge=0)
    missed_dose: UnknownBool
    duplicate_dose: UnknownBool
    medication_names: list[str] = Field(default_factory=list)
    note: str
    evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel


class SafetyLogV2(BaseModel):
    night_wandering: UnknownBool
    door_exit_attempt: UnknownBool
    fall: UnknownBool
    wandering: UnknownBool
    acute_danger: bool
    note: str
    evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel


class CaregiverLogV2(BaseModel):
    quote: str
    sleep_hours_bucket: Literal["lt_4h", "4_6h", "gt_6h", "unknown"]
    mood_score: Optional[int] = Field(default=None, ge=1, le=5)
    support_today: Literal["yes", "no", "partial", "unknown"]
    personal_time: Optional[bool] = None
    stress_level: CareSeverity
    evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel


class StructuredLogV2(BaseModel):
    source_text: str = Field(min_length=1, max_length=1000)
    log_date: str
    sleep: SleepLogV2
    behavior: list[BehaviorEventV2] = Field(default_factory=list)
    nutrition: NutritionLogV2
    medication: MedicationLogV2
    safety: SafetyLogV2
    caregiver: CaregiverLogV2
    field_confidence: dict[str, float] = Field(default_factory=dict)
    low_confidence_fields: list[str] = Field(default_factory=list)
    notes_for_caregiver: list[str] = Field(default_factory=list)
    diagnostic_risk: bool = False


class AttentionActionV2(BaseModel):
    id: str
    label: str
    status: ActionStatusV2 = "pending"
    blocked_reason: Optional[str] = None
    alternative_label: Optional[str] = None


class AttentionItemV2(BaseModel):
    id: str
    type: Literal["night_safety", "nutrition", "medication", "wandering", "caregiver", "behavior"]
    severity: CareSeverity
    title: str
    evidence: str
    doctor_feedback_hint: str
    actions: list[AttentionActionV2] = Field(default_factory=list)


class CommunicationScriptV2(BaseModel):
    scenario_type: str
    not_recommended: str
    recommended: str
    principle: str
    speech_text: str
    record_suggestion: Optional[str] = None


class CaregiverSupportV2(BaseModel):
    stress_level: CareSeverity
    message: str
    suggested_action: str
    crisis: bool


class MemoryCandidateV2(BaseModel):
    id: str
    type: Literal[
        "behavior_pattern",
        "effective_strategy",
        "ineffective_strategy",
        "medication_observation",
        "caregiver_support",
        "communication_preference",
    ]
    title: str
    description: str
    evidence: list[str] = Field(default_factory=list)
    requires_confirmation: bool = True


class FollowupPatchV2(BaseModel):
    summary_bullets: list[str] = Field(default_factory=list)
    doctor_questions: list[str] = Field(default_factory=list)
    materials_to_bring: list[str] = Field(default_factory=list)


class FollowupMemoryItemV2(BaseModel):
    id: str
    type: str
    status: str
    title: str
    description: str
    evidence: list[str] = Field(default_factory=list)


class FollowupDocumentItemV2(BaseModel):
    id: str
    type: str
    status: str
    title: str
    summary: Optional[str] = None
    confirmed_items: list[str] = Field(default_factory=list)
    reviewed_at: Optional[str] = None
    parse_quality: Optional[DocumentParseQuality] = None
    doctor_review_needed: bool = False
    medical_term_candidates: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)


class FollowupSummaryRequest(BaseModel):
    patient_id: str = Field(min_length=1)
    caregiver_id: str = Field(min_length=1)
    date_range: FollowupRange = "7d"
    record_count: int = Field(ge=0)
    attention_items: list[AttentionItemV2] = Field(default_factory=list)
    memory_items: list[FollowupMemoryItemV2] = Field(default_factory=list)
    followup_documents: list[FollowupDocumentItemV2] = Field(default_factory=list)
    care_logs: list[StructuredLogV2] = Field(default_factory=list)
    daily_metrics: list[dict[str, Any]] = Field(default_factory=list)
    caregiver_daily_metrics_trend: dict[str, Any] = Field(default_factory=dict)
    document_images: list[dict[str, Any]] = Field(default_factory=list)
    include_english_key_phrases: bool = False
    cloud_summary_allowed: bool = True
    raw_text_upload_allowed: bool = True
    full_window_required: bool = True
    timezone: Optional[str] = "Asia/Shanghai"


class ReportMetricV2(BaseModel):
    label: str
    value: str
    helper: str
    tone: ReportMetricTone


class FollowupReadinessV2(BaseModel):
    level: FollowupReadinessLevel
    record_count: int = Field(ge=0)
    message: str


class FollowupSummaryResponse(BaseModel):
    report_id: str
    status: FollowupSummaryStatus
    patient_id: str
    caregiver_id: str
    date_range: FollowupRange
    generated_at: str
    readiness: FollowupReadinessV2
    metrics: list[ReportMetricV2] = Field(default_factory=list)
    followup_patch: FollowupPatchV2
    tried_strategies: list[str] = Field(default_factory=list)
    boundary_notice: str
    summary_zh: Optional[str] = None
    english_key_phrases: list[str] = Field(default_factory=list)
    source_window_days: int = Field(default=7, ge=0)
    unreadable_documents: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)
    model_profile: ModelProfileV2 = "deterministic_fallback"
    input_bundle_overview: dict[str, Any] = Field(default_factory=dict)
    error: Optional[CareWorkflowError] = None


class CareWorkflowAnalyticsContext(BaseModel):
    event_count: int = Field(ge=0)
    high_attention_count: int = Field(ge=0)
    guardrail_type: GuardrailType
    memory_candidate_count: int = Field(ge=0)


class CareWorkflowError(BaseModel):
    code: str
    message: str
    retryable: bool


class CareWorkflowResponse(BaseModel):
    workflow_id: str
    status: CareWorkflowStatus
    patient_id: str
    caregiver_id: str
    generated_at: str
    guardrail: GuardrailResultV2
    structured_log: Optional[StructuredLogV2] = None
    attention_items: list[AttentionItemV2] = Field(default_factory=list)
    communication_script: Optional[CommunicationScriptV2] = None
    caregiver_support: Optional[CaregiverSupportV2] = None
    memory_candidates: list[MemoryCandidateV2] = Field(default_factory=list)
    followup_patch: Optional[FollowupPatchV2] = None
    analytics_context: CareWorkflowAnalyticsContext
    error: Optional[CareWorkflowError] = None


class GuardrailCheckResponse(BaseModel):
    checked_at: str
    patient_id: str
    caregiver_id: str
    guardrail: GuardrailResultV2
