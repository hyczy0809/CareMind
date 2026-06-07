import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ActionStatus,
  AnalyticsEvent,
  AnalyticsEventName,
  CaregiverCheckinRecord,
  AttentionItem,
  CareLogRecord,
  CaregiverCheckin,
  CompanionActivityFeedback,
  CompanionActivityRecord,
  FollowupDocumentRecord,
  FollowupMetric,
  MemoryItem,
  StructuredLog
} from "../types/caremind";
import {
  buildAttentionItems,
  buildMemoryCandidate,
  buildStructuredLog
} from "./inference/local/fallback-builders";

const STORAGE_KEY = "caremind:v2:state";

interface PatientState {
  id: string;
  nickname: string;
  updatedAt: string;
  doctorNote?: string;
}

interface PersistedCareMindState {
  version: 2;
  onboardingCompleted?: boolean;
  patient: PatientState;
  recordCount: number;
  attentionItems: AttentionItem[];
  careLogs?: CareLogRecord[];
  analyticsEvents?: AnalyticsEvent[];
  memoryItems: MemoryItem[];
  caregiverCheckins: CaregiverCheckinRecord[];
  companionActivityRecords?: CompanionActivityRecord[];
  followupDocuments?: FollowupDocumentRecord[];
  lastStructuredLog: StructuredLog | null;
  lastRawNote: string | null;
}

interface CareMindContextValue {
  hydrated: boolean;
  onboardingCompleted: boolean;
  patient: PatientState;
  recordCount: number;
  attentionItems: AttentionItem[];
  careLogs: CareLogRecord[];
  analyticsEvents: AnalyticsEvent[];
  memoryItems: MemoryItem[];
  caregiverCheckins: CaregiverCheckinRecord[];
  companionActivityRecords: CompanionActivityRecord[];
  followupDocuments: FollowupDocumentRecord[];
  lastStructuredLog: StructuredLog | null;
  lastRawNote: string | null;
  followupMetrics: FollowupMetric[];
  completeOnboarding: (input: { nickname: string; doctorNote?: string; concern?: string }) => void;
  previewStructuredLog: (note: string) => StructuredLog;
  previewMemoryCandidate: (note: string) => MemoryItem | null;
  saveLog: (note: string, structuredOverride?: StructuredLog, options?: SaveLogOptions) => void;
  saveCaregiverCheckin: (checkin: CaregiverCheckin) => void;
  saveCompanionActivityFeedback: (feedback: CompanionActivityFeedback) => void;
  updateFollowupDocuments: (updater: (current: FollowupDocumentRecord[]) => FollowupDocumentRecord[]) => void;
  updateActionStatus: (itemId: string, actionId: string, status: ActionStatus, reason?: string) => void;
  confirmMemory: (memoryId: string) => void;
  dismissMemory: (memoryId: string) => void;
  trackEvent: (name: AnalyticsEventName, properties?: AnalyticsEvent["properties"]) => void;
  loadDemoData: () => void;
}

interface SaveLogOptions {
  attentionItems?: AttentionItem[];
  memoryItems?: MemoryItem[];
  occurredAt?: string;
}

const CareMindContext = createContext<CareMindContextValue | null>(null);

const defaultPatient: PatientState = {
  id: "local_patient",
  nickname: "患者",
  updatedAt: "尚未记录"
};

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function buildActivityMemoryCopy(feedback: CompanionActivityFeedback) {
  if (feedback.activityType === "object_matching") {
    return {
      title: "物品配对可能适合作为短时陪伴",
      description: "刚才的配对活动中，患者愿意参与且情绪更平静。确认后，之后可在状态平稳、需要短时间陪伴时优先尝试。"
    };
  }

  if (feedback.activityType === "familiar_sorting") {
    return {
      title: "熟悉物品分类可能有参与感",
      description: "刚才的分类活动中，患者愿意参与且情绪更平静。确认后，之后可在整理旧物或需要轻量参与时优先尝试。"
    };
  }

  return {
    title: "老照片回忆可能有帮助",
    description: "刚才的陪伴活动中，患者愿意参与且情绪更平静。确认后，之后可在焦虑或想回家表达时优先尝试。"
  };
}

