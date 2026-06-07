// Mapping helpers between the V2 wire types (snake_case, shared with backend)
// and the app-internal camelCase types. Both cloud and local inference paths
// produce V2 shapes and then funnel through these mappers, so the rest of
// the app never sees a difference.

import type {
  AttentionItem,
  MemoryItem,
  StructuredLog
} from "../../../types/caremind";
import type {
  AttentionItemV2,
  CommunicationScriptV2,
  MemoryCandidateV2,
  StructuredLogV2
} from "../../../types/care-workflow";

export function mapStructuredLog(log: StructuredLogV2): StructuredLog {
  return {
    sleep: {
      nightWakings: log.sleep.night_wakings,
      note: log.sleep.note
    },
    behavior: log.behavior.map((item) => ({
      label: item.label,
      evidence: item.evidence,
      frequency: item.frequency
    })),
    nutrition: {
      mealIntake: log.nutrition.meal_intake,
      waterIntake: log.nutrition.water_intake,
      choking: log.nutrition.choking,
      weightChange: log.nutrition.weight_change,
      note: log.nutrition.note
    },
    medication: {
      mentioned: log.medication.mentioned,
      refusalCount: log.medication.refusal_count,
      missedDose: log.medication.missed_dose,
      duplicateDose: log.medication.duplicate_dose,
      medicationNames: log.medication.medication_names,
      note: log.medication.note
    },
    safety: {
      nightWandering: log.safety.night_wandering,
      doorExitAttempt: log.safety.door_exit_attempt,
      fall: log.safety.fall,
      wandering: log.safety.wandering,
      acuteDanger: log.safety.acute_danger,
      note: log.safety.note
    },
    caregiver: {
      quote: log.caregiver.quote,
      stressSignal:
        log.caregiver.stress_level === "medium" ||
        log.caregiver.stress_level === "high" ||
        log.caregiver.stress_level === "crisis"
    }
  };
}

export function mapAttentionItem(item: AttentionItemV2): AttentionItem {
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    evidence: item.evidence,
    doctorFeedbackHint: item.doctor_feedback_hint,
    createdAt: new Date().toISOString(),
    actions: item.actions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      blockedReason: action.blocked_reason ?? undefined,
      alternativeLabel: action.alternative_label ?? undefined
    }))
  };
}

export function toAttentionItemV2(item: AttentionItem): AttentionItemV2 {
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    evidence: item.evidence,
    doctor_feedback_hint: item.doctorFeedbackHint,
    actions: item.actions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      blocked_reason: action.blockedReason ?? null,
      alternative_label: action.alternativeLabel ?? null
    }))
  };
}

export function mapMemoryCandidate(item: MemoryCandidateV2, patientId: string): MemoryItem {
  const now = new Date().toISOString();

  return {
    id: item.id,
    patientId,
    type: item.type,
    status: "candidate",
    title: item.title,
    description: item.description,
    evidence: item.evidence,
    sourceEventIds: [],
    createdAt: now,
    updatedAt: now,
    requiresConfirmation: item.requires_confirmation
  };
}

export function mapScriptAdvice(script: CommunicationScriptV2) {
  return {
    notRecommended: script.not_recommended,
    recommended: script.recommended,
    principle: script.principle
  };
}
