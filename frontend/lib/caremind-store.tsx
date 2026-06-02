import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ActionStatus,
  CaregiverCheckinRecord,
  AttentionItem,
  CaregiverCheckin,
  FollowupMetric,
  MemoryItem,
  StructuredLog
} from "../types/caremind";

interface PatientState {
  id: string;
  nickname: string;
  updatedAt: string;
  doctorNote?: string;
}

interface CareMindContextValue {
  patient: PatientState;
  recordCount: number;
  attentionItems: AttentionItem[];
  memoryItems: MemoryItem[];
  caregiverCheckins: CaregiverCheckinRecord[];
  lastStructuredLog: StructuredLog | null;
  lastRawNote: string | null;
  followupMetrics: FollowupMetric[];
  completeOnboarding: (input: { nickname: string; doctorNote?: string; concern?: string }) => void;
  previewStructuredLog: (note: string) => StructuredLog;
  previewMemoryCandidate: (note: string) => MemoryItem | null;
  saveLog: (note: string, structuredOverride?: StructuredLog) => void;
  saveCaregiverCheckin: (checkin: CaregiverCheckin) => void;
  updateActionStatus: (itemId: string, actionId: string, status: ActionStatus, reason?: string) => void;
  confirmMemory: (memoryId: string) => void;
  dismissMemory: (memoryId: string) => void;
}

const CareMindContext = createContext<CareMindContextValue | null>(null);

const defaultPatient: PatientState = {
  id: "local_patient",
  nickname: "患者",
  updatedAt: "尚未记录"
};

export function CareMindProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PatientState>(defaultPatient);
  const [recordCount, setRecordCount] = useState(0);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);
  const [caregiverCheckins, setCaregiverCheckins] = useState<CaregiverCheckinRecord[]>([]);
  const [lastStructuredLog, setLastStructuredLog] = useState<StructuredLog | null>(null);
  const [lastRawNote, setLastRawNote] = useState<string | null>(null);

  function previewStructuredLog(note: string): StructuredLog {
    return buildStructuredLog(note);
  }

  function previewMemoryCandidate(note: string): MemoryItem | null {
    return buildMemoryCandidate(patient.id, note);
  }

  function saveLog(note: string, structuredOverride?: StructuredLog) {
    const structured = structuredOverride ?? buildStructuredLog(note);
    const generatedItems = buildAttentionItems(note);
    const candidate = buildMemoryCandidate(patient.id, note);

    setLastStructuredLog(structured);
    setLastRawNote(note);
    setRecordCount((count) => count + 1);
    setPatient((current) => ({ ...current, updatedAt: "刚刚更新" }));

    if (generatedItems.length > 0) {
      setAttentionItems((current) => mergeAttentionItems(current, generatedItems));
    }

    if (candidate) {
      setMemoryItems((current) => {
        const exists = current.some((item) => item.title === candidate.title);
        return exists ? current : [candidate, ...current];
      });
    }
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
      setLastStructuredLog(structured);
      setLastRawNote(concern);
      setRecordCount(1);
      setAttentionItems(generatedItems);
      setMemoryItems(candidate ? [candidate] : []);
    }
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
  }

  function confirmMemory(memoryId: string) {
    setMemoryItems((current) =>
      current.map((item) => (item.id === memoryId ? { ...item, status: "confirmed", requiresConfirmation: false } : item))
    );
  }

  function dismissMemory(memoryId: string) {
    setMemoryItems((current) =>
      current.map((item) => (item.id === memoryId ? { ...item, status: "dismissed" } : item))
    );
  }

  const followupMetrics = useMemo(() => buildFollowupMetrics(recordCount, attentionItems, memoryItems), [recordCount, attentionItems, memoryItems]);

  const value: CareMindContextValue = {
    patient,
    recordCount,
    attentionItems,
    memoryItems,
    caregiverCheckins,
    lastStructuredLog,
    lastRawNote,
    followupMetrics,
    completeOnboarding,
    previewStructuredLog,
    previewMemoryCandidate,
    saveLog,
    saveCaregiverCheckin,
    updateActionStatus,
    confirmMemory,
    dismissMemory
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
      mealIntake: hasMeal ? "unknown" : "unknown",
      note: hasMeal ? "提到饮食或饮水变化，建议补充具体摄入量" : "未提到饮食变化"
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
        { id: "hallway_light", label: "打开走廊夜灯", status: "pending" },
        { id: "door_check", label: "睡前确认门锁和门铃提醒", status: "pending" },
        { id: "floor_clear", label: "移开床边和门口障碍物", status: "pending" }
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
        { id: "meal_record", label: "记录今天大概吃了多少", status: "pending" },
        { id: "water_record", label: "记录今天饮水情况", status: "pending" }
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
        { id: "medication_time", label: "记录发生时间和场景", status: "pending" },
        { id: "doctor_question", label: "加入复诊问题清单", status: "pending" }
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
        { id: "lower_goal", label: "今晚只保留安全和基本照护目标", status: "pending" },
        { id: "ask_support", label: "联系一位家人轮替一小段时间", status: "pending" }
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
  return [...incoming, ...current].slice(0, 6);
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

function buildBehaviorLabel(note: string) {
  if (/偷|钱|丢/.test(note)) return "担心物品或钱被拿走";
  if (/要回家|回老家/.test(note)) return "反复表达想回家";
  if (/不认识|不是/.test(note)) return "出现身份或关系混淆表达";
  if (/烦躁|激动|吵/.test(note)) return "出现烦躁或激动表达";
  return null;
}