function buildDemoLog(note: string, dayOffset: number, logId: string): CareLogRecord {
  const createdAt = daysAgo(dayOffset);
  const structuredLog = buildStructuredLog(note);
  const attentionItems = buildAttentionItems(note).map((item, index) => ({
    ...item,
    id: `${logId}_${item.type}_${index}`,
    createdAt,
    actions: item.actions.map((action) => ({ ...action }))
  }));

  return {
    id: logId,
    patientId: "local_patient",
    note,
    structuredLog,
    attentionItems,
    occurredAt: createdAt,
    createdAt
  };
}

function buildDemoState() {
  const todayLog = buildDemoLog(
    "妈妈昨晚起来四次，今天一直说有人偷她的钱，晚饭只吃了几口。我也快撑不住了。",
    0,
    "demo_log_today"
  );
  const twoDaysAgoLog = buildDemoLog(
    "前天半夜起来三次，还想开门出去，晚饭吃得少，我也几乎没睡。",
    2,
    "demo_log_2d"
  );
  const twelveDaysAgoLog = buildDemoLog(
    "晚上不肯吃药一次，下午一直说要回老家，劝了很久才平静。",
    12,
    "demo_log_12d"
  );
  const twentyFourDaysAgoLog = buildDemoLog(
    "一起看老照片后她平静了一些，但夜里还是起来一次。",
    24,
    "demo_log_24d"
  );

  if (todayLog.attentionItems[0]?.actions[0]) {
    todayLog.attentionItems[0].actions[0].status = "done";
  }
  if (todayLog.attentionItems[0]?.actions[1]) {
    todayLog.attentionItems[0].actions[1].status = "blocked";
    todayLog.attentionItems[0].actions[1].blockedReason = "家里没有设备";
  }

  const careLogs = [todayLog, twoDaysAgoLog, twelveDaysAgoLog, twentyFourDaysAgoLog];
  const now = new Date().toISOString();

  const memoryItems: MemoryItem[] = [
    {
      id: "demo_memory_photo",
      patientId: "local_patient",
      type: "effective_strategy",
      status: "confirmed",
      title: "看老照片可能有帮助",
      description: "看老照片后情绪更容易稳定。出现焦虑或想回家表达时，可先尝试 5-10 分钟。",
      evidence: ["24 天前记录"],
      sourceEventIds: ["demo_log_24d"],
      createdAt: daysAgo(24),
      updatedAt: now,
      requiresConfirmation: false
    },
    {
      id: "demo_memory_home",
      patientId: "local_patient",
      type: "behavior_pattern",
      status: "confirmed",
      title: "下午更容易说想回家",
      description: "下午或黄昏时段更容易出现想回家表达，建议提前安排安静陪伴活动。",
      evidence: ["12 天前记录"],
      sourceEventIds: ["demo_log_12d"],
      createdAt: daysAgo(12),
      updatedAt: now,
      requiresConfirmation: false
    }
  ];

  const caregiverCheckins: CaregiverCheckinRecord[] = [
    {
      id: "demo_checkin_today",
      createdAt: daysAgo(0),
      sleepHoursBucket: "unknown",
      moodScore: 2,
      supportToday: "partial",
      personalTime: null,
      stressLevel: "high"
    },
    {
      id: "demo_checkin_yesterday",
      createdAt: daysAgo(1),
      sleepHoursBucket: "unknown",
      moodScore: 1,
      supportToday: "no",
      personalTime: null,
      stressLevel: "crisis"
    },
    {
      id: "demo_checkin_3d",
      createdAt: daysAgo(3),
      sleepHoursBucket: "unknown",
      moodScore: 3,
      supportToday: "partial",
      personalTime: null,
      stressLevel: "medium"
    }
  ];

  const companionActivityRecords: CompanionActivityRecord[] = [
    {
      id: "demo_activity_photo",
      patientId: "local_patient",
      activityType: "photo_reminiscence",
      activityName: "老照片回忆",
      durationMinutes: 5,
      participation: "willing",
      moodAfter: "calmer",
      frustration: false,
      fatigue: false,
      stoppedEarly: false,
      createdAt: daysAgo(1)
    }
  ];

  const followupDocuments: FollowupDocumentRecord[] = [
    {
      id: "demo_document_medication",
      patientId: "local_patient",
      type: "medication_list",
      title: "用药清单",
      filename: "近期用药清单.pdf",
      mimeType: "application/pdf",
      size: 146000,
      summary: "晚饭后服药，近一周出现 2 次拒药。",
      status: "reviewed",
      documentId: "demo_document_medication",
      confirmedItems: [
        "用药清单：晚饭后服药，近一周出现 2 次拒药。",
        "该资料仅用于复诊沟通整理，影像、量表、诊断和用药结论仍需医生判断。"
      ],
      reviewedAt: daysAgo(0),
      createdAt: daysAgo(0),
      updatedAt: now
    }
  ];

  const analyticsEvents: AnalyticsEvent[] = [
    {
      id: "demo_event_loaded",
      name: "demo_data_loaded",
      createdAt: now,
      properties: {
        care_log_count: careLogs.length,
        range_ready: true
      }
    },
    {
      id: "demo_event_report",
      name: "followup_report_loaded",
      createdAt: daysAgo(0),
      properties: {
        range: "7d",
        record_count: 2,
        attention_count: careLogs.slice(0, 2).flatMap((log) => log.attentionItems).length
      }
    }
  ];

  return {
    patient: {
      id: "local_patient",
      nickname: "妈妈",
      updatedAt: "演示数据已加载",
      doctorNote: "家属记录：医生曾说明为失智症相关长期照护。"
    },
    careLogs,
    attentionItems: careLogs.slice(0, 2).flatMap((log) => log.attentionItems).slice(0, 6),
    memoryItems,
    caregiverCheckins,
    companionActivityRecords,
    followupDocuments,
    analyticsEvents
  };
}

