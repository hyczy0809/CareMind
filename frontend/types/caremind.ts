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
}

export interface AttentionItem {
  id: string;
  type: "night_safety" | "nutrition" | "medication" | "wandering" | "caregiver";
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
