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

const STORAGE_KEY = "caremind:v2:state";

interface PatientState {
  id: string;
  nickname: string;
  updatedAt: string;
  doctorNote?: string;
}

interface PersistedCareMindState {
  version: 2;
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
        setPatient(parsed.patient ? { ...defaultPatient, ...parsed.patient } : defaultPatient);
        setRecordCount(typeof parsed.recordCount === "number" ? parsed.recordCount : 0);
        setAttentionItems(dedupeAttentionItems(Array.isArray(parsed.attentionItems) ? parsed.attentionItems : []));
        setCareLogs(normalizeCareLogs(parsed.careLogs, parsed.lastRawNote, parsed.lastStructuredLog, parsed.attentionItems, parsed.patient?.id));
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

function buildStructuredLog(note: string): StructuredLog {
  const nightWakings = extractNightWakings(note);
  const hasMeal = /饭|吃|食欲|饮水|呛咳/.test(note);
  const hasMedication = /药|服药|拒药|漏药|补药/.test(note);
  const medicationRefusalCount = extractMedicationRefusalCount(note);
  const hasSafetySignal = /夜|半夜|起床|开门|出去|外出|走失|跌倒|摔/.test(note);
  const hasCaregiver = /撑不住|很累|崩溃|没睡|烦躁|压力/.test(note);
  const behaviorLabel = buildBehaviorLabel(note);

  return {
    sleep: {
      nightWakings,
      note: nightWakings === null ? "未提到夜间起床次数" : `记录到夜间起床 ${nightWakings} 次`
    },
    behavior: behaviorLabel
      ? [
          {
            label: behaviorLabel,
            evidence: note,
            frequency: "待确认"
          }
        ]
      : [],
    nutrition: {
      mealIntake: /拒食|不肯吃|不吃饭/.test(note)
        ? "refused"
        : /几口|很少|吃得少|摄入不足/.test(note)
          ? "few_bites"
          : hasMeal
            ? "unknown"
            : "unknown",
      waterIntake: /饮水|喝水|水/.test(note) ? "unknown" : "unknown",
      choking: /呛咳|呛到/.test(note) ? true : "unknown",
      weightChange: /瘦|体重下降|明显消瘦/.test(note) ? "loss" : "unknown",
      note: hasMeal ? "提到饮食或饮水变化，建议补充具体摄入量" : "未提到饮食变化"
    },
    medication: {
      mentioned: hasMedication,
      refusalCount: medicationRefusalCount,
      missedDose: /漏药|漏服|没吃药/.test(note) ? true : "unknown",
      duplicateDose: /重复吃药|吃了两次|多吃/.test(note) ? true : "unknown",
      medicationNames: [],
      note: hasMedication ? "提到服药、拒药或漏药相关情况，建议记录发生时间和场景" : "未提到服药变化"
    },
    safety: {
      nightWandering: nightWakings !== null || /夜|半夜|起床/.test(note) ? true : "unknown",
      doorExitAttempt: /开门|出去|外出/.test(note) ? true : "unknown",
      fall: /跌倒|摔/.test(note) ? true : "unknown",
      wandering: /走失|迷路/.test(note) ? true : "unknown",
      acuteDanger: /失踪|走失|自伤|伤人|呼吸困难|胸痛|意识/.test(note),
      note: hasSafetySignal ? "提到夜间活动、外出、走失或跌倒相关线索，建议优先关注环境安全" : "未提到安全事件"
    },
    caregiver: {
      quote: hasCaregiver ? "记录到照护者压力表达" : "",
      stressSignal: hasCaregiver
    }
  };
}

function buildAttentionItems(note: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  const nightWakings = extractNightWakings(note);
  const createdAt = new Date().toISOString();

  if (nightWakings !== null || /夜|半夜|起床|开门|出去|走失/.test(note)) {
    items.push({
      id: `night_safety_${Date.now()}`,
      type: "night_safety",
      severity: /开门|出去|走失/.test(note) || (nightWakings ?? 0) >= 3 ? "high" : "medium",
      title: "今晚留意夜间起床安全",
      evidence: nightWakings === null ? "记录中提到夜间活动或开门外出相关情况。" : `记录到夜间起床 ${nightWakings} 次。`,
      doctorFeedbackHint: "如持续出现，建议复诊时告知医生。",
      createdAt,
      actions: [
        {
          id: "hallway_light",
          label: "打开走廊夜灯",
          status: "pending",
          alternativeLabel: "如果今晚不能开灯，先清理床边到卫生间这条路，减少绊倒风险。"
        },
        {
          id: "door_check",
          label: "睡前确认门锁和门铃提醒",
          status: "pending",
          alternativeLabel: "如果没有门铃提醒，先把钥匙放到家属能管理的位置，并睡前确认门已关好。"
        },
        {
          id: "floor_clear",
          label: "移开床边和门口障碍物",
          status: "pending",
          alternativeLabel: "如果来不及整理全屋，先整理床边、门口和去卫生间的动线。"
        }
      ]
    });
  }

  if (/饭|吃|食欲|饮水|呛咳/.test(note)) {
    items.push({
      id: `nutrition_${Date.now()}`,
      type: "nutrition",
      severity: "medium",
      title: "今天关注饮食和饮水",
      evidence: "记录中提到进食、饮水或呛咳相关变化。",
      doctorFeedbackHint: "若连续少食、呛咳或明显消瘦，建议咨询医生或营养师。",
      createdAt,
      actions: [
        {
          id: "meal_record",
          label: "记录今天大概吃了多少",
          status: "pending",
          alternativeLabel: "如果没法精确记录，先拍一张餐盘照片，或只记“大概几口/半碗/一碗”。"
        },
        {
          id: "water_record",
          label: "记录今天饮水情况",
          status: "pending",
          alternativeLabel: "如果没法量杯记录，先用固定杯子估算今天喝了几杯。"
        }
      ]
    });
  }

  if (/药|服药|拒药|漏药/.test(note)) {
    items.push({
      id: `medication_${Date.now()}`,
      type: "medication",
      severity: "medium",
      title: "记录服药相关变化",
      evidence: "记录中提到服药、拒药或漏药情况。",
      doctorFeedbackHint: "不建议自行补药或调整剂量，可在复诊时带上记录。",
      createdAt,
      actions: [
        {
          id: "medication_time",
          label: "记录发生时间和场景",
          status: "pending",
          alternativeLabel: "如果当下记不完整，先记下大概时间和场景，复诊前再补充细节。"
        },
        {
          id: "doctor_question",
          label: "加入复诊问题清单",
          status: "pending",
          alternativeLabel: "如果今天没空整理，先把问题保存在复诊准备页，复诊前再统一查看。"
        }
      ]
    });
  }

  if (/撑不住|很累|崩溃|没睡|烦躁|压力/.test(note)) {
    items.push({
      id: `caregiver_${Date.now()}`,
      type: "caregiver",
      severity: "high",
      title: "今天也要照顾你自己",
      evidence: "记录中出现照护者疲惫或压力表达。",
      doctorFeedbackHint: "如果长期睡眠不足，也建议复诊或社区咨询时反馈家庭照护压力。",
      createdAt,
      actions: [
        {
          id: "lower_goal",
          label: "今晚只保留安全和基本照护目标",
          status: "pending",
          alternativeLabel: "如果目标还是太多，今晚只保留一个底线：夜间安全和你的基本休息。"
        },
        {
          id: "ask_support",
          label: "联系一位家人轮替一小段时间",
          status: "pending",
          alternativeLabel: "如果没人能马上接手，先给一位家人发消息，约定一个明确的可帮忙时段。"
        }
      ]
    });
  }

  return items;
}

function buildMemoryCandidate(patientId: string, note: string): MemoryItem | null {
  const now = new Date().toISOString();

  if (/照片/.test(note) && /好|缓|有效|平静|稳定/.test(note)) {
    return {
      id: `memory_photo_${Date.now()}`,
      patientId,
      type: "effective_strategy",
      status: "candidate",
      title: "看老照片可能有帮助",
      description: "你提到看老照片后状态似乎有所缓和。确认后，下次出现类似情况时会优先提醒。",
      evidence: ["刚才这条记录"],
      sourceEventIds: [],
      createdAt: now,
      updatedAt: now,
      requiresConfirmation: true
    };
  }

  if (/要回家|回老家/.test(note)) {
    return {
      id: `memory_home_${Date.now()}`,
      patientId,
      type: "behavior_pattern",
      status: "candidate",
      title: "出现“想回家”表达",
      description: "这可能是一个值得继续观察的照护模式。确认后，之后会提醒你记录出现时间和有效安抚方式。",
      evidence: ["刚才这条记录"],
      sourceEventIds: [],
      createdAt: now,
      updatedAt: now,
      requiresConfirmation: true
    };
  }

  return null;
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

function extractNightWakings(note: string): number | null {
  const direct = note.match(/(\d+)\s*次/);
  if (direct?.[1]) return Number(direct[1]);
  if (/一次/.test(note)) return 1;
  if (/两次|二次/.test(note)) return 2;
  if (/三次/.test(note)) return 3;
  if (/四次/.test(note)) return 4;
  if (/五次/.test(note)) return 5;
  return null;
}

function extractMedicationRefusalCount(note: string): number | null {
  const refusalPattern = /拒药|不肯吃药|不吃药|没吃药|漏服|漏药/;
  if (!refusalPattern.test(note)) return null;

  const countPattern = "(\\d+|一|两|二|三|四|五|六|七|八|九|十)";
  const after = note.match(new RegExp(`(?:拒药|不肯吃药|不吃药|没吃药|漏服|漏药).{0,8}?${countPattern}\\s*次`));
  const before = note.match(new RegExp(`${countPattern}\\s*次.{0,8}?(?:拒药|不肯吃药|不吃药|没吃药|漏服|漏药)`));
  const token = after?.[1] ?? before?.[1];

  if (!token) return 1;
  return numberFromToken(token) ?? 1;
}

function numberFromToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const chineseNumbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  return chineseNumbers[token] ?? null;
}

function buildBehaviorLabel(note: string) {
  if (/偷|钱|丢/.test(note)) return "担心物品或钱被拿走";
  if (/要回家|回老家/.test(note)) return "反复表达想回家";
  if (/不认识|不是/.test(note)) return "出现身份或关系混淆表达";
  if (/烦躁|激动|吵/.test(note)) return "出现烦躁或激动表达";
  return null;
}
