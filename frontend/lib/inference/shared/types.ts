// Public types shared between cloud and local inference adapters and
// re-exported by lib/care-workflow-api.ts so existing call sites keep their
// import paths unchanged.

import type {
  AttentionItem,
  FollowupDocumentRecord,
  MemoryItem,
  StructuredLog
} from "../../../types/caremind";
import type {
  CareWorkflowResponse,
  FollowupRange,
  StructuredLogV2
} from "../../../types/care-workflow";
import type { InferenceProvenance } from "./provenance";

export type {
  CareMindIntent,
  CareMindPlatform,
  LocalFirstPrivacyConfig,
  MobileModelAvailability,
  ModelProfile,
  ModelRoutingPolicy,
  RouteIntentInput,
  RoutingDecision,
  RoutingPrivacyMode,
  RoutingRuntimePlatform,
  RuntimeInitializationState,
  RuntimeInitializationStatus
} from "./model-routing";

export interface CareWorkflowAppResult {
  response: CareWorkflowResponse;
  structuredLog: StructuredLog | null;
  attentionItems: AttentionItem[];
  memoryItems: MemoryItem[];
  scriptAdvice: {
    notRecommended: string;
    recommended: string;
    principle: string;
    recordSuggestion?: string;
  } | null;
  inferenceProvenance?: InferenceProvenance;
}

export interface FollowupSummaryInput {
  patientId: string;
  caregiverId: string;
  dateRange: FollowupRange;
  recordCount: number;
  attentionItems: AttentionItem[];
  memoryItems: MemoryItem[];
  followupDocuments?: FollowupDocumentRecord[];
  careLogs?: StructuredLogV2[];
  dailyMetrics?: Record<string, unknown>[];
  caregiverDailyMetricsTrend?: Record<string, unknown>;
  documentImages?: Record<string, unknown>[];
  includeEnglishKeyPhrases?: boolean;
  cloudSummaryAllowed?: boolean;
  rawTextUploadAllowed?: boolean;
  fullWindowRequired?: boolean;
  timezone?: string;
}

export interface TranscribeAudioNoteInput {
  patientId: string;
  language?: string;
  asset: {
    uri: string;
    name: string;
    mimeType?: string | null;
  };
}

export interface AudioTranscriptionResponse {
  request_id: string;
  transcript: string;
  model: string;
  language: string | null;
  // "openai_compatible" — cloud STT, "on_device_gemma" — local Gemma multimodal.
  provider: "openai_compatible" | "on_device_gemma";
  medical_boundary: string;
}