export function CareMindProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PatientState>(defaultPatient);
  const [recordCount, setRecordCount] = useState(0);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [careLogs, setCareLogs] = useState<CareLogRecord[]>([]);
  const [analyticsEvents, setAnalyticsEvents] = useState<AnalyticsEvent[]>([]);
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);
  const [caregiverCheckins, setCaregiverCheckins] = useState<CaregiverCheckinRecord[]>([]);
  const [companionActivityRecords, setCompanionActivityRecords] = useState<CompanionActivityRecord[]>([]);
  const [followupDocuments, setFollowupDocuments] = useState<FollowupDocumentRecord[]>([]);
  const [lastStructuredLog, setLastStructuredLog] = useState<StructuredLog | null>(null);
  const [lastRawNote, setLastRawNote] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const parsed = JSON.parse(raw) as Partial<PersistedCareMindState>;
        const restoredCareLogs = normalizeCareLogs(parsed.careLogs, parsed.lastRawNote, parsed.lastStructuredLog, parsed.attentionItems, parsed.patient?.id);
        const inferredCompleted =
          restoredCareLogs.length > 0 ||
          (typeof parsed.recordCount === "number" && parsed.recordCount > 0) ||
          (!!parsed.patient?.nickname && parsed.patient.nickname !== defaultPatient.nickname);
        const nextOnboardingCompleted = parsed.onboardingCompleted ?? inferredCompleted;
        setOnboardingCompleted(Boolean(nextOnboardingCompleted));
        setPatient(parsed.patient ? { ...defaultPatient, ...parsed.patient } : defaultPatient);
        setRecordCount(typeof parsed.recordCount === "number" ? parsed.recordCount : 0);
        setAttentionItems(dedupeAttentionItems(Array.isArray(parsed.attentionItems) ? parsed.attentionItems : []));
        setCareLogs(restoredCareLogs);
        setAnalyticsEvents(Array.isArray(parsed.analyticsEvents) ? parsed.analyticsEvents.slice(0, 100) : []);
        setMemoryItems(Array.isArray(parsed.memoryItems) ? parsed.memoryItems : []);
        setCaregiverCheckins(Array.isArray(parsed.caregiverCheckins) ? parsed.caregiverCheckins : []);
        setCompanionActivityRecords(Array.isArray(parsed.companionActivityRecords) ? parsed.companionActivityRecords : []);
        setFollowupDocuments(normalizeFollowupDocuments(parsed.followupDocuments, parsed.patient?.id));
        setLastStructuredLog(normalizeStructuredLog(parsed.lastStructuredLog ?? null));
        setLastRawNote(typeof parsed.lastRawNote === "string" ? parsed.lastRawNote : null);
      } catch (error) {
        console.warn("CareMind state hydrate failed", error);
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
    }

    persistTimer.current = setTimeout(() => {
      const state: PersistedCareMindState = {
        version: 2,
        onboardingCompleted,
        patient,
        recordCount,
        attentionItems,
        careLogs,
        analyticsEvents,
        memoryItems,
        caregiverCheckins,
        companionActivityRecords,
        followupDocuments,
        lastStructuredLog,
        lastRawNote
      };

      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) => {
        console.warn("CareMind state persist failed", error);
      });
    }, 120);

    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
      }
    };
  }, [
    analyticsEvents,
    attentionItems,
    careLogs,
    caregiverCheckins,
    companionActivityRecords,
    followupDocuments,
    hydrated,
    onboardingCompleted,
    lastRawNote,
    lastStructuredLog,
    memoryItems,
    patient,
    recordCount
  ]);

  const trackEvent = useCallback((name: AnalyticsEventName, properties: AnalyticsEvent["properties"] = {}) => {
    setAnalyticsEvents((current) =>
      [
        {
          id: `event_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          name,
          createdAt: new Date().toISOString(),
          properties
        },
        ...current
      ].slice(0, 100)
    );
  }, []);

  const updateFollowupDocuments = useCallback((updater: (current: FollowupDocumentRecord[]) => FollowupDocumentRecord[]) => {
    setFollowupDocuments((current) => updater(current).map(normalizeFollowupDocument).slice(0, 30));
  }, []);

  function previewStructuredLog(note: string): StructuredLog {
    return buildStructuredLog(note);
  }

  function previewMemoryCandidate(note: string): MemoryItem | null {
    return buildMemoryCandidate(patient.id, note);
  }

  function saveLog(note: string, structuredOverride?: StructuredLog, options?: SaveLogOptions) {
    const structured = structuredOverride ?? buildStructuredLog(note);
    const generatedItems = options?.attentionItems ?? buildAttentionItems(note);
    const candidate = buildMemoryCandidate(patient.id, note);
    const createdAt = new Date().toISOString();
    const occurredAt = options?.occurredAt ?? createdAt;

    setLastStructuredLog(structured);
    setLastRawNote(note);
    setRecordCount((count) => count + 1);
    setPatient((current) => ({ ...current, updatedAt: "刚刚更新" }));
    setCareLogs((current) =>
      [
        {
          id: `care_log_${Date.now()}`,
          patientId: patient.id,
          note,
          structuredLog: structured,
          attentionItems: generatedItems,
          occurredAt,
          createdAt
        },
        ...current
      ].slice(0, 90)
    );

    if (generatedItems.length > 0) {
      setAttentionItems((current) => mergeAttentionItems(current, generatedItems));
    }

    const incomingMemoryItems = options?.memoryItems ?? (candidate ? [candidate] : []);

    if (incomingMemoryItems.length > 0) {
      setMemoryItems((current) => {
        const next = incomingMemoryItems.filter((item) => !current.some((existing) => existing.id === item.id || existing.title === item.title));
        return [...next, ...current];
      });
    }

    trackEvent("care_log_saved", {
      attention_count: generatedItems.length,
      memory_candidate_count: incomingMemoryItems.length,
      has_caregiver_signal: structured.caregiver.stressSignal,
      has_medication_signal: structured.medication.mentioned,
      occurred_at: occurredAt
    });
  }

  function completeOnboarding(input: { nickname: string; doctorNote?: string; concern?: string }) {
    const concern = input.concern?.trim();

    setPatient({
      id: "local_patient",
      nickname: input.nickname.trim() || "患者",
      updatedAt: concern ? "刚刚更新" : "尚未记录",
      doctorNote: input.doctorNote
    });
    setOnboardingCompleted(true);

    if (concern) {
      const structured = buildStructuredLog(concern);
      const generatedItems = buildAttentionItems(concern);
      const candidate = buildMemoryCandidate("local_patient", concern);
      const createdAt = new Date().toISOString();
      setLastStructuredLog(structured);
      setLastRawNote(concern);
      setRecordCount(1);
      setAttentionItems(generatedItems);
      setCareLogs([
        {
          id: `care_log_${Date.now()}`,
          patientId: "local_patient",
          note: concern,
          structuredLog: structured,
          attentionItems: generatedItems,
          occurredAt: createdAt,
          createdAt
        }
      ]);
      setMemoryItems(candidate ? [candidate] : []);
    }

    trackEvent("onboarding_completed", {
      has_initial_concern: !!concern,
      nickname_set: !!input.nickname.trim()
    });
  }

  function saveCaregiverCheckin(checkin: CaregiverCheckin) {
    setCaregiverCheckins((current) =>
      [
        {
          ...checkin,
          id: `caregiver_checkin_${Date.now()}`,
          createdAt: new Date().toISOString()
        },
        ...current
      ].slice(0, 7)
    );
    trackEvent("caregiver_checkin_saved", {
      stress_level: checkin.stressLevel,
      support_today: checkin.supportToday
    });
  }

  function saveCompanionActivityFeedback(feedback: CompanionActivityFeedback) {
    const now = new Date().toISOString();
    const record: CompanionActivityRecord = {
      ...feedback,
      id: `companion_activity_${Date.now()}`,
      patientId: patient.id,
      createdAt: now
    };
    const positiveFeedback = feedback.participation === "willing" && feedback.moodAfter === "calmer" && !feedback.frustration && !feedback.fatigue;

    setCompanionActivityRecords((current) => [record, ...current].slice(0, 30));

    if (positiveFeedback) {
      const copy = buildActivityMemoryCopy(feedback);
      const candidate: MemoryItem = {
        id: `memory_activity_photo_${Date.now()}`,
        patientId: patient.id,
        type: "effective_strategy",
        status: "candidate",
        title: copy.title,
        description: copy.description,
        evidence: ["今日陪伴活动反馈"],
        sourceEventIds: [record.id],
        createdAt: now,
        updatedAt: now,
        requiresConfirmation: true
      };

      setMemoryItems((current) => {
        const exists = current.some((item) => item.title === candidate.title);
        return exists ? current : [candidate, ...current];
      });

      trackEvent("activity_memory_candidate_created", {
        activity_type: feedback.activityType,
        mood_after: feedback.moodAfter
      });
    }

    trackEvent("activity_feedback_saved", {
      activity_type: feedback.activityType,
      duration_minutes: feedback.durationMinutes,
      participation: feedback.participation,
      mood_after: feedback.moodAfter,
      frustration: feedback.frustration,
      fatigue: feedback.fatigue,
      stopped_early: feedback.stoppedEarly
    });
  }

  function updateActionStatus(itemId: string, actionId: string, status: ActionStatus, reason?: string) {
    setAttentionItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              actions: item.actions.map((action) =>
                action.id === actionId ? { ...action, status, blockedReason: reason } : action
              )
            }
          : item
      )
    );
    setCareLogs((current) =>
      current.map((log) => ({
        ...log,
        attentionItems: log.attentionItems.map((item) =>
          item.id === itemId
            ? {
                ...item,
                actions: item.actions.map((action) =>
                  action.id === actionId ? { ...action, status, blockedReason: reason } : action
                )
              }
            : item
        )
      }))
    );
    trackEvent("action_status_changed", {
      item_id: itemId,
      action_id: actionId,
      status,
      blocked_reason: reason ?? null
    });
  }

  function confirmMemory(memoryId: string) {
    setMemoryItems((current) =>
      current.map((item) => (item.id === memoryId ? { ...item, status: "confirmed", requiresConfirmation: false } : item))
    );
    trackEvent("memory_confirmed", { memory_id: memoryId });
  }

  function dismissMemory(memoryId: string) {
    setMemoryItems((current) =>
      current.map((item) => (item.id === memoryId ? { ...item, status: "dismissed" } : item))
    );
    trackEvent("memory_dismissed", { memory_id: memoryId });
  }

  function loadDemoData() {
    const demo = buildDemoState();

    setOnboardingCompleted(true);
    setPatient(demo.patient);
    setRecordCount(demo.careLogs.length);
    setAttentionItems(dedupeAttentionItems(demo.attentionItems));
    setCareLogs(demo.careLogs);
    setMemoryItems(demo.memoryItems);
    setCaregiverCheckins(demo.caregiverCheckins);
    setCompanionActivityRecords(demo.companionActivityRecords);
    setFollowupDocuments(demo.followupDocuments);
    setLastStructuredLog(demo.careLogs[0]?.structuredLog ?? null);
    setLastRawNote(demo.careLogs[0]?.note ?? null);
    setAnalyticsEvents(demo.analyticsEvents);
  }

  const followupMetrics = useMemo(() => buildFollowupMetrics(recordCount, attentionItems, memoryItems), [recordCount, attentionItems, memoryItems]);

  const value: CareMindContextValue = {
    hydrated,
    onboardingCompleted,
    patient,
    recordCount,
    attentionItems,
    careLogs,
    analyticsEvents,
    memoryItems,
    caregiverCheckins,
    companionActivityRecords,
    followupDocuments,
    lastStructuredLog,
    lastRawNote,
    followupMetrics,
    completeOnboarding,
    previewStructuredLog,
    previewMemoryCandidate,
    saveLog,
    saveCaregiverCheckin,
    saveCompanionActivityFeedback,
    updateFollowupDocuments,
    updateActionStatus,
    confirmMemory,
    dismissMemory,
    trackEvent,
    loadDemoData
  };

  return <CareMindContext.Provider value={value}>{children}</CareMindContext.Provider>;
}

export function useCareMind() {
  const context = useContext(CareMindContext);
  if (!context) {
    throw new Error("useCareMind must be used inside CareMindProvider");
  }
  return context;
}

function buildFollowupMetrics(recordCount: number, items: AttentionItem[], memories: MemoryItem[]): FollowupMetric[] {
  if (recordCount === 0) return [];

  const nightCount = items.filter((item) => item.type === "night_safety").length;
  const medicationCount = items.filter((item) => item.type === "medication").length;
  const caregiverCount = items.filter((item) => item.type === "caregiver").length;
  const rememberedCount = memories.filter((item) => item.status === "confirmed").length;

  return [
    { label: "照护记录", value: `${recordCount}`, helper: "已保存", tone: "brand" },
    { label: "夜间安全", value: `${nightCount}`, helper: "关注事项", tone: nightCount > 0 ? "alert" : "info" },
    { label: "服药记录", value: `${medicationCount}`, helper: "待复诊沟通", tone: "watch" },
    { label: "已记住方法", value: `${rememberedCount}`, helper: caregiverCount > 0 ? "含照护者压力" : "个性化支持", tone: "info" }
  ];
}

function mergeAttentionItems(current: AttentionItem[], incoming: AttentionItem[]) {
  return dedupeAttentionItems([...incoming, ...current]).slice(0, 6);
}

function dedupeAttentionItems(items: AttentionItem[]) {
  const priority = {
    crisis: 4,
    high: 3,
    medium: 2,
    low: 1
  };
  const byType = new Map<AttentionItem["type"], AttentionItem>();

  for (const item of items) {
    const existing = byType.get(item.type);
    if (!existing) {
      byType.set(item.type, item);
      continue;
    }

    const itemPriority = priority[item.severity];
    const existingPriority = priority[existing.severity];
    const itemTime = new Date(item.createdAt).getTime();
    const existingTime = new Date(existing.createdAt).getTime();

    if (itemPriority > existingPriority || (itemPriority === existingPriority && itemTime > existingTime)) {
      byType.set(item.type, item);
    }
  }

  return Array.from(byType.values()).sort((a, b) => {
    const priorityDiff = priority[b.severity] - priority[a.severity];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function normalizeCareLogs(
  logs: CareLogRecord[] | undefined,
  lastRawNote?: string | null,
  lastStructuredLog?: StructuredLog | null,
  attentionItems?: AttentionItem[],
  patientId = "local_patient"
): CareLogRecord[] {
  if (Array.isArray(logs)) {
    return logs
      .map((log) => ({
        ...log,
        patientId: log.patientId ?? patientId,
        note: log.note ?? "",
        structuredLog: normalizeStructuredLog(log.structuredLog) ?? buildStructuredLog(log.note ?? ""),
        attentionItems: Array.isArray(log.attentionItems) ? log.attentionItems : [],
        occurredAt: log.occurredAt ?? log.createdAt ?? new Date().toISOString(),
        createdAt: log.createdAt ?? new Date().toISOString()
      }))
      .filter((log) => log.note || log.attentionItems.length > 0)
      .slice(0, 90);
  }

  const normalizedLastLog = normalizeStructuredLog(lastStructuredLog ?? null);
  if (!lastRawNote || !normalizedLastLog) {
    return [];
  }

  return [
    {
      id: "care_log_legacy_last",
      patientId,
      note: lastRawNote,
      structuredLog: normalizedLastLog,
      attentionItems: Array.isArray(attentionItems) ? attentionItems : [],
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }
  ];
}

function normalizeFollowupDocuments(documents: FollowupDocumentRecord[] | undefined, patientId = "local_patient"): FollowupDocumentRecord[] {
  if (!Array.isArray(documents)) {
    return [];
  }

  return documents.map((document) => normalizeFollowupDocument({ ...document, patientId: document.patientId ?? patientId })).slice(0, 30);
}

function normalizeFollowupDocument(document: FollowupDocumentRecord): FollowupDocumentRecord {
  const now = new Date().toISOString();
  return {
    ...document,
    patientId: document.patientId ?? "local_patient",
    title: document.title || "复诊资料",
    summary: document.summary ?? "",
    status: document.status ?? "reviewed",
    confirmedItems: Array.isArray(document.confirmedItems) ? document.confirmedItems : undefined,
    createdAt: document.createdAt ?? now,
    updatedAt: now
  };
}

function normalizeStructuredLog(log: StructuredLog | null): StructuredLog | null {
  if (!log) return null;

  return {
    sleep: {
      nightWakings: log.sleep?.nightWakings ?? null,
      note: log.sleep?.note ?? "未提到夜间起床次数"
    },
    behavior: Array.isArray(log.behavior) ? log.behavior : [],
    nutrition: {
      mealIntake: log.nutrition?.mealIntake ?? "unknown",
      waterIntake: log.nutrition?.waterIntake ?? "unknown",
      choking: log.nutrition?.choking ?? "unknown",
      weightChange: log.nutrition?.weightChange ?? "unknown",
      note: log.nutrition?.note ?? "未提到饮食变化"
    },
    medication: {
      mentioned: log.medication?.mentioned ?? false,
      refusalCount: log.medication?.refusalCount ?? null,
      missedDose: log.medication?.missedDose ?? "unknown",
      duplicateDose: log.medication?.duplicateDose ?? "unknown",
      medicationNames: log.medication?.medicationNames ?? [],
      note: log.medication?.note ?? "未提到服药变化"
    },
    safety: {
      nightWandering: log.safety?.nightWandering ?? "unknown",
      doorExitAttempt: log.safety?.doorExitAttempt ?? "unknown",
      fall: log.safety?.fall ?? "unknown",
      wandering: log.safety?.wandering ?? "unknown",
      acuteDanger: log.safety?.acuteDanger ?? false,
      note: log.safety?.note ?? "未提到安全事件"
    },
    caregiver: {
      quote: log.caregiver?.quote ?? "",
      stressSignal: log.caregiver?.stressSignal ?? false
    }
  };
}
