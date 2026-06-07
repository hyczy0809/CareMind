// Deterministic regex-based builders previously embedded in caremind-store.tsx.
// Two uses:
//   1. The CareMindProvider still uses them for offline / preview / onboarding
//      flows that should never round-trip to the network or to Gemma.
//   2. The local inference adapters use them as a graceful fallback when Gemma
//      fails to return valid JSON, so users always get a usable structured log
//      even when the on-device model misbehaves.
//
// Keeping behaviour byte-identical to the previous in-store implementation —
// this is a pure code move, no logic changes.

import type { AttentionItem, MemoryItem, StructuredLog } from "../../../types/caremind";

export function buildStructuredLog(note: string): StructuredLog {
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

export function buildAttentionItems(note: string): AttentionItem[] {
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

export function buildMemoryCandidate(patientId: string, note: string): MemoryItem | null {
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

export function extractNightWakings(note: string): number | null {
  const direct = note.match(/(\d+)\s*次/);
  if (direct?.[1]) return Number(direct[1]);
  if (/一次/.test(note)) return 1;
  if (/两次|二次/.test(note)) return 2;
  if (/三次/.test(note)) return 3;
  if (/四次/.test(note)) return 4;
  if (/五次/.test(note)) return 5;
  return null;
}

export function extractMedicationRefusalCount(note: string): number | null {
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

export function buildBehaviorLabel(note: string): string | null {
  if (/偷|钱|丢/.test(note)) return "担心物品或钱被拿走";
  if (/要回家|回老家/.test(note)) return "反复表达想回家";
  if (/不认识|不是/.test(note)) return "出现身份或关系混淆表达";
  if (/烦躁|激动|吵/.test(note)) return "出现烦躁或激动表达";
  return null;
}
