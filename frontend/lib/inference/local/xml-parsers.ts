// XML-output parsers for the three on-device LLM tasks.
//
// Mirrors what parseJsonObject(...) does for the JSON path — converts raw
// model text into the loosely-typed `Local…Xml` shapes declared in
// prompts-xml.ts. The downstream "normaliseStructuredLog" / similar
// functions are shared between JSON and XML paths and don't care about the
// underlying syntax.

import {
  pickTag,
  pickAttr,
  pickAllTags,
  readTagAttr,
  pickItemList,
  coerceNumberOrNull,
  coerceUnknownBoolean,
  coerceBoolean
} from "./xml-extract";
import type {
  LocalCareWorkflowXml,
  LocalFollowupXml
} from "./prompts-xml";

// ---------------------------------------------------------------------------
// Care workflow
// ---------------------------------------------------------------------------

/**
 * Parse the XML output of the care-workflow prompt. Tolerant of:
 *  - any tag being missing entirely
 *  - extra prose before / after the tag block
 *  - the model omitting close tags at end-of-output (xml-extract handles)
 *  - <evidence_items> vs <evidence> vs comma-separated string in <evidence>
 *
 * Returns `null` only when the response contains zero recognizable tags —
 * callers can then fall back to the deterministic builder.
 */
export function parseCareWorkflowXml(text: string): LocalCareWorkflowXml | null {
  if (!text || !text.trim()) return null;

  const sleepInner = pickTag(text, "sleep");
  const nutritionInner = pickTag(text, "nutrition");
  const medicationInner = pickTag(text, "medication");
  const safetyInner = pickTag(text, "safety");
  const caregiverInner = pickTag(text, "caregiver");
  const guardrailInner = pickTag(text, "guardrail");
  const guardrailAttrs = (() => {
    const matches = pickAllTags(text, "guardrail");
    return matches.length > 0 ? matches[0] : null;
  })();

  const structuredLog: LocalCareWorkflowXml["structuredLog"] = {};
  let touched = false;

  if (sleepInner !== null) {
    structuredLog.sleep = {
      nightWakings: coerceNumberOrNull(pickTag(sleepInner, "night_wakings")),
      note: pickTag(sleepInner, "note") ?? undefined
    };
    touched = true;
  }

  // Behavior — either <behavior><item>...</item></behavior> at top level or
  // direct <behavior_item> sibling tags. Accept both.
  const behaviorBlock = pickTag(text, "behavior");
  const behaviorItems: Array<{ label?: string; evidence?: string; frequency?: string }> = [];
  if (behaviorBlock !== null) {
    for (const m of pickAllTags(behaviorBlock, "item")) {
      behaviorItems.push({
        label: pickTag(m.inner, "label") ?? undefined,
        evidence: pickTag(m.inner, "evidence") ?? undefined,
        frequency: pickTag(m.inner, "frequency") ?? undefined
      });
    }
  }
  for (const m of pickAllTags(text, "behavior_item")) {
    behaviorItems.push({
      label: pickTag(m.inner, "label") ?? undefined,
      evidence: pickTag(m.inner, "evidence") ?? undefined,
      frequency: pickTag(m.inner, "frequency") ?? undefined
    });
  }
  if (behaviorItems.length > 0) {
    structuredLog.behavior = behaviorItems;
    touched = true;
  }

  if (nutritionInner !== null) {
    structuredLog.nutrition = {
      mealIntake: pickTag(nutritionInner, "meal_intake") ?? undefined,
      waterIntake: pickTag(nutritionInner, "water_intake") ?? undefined,
      choking: coerceUnknownBoolean(pickTag(nutritionInner, "choking")),
      weightChange: pickTag(nutritionInner, "weight_change") ?? undefined,
      note: pickTag(nutritionInner, "note") ?? undefined
    };
    touched = true;
  }

  if (medicationInner !== null) {
    const medsInner = pickTag(medicationInner, "medication_names") ?? "";
    structuredLog.medication = {
      mentioned: coerceBoolean(pickTag(medicationInner, "mentioned"), false),
      refusalCount: coerceNumberOrNull(pickTag(medicationInner, "refusal_count")),
      missedDose: coerceUnknownBoolean(pickTag(medicationInner, "missed_dose")),
      duplicateDose: coerceUnknownBoolean(pickTag(medicationInner, "duplicate_dose")),
      medicationNames: pickItemList(medsInner),
      note: pickTag(medicationInner, "note") ?? undefined
    };
    touched = true;
  }

  if (safetyInner !== null) {
    structuredLog.safety = {
      nightWandering: coerceUnknownBoolean(pickTag(safetyInner, "night_wandering")),
      doorExitAttempt: coerceUnknownBoolean(pickTag(safetyInner, "door_exit_attempt")),
      fall: coerceUnknownBoolean(pickTag(safetyInner, "fall")),
      wandering: coerceUnknownBoolean(pickTag(safetyInner, "wandering")),
      acuteDanger: coerceBoolean(pickTag(safetyInner, "acute_danger"), false),
      note: pickTag(safetyInner, "note") ?? undefined
    };
    touched = true;
  }

  if (caregiverInner !== null) {
    structuredLog.caregiver = {
      quote: pickTag(caregiverInner, "quote") ?? undefined,
      stressLevel: pickTag(caregiverInner, "stress_level") ?? undefined
    };
    touched = true;
  }

  // Attention items — `<attention_item type="..." severity="...">...</attention_item>`
  // emitted as siblings at the top level.
  const attentionItems: LocalCareWorkflowXml["attentionItems"] = [];
  for (const m of pickAllTags(text, "attention_item")) {
    const actionsInner = pickTag(m.inner, "actions") ?? "";
    const actions: Array<{ label?: string; alternativeLabel?: string }> = [];
    for (const a of pickAllTags(actionsInner, "action")) {
      actions.push({
        label: pickTag(a.inner, "label") ?? undefined,
        alternativeLabel: pickTag(a.inner, "alternative_label") ?? undefined
      });
    }
    attentionItems.push({
      type: readTagAttr(m, "type") ?? undefined,
      severity: readTagAttr(m, "severity") ?? undefined,
      title: pickTag(m.inner, "title") ?? undefined,
      evidence: pickTag(m.inner, "evidence") ?? undefined,
      doctorFeedbackHint: pickTag(m.inner, "doctor_feedback_hint") ?? undefined,
      actions
    });
    touched = true;
  }

  // Memory candidates — `<memory_item type="..." requires_confirmation="true">`
  const memoryCandidates: LocalCareWorkflowXml["memoryCandidates"] = [];
  for (const m of pickAllTags(text, "memory_item")) {
    const evidenceInner = pickTag(m.inner, "evidence_items") ?? pickTag(m.inner, "evidence") ?? "";
    memoryCandidates.push({
      type: readTagAttr(m, "type") ?? undefined,
      title: pickTag(m.inner, "title") ?? undefined,
      description: pickTag(m.inner, "description") ?? undefined,
      evidence: pickItemList(evidenceInner),
      requiresConfirmation: coerceBoolean(readTagAttr(m, "requires_confirmation"), true)
    });
    touched = true;
  }

  // Communication script
  const scriptInner = pickTag(text, "communication_script");
  let communicationScript: LocalCareWorkflowXml["communicationScript"] = null;
  if (scriptInner) {
    communicationScript = {
      notRecommended: pickTag(scriptInner, "not_recommended") ?? undefined,
      recommended: pickTag(scriptInner, "recommended") ?? undefined,
      principle: pickTag(scriptInner, "principle") ?? undefined
    };
    touched = true;
  }

  // Guardrail
  let guardrail: LocalCareWorkflowXml["guardrail"] | undefined;
  if (guardrailAttrs || guardrailInner !== null) {
    guardrail = {
      triggered: coerceBoolean(
        guardrailAttrs ? readTagAttr(guardrailAttrs, "triggered") : null,
        false
      ),
      type: guardrailAttrs ? readTagAttr(guardrailAttrs, "type") ?? undefined : undefined,
      message: guardrailInner ? pickTag(guardrailInner, "message") : null
    };
    touched = true;
  }

  if (!touched) return null;

  return {
    structuredLog: Object.keys(structuredLog).length > 0 ? structuredLog : undefined,
    attentionItems: attentionItems.length > 0 ? attentionItems : undefined,
    memoryCandidates: memoryCandidates.length > 0 ? memoryCandidates : undefined,
    communicationScript,
    guardrail
  };
}

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

