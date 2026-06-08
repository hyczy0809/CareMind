export type MemoryType =
  | "behavior_pattern"
  | "effective_strategy"
  | "ineffective_strategy"
  | "medication_observation"
  | "caregiver_support"
  | "communication_preference";

export type MemoryStatus =
  | "candidate"
  | "confirmed"
  | "dismissed"
  | "local_only"
  | "synced"
  | "stale";

export type ActionStatus = "pending" | "done" | "blocked";

export type StressLevel = "low" | "medium" | "high" | "crisis";

export type FollowupDocumentStatus =
  | "uploading"
  | "parsing"
  | "selected"
  | "uploaded"
  | "review_required"
  | "reviewed"
  | "failed";

export type FollowupDocumentType =
  | "clinic_note"
  | "imaging_report"
  | "scale_result"
  | "medication_list"
  | "manual_summary";

export type FollowupDocumentParseConfidence = "low" | "medium" | "high";

export type FollowupDocumentParseSource =
  | "filename"
  | "user_summary"
  | "document_type"
  | "system_template";

export type AnalyticsEventName =
  | "demo_data_loaded"
  | "onboarding_completed"
  | "activity_started"
  | "activity_completed"
  | "activity_stopped"
  | "activity_feedback_saved"
  | "activity_memory_candidate_created"
  | "care_log_ai_parse_succeeded"
  | "care_log_ai_parse_failed"
  | "care_log_saved"
  | "action_status_changed"
  | "caregiver_checkin_saved"
  | "memory_confirmed"
  | "memory_dismissed"
  | "followup_range_changed"
  | "followup_report_loaded"
  | "followup_report_failed"
  | "followup_copy_started"
  | "followup_copy_succeeded"
  | "followup_copy_failed"
  | "document_upload_started"
  | "document_upload_succeeded"
  | "document_upload_failed"
  | "document_parse_started"
  | "document_parse_succeeded"
  | "document_parse_failed"
  | "document_review_confirmed"
  | "document_deleted"
  | "voice_input_started"
  | "voice_input_succeeded"
  | "voice_input_failed"
  | "voice_input_unsupported";

export interface AnalyticsEvent {
  id: string;
  name: AnalyticsEventName;
  createdAt: string;
  properties: Record<string, string | number | boolean | null>;
}

export interface MemoryItem {
  id: string;
  patientId: string;
  type: MemoryType;
  status: MemoryStatus;
  title: string;
  description: string;
  evidence: string[];
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
  requiresConfirmation: boolean;
}

export interface AttentionAction {
  id: string;
  label: string;
  status: ActionStatus;
  blockedReason?: string;
  alternativeLabel?: string;
}

export interface AttentionItem {
  id: string;
  type: "night_safety" | "nutrition" | "medication" | "wandering" | "caregiver" | "behavior";
  severity: "low" | "medium" | "high" | "crisis";
  title: string;
  evidence: string;
  actions: AttentionAction[];
  doctorFeedbackHint: string;
  createdAt: string;
}

export interface CaregiverCheckin {
  sleepHoursBucket: "lt_4h" | "4_6h" | "gt_6h" | "unknown";
  moodScore: 1 | 2 | 3 | 4 | 5;
  supportToday: "yes" | "no" | "partial" | "unknown";
  personalTime: boolean | null;
  stressLevel: StressLevel;
}

export interface CaregiverCheckinRecord extends CaregiverCheckin {
  id: string;
  createdAt: string;
}

export type CompanionActivityType = "photo_reminiscence" | "object_matching" | "familiar_sorting";

export type CompanionActivityParticipation = "willing" | "hesitant" | "resistant";

export type CompanionActivityMoodAfter = "calmer" | "same" | "more_agitated";

export interface CompanionActivityFeedback {
  activityType: CompanionActivityType;
  activityName: string;
  durationMinutes: number;
  participation: CompanionActivityParticipation;
  moodAfter: CompanionActivityMoodAfter;
  frustration: boolean;
  fatigue: boolean;
  stoppedEarly: boolean;
}

export interface CompanionActivityRecord extends CompanionActivityFeedback {
  id: string;
  patientId: string;
  createdAt: string;
}

export interface FollowupDocumentParseField {
  field: string;
  label: string;
  value: string;
  confidence: FollowupDocumentParseConfidence;
  source: FollowupDocumentParseSource;
  requires_confirmation: boolean;
}

export interface FollowupDocumentReviewQuestion {
  id: string;
  question: string;
  reason: string;
}

export interface FollowupDocumentParseResult {
  document_id: string;
  status: "review_required" | "parse_failed";
  extracted_fields: FollowupDocumentParseField[];
  review_questions: FollowupDocumentReviewQuestion[];
  followup_summary_items: string[];
  medical_boundary: string;
  parsed_at: string;
  parse_error: string | null;
}

export interface FollowupDocumentRecord {
  id: string;
  patientId: string;
  type: FollowupDocumentType;
  title: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  summary: string;
  status: FollowupDocumentStatus;
  documentId?: string;
  parseResult?: FollowupDocumentParseResult;
  confirmedItems?: string[];
  reviewedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CareLogRecord {
  id: string;
  patientId: string;
  note: string;
  structuredLog: StructuredLog;
  attentionItems: AttentionItem[];
  occurredAt?: string;
  createdAt: string;
}

export interface StructuredLog {
  sleep: {
    nightWakings: number | null;
    note: string;
  };
  behavior: {
    label: string;
    evidence: string;
    frequency: string;
  }[];
  nutrition: {
    mealIntake: "normal" | "less" | "few_bites" | "refused" | "unknown";
    waterIntake: "normal" | "less" | "more" | "unknown";
    choking: boolean | "unknown";
    weightChange: "loss" | "gain" | "stable" | "unknown";
    note: string;
  };
  medication: {
    mentioned: boolean;
    refusalCount: number | null;
    missedDose: boolean | "unknown";
    duplicateDose: boolean | "unknown";
    medicationNames: string[];
    note: string;
  };
  safety: {
    nightWandering: boolean | "unknown";
    doorExitAttempt: boolean | "unknown";
    fall: boolean | "unknown";
    wandering: boolean | "unknown";
    acuteDanger: boolean;
    note: string;
  };
  caregiver: {
    quote: string;
    stressSignal: boolean;
  };
}

export interface FollowupMetric {
  label: string;
  value: string;
  helper: string;
  tone: "brand" | "watch" | "alert" | "info";
}