export interface LocalGuardrailXmlResult {
  triggered: boolean;
  type: string;
  message: string | null;
  alternativeCta: { label: string; action: string } | null;
}

/** Parse the XML output of the standalone guardrail prompt. */
export function parseGuardrailXml(text: string): LocalGuardrailXmlResult | null {
  if (!text || !text.trim()) return null;
  const matches = pickAllTags(text, "guardrail");
  if (matches.length === 0) return null;
  const m = matches[0];

  const ctaInner = pickTag(m.inner, "alternative_cta");
  const alternativeCta = ctaInner
    ? {
        label: pickTag(ctaInner, "label") ?? "",
        action: pickTag(ctaInner, "action") ?? ""
      }
    : null;

  return {
    triggered: coerceBoolean(readTagAttr(m, "triggered"), false),
    type: readTagAttr(m, "type") ?? "none",
    message: pickTag(m.inner, "message"),
    alternativeCta:
      alternativeCta && (alternativeCta.label || alternativeCta.action)
        ? alternativeCta
        : null
  };
}

// ---------------------------------------------------------------------------
// Follow-up summary
// ---------------------------------------------------------------------------

/** Parse the XML output of the follow-up summary prompt. */
export function parseFollowupXml(text: string): LocalFollowupXml | null {
  if (!text || !text.trim()) return null;

  const followupInner = pickTag(text, "followup") ?? text;

  // Metrics
  const metricsInner = pickTag(followupInner, "metrics") ?? "";
  const metrics: NonNullable<LocalFollowupXml["metrics"]> = [];
  for (const m of pickAllTags(metricsInner, "item")) {
    metrics.push({
      label: pickTag(m.inner, "label") ?? undefined,
      value: pickTag(m.inner, "value") ?? undefined,
      helper: pickTag(m.inner, "helper") ?? undefined,
      tone: pickTag(m.inner, "tone") ?? undefined
    });
  }

  // Patch
  const patchInner = pickTag(followupInner, "followup_patch") ?? "";
  const patch: NonNullable<LocalFollowupXml["followupPatch"]> = {
    summaryBullets: pickItemList(pickTag(patchInner, "summary_bullets") ?? ""),
    doctorQuestions: pickItemList(pickTag(patchInner, "doctor_questions") ?? ""),
    materialsToBring: pickItemList(pickTag(patchInner, "materials_to_bring") ?? "")
  };

  const triedStrategies = pickItemList(pickTag(followupInner, "tried_strategies") ?? "");
  const boundaryNotice = pickTag(followupInner, "boundary_notice") ?? undefined;

  const empty =
    metrics.length === 0 &&
    !patch.summaryBullets?.length &&
    !patch.doctorQuestions?.length &&
    !patch.materialsToBring?.length &&
    triedStrategies.length === 0 &&
    !boundaryNotice;

  if (empty) return null;

  return {
    metrics: metrics.length > 0 ? metrics : undefined,
    followupPatch:
      patch.summaryBullets?.length || patch.doctorQuestions?.length || patch.materialsToBring?.length
        ? patch
        : undefined,
    triedStrategies: triedStrategies.length > 0 ? triedStrategies : undefined,
    boundaryNotice
  };
}

// Re-export the pickAttr helper for call sites that want to peek at root-level
// attributes (e.g. `<guardrail triggered="true"/>`) without re-importing
// xml-extract directly.
export { pickAttr };
