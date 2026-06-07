import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Bell,
  Check,
  ChevronDown,
  Eye,
  HeartPulse,
  Images,
  Moon,
  ShieldCheck,
  TrendingUp,
  X
} from "lucide-react-native";
import type {
  ActionStatus,
  AnalyticsEvent,
  AnalyticsEventName,
  AttentionItem,
  CaregiverCheckin,
  CaregiverCheckinRecord,
  CompanionActivityFeedback,
  CompanionActivityRecord,
  CompanionActivityType,
  StressLevel
} from "../../types/caremind";
import { useCareMind } from "../../lib/caremind-store";
import { lightImpactHaptic, selectionHaptic } from "../../lib/safe-haptics";
import { colors, hitSlop, shadow, typography } from "../../lib/theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Screen } from "../ui/Screen";
import { SectionTitle } from "../ui/SectionTitle";
import { EffectiveStrategyCard } from "../memory/EffectiveStrategyCard";

type DraftCheckin = {
  pressure: StressLevel | null;
  supportToday: CaregiverCheckin["supportToday"] | null;
};

type FollowupAction = {
  itemId: string;
  actionId: string;
  itemTitle: string;
  actionLabel: string;
};

const pressureOptions = [
  { label: "还可以", value: "low" as const, moodScore: 4 as const },
  { label: "有点累", value: "medium" as const, moodScore: 3 as const },
  { label: "很吃力", value: "high" as const, moodScore: 2 as const },
  { label: "快撑不住", value: "crisis" as const, moodScore: 1 as const }
];
const supportOptions = [
  { label: "暂时没有", value: "no" as const },
  { label: "能帮一点", value: "partial" as const },
  { label: "有人帮", value: "yes" as const }
];
const companionActivityTemplates: Record<
  CompanionActivityType,
  {
    name: string;
    durationMinutes: number;
    difficulty: "低";
    bestFor: string;
    recommendationReason: string;
    steps: string[];
    memoryHint: string;
  }
> = {
  photo_reminiscence: {
    name: "老照片回忆",
    durationMinutes: 5,
    difficulty: "低",
    bestFor: "焦虑、想回家、需要安抚时",
    recommendationReason: "今天更适合先做熟悉、低压力的陪伴活动。",
    steps: [
      "选一张熟悉、情绪稳定的老照片。",
      "先描述你看到的内容，不直接考她记不记得。",
      "问一个轻一点的问题：这张照片让你想到什么？",
      "如果她不想说，就一起看一会儿，别追问。"
    ],
    memoryHint: "这次活动如果能让她更平静，会生成“老照片可能有帮助”的候选记忆。"
  },
  object_matching: {
    name: "颜色/物品配对",
    durationMinutes: 4,
    difficulty: "低",
    bestFor: "状态平稳、有一点参与意愿时",
    recommendationReason: "今天状态较平稳，可以试一个更有互动感的小活动。",
    steps: [
      "准备 3-4 组安全、熟悉的物品，比如袜子、杯垫或颜色卡片。",
      "先示范一组：这两个看起来像一对，我们放在一起。",
      "邀请她一起配一组；如果配错，也说“我们换个放法试试”。",
      "只做几组就停，不追求全部完成。"
    ],
    memoryHint: "这次活动如果参与顺利，会记录为短时陪伴活动候选。"
  },
  familiar_sorting: {
    name: "熟悉物品分类",
    durationMinutes: 5,
    difficulty: "低",
    bestFor: "想一起整理旧物、需要一点参与感时",
    recommendationReason: "可以通过熟悉物品给她一点参与感，但不需要纠错。",
    steps: [
      "准备 5-6 件安全熟悉的物品，比如照片、毛巾、杯子或小工具。",
      "分成两个很简单的区域，比如“照片”和“日用品”。",
      "邀请她把其中一件放到喜欢的位置；放哪里都先接纳。",
      "如果她开始烦躁，就停止分类，改成一起看物品。"
    ],
    memoryHint: "这次活动如果能带来参与感，会记录为熟悉物品陪伴候选。"
  }
};
const participationOptions = [
  { label: "愿意参与", value: "willing" as const },
  { label: "不太愿意", value: "hesitant" as const },
  { label: "明显抗拒", value: "resistant" as const }
];
const moodAfterOptions = [
  { label: "更平静", value: "calmer" as const },
  { label: "差不多", value: "same" as const },
  { label: "更烦躁", value: "more_agitated" as const }
];

function EmptyTodayCard() {
  return (
    <Card tone="brand">
      <View style={styles.headerRow}>
        <ShieldCheck color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>今天发生了什么？30 秒记一条。</Text>
      </View>
      <Text style={styles.body}>保存一条智能记录后，这里会显示今晚最需要关注的事项和可执行行动。</Text>
      <View style={styles.cardAction}>
        <Button label="去记录今天" onPress={() => router.push("/(tabs)/log")} />
      </View>
    </Card>
  );
}

function CompanionActivityEntryCard({
  nickname,
  records,
  recommendedType,
  recommendationReason,
  onSave,
  onTrack
}: {
  nickname: string;
  records: CompanionActivityRecord[];
  recommendedType: CompanionActivityType;
  recommendationReason: string;
  onSave: (feedback: CompanionActivityFeedback) => void;
  onTrack: (name: AnalyticsEventName, properties?: AnalyticsEvent["properties"]) => void;
}) {
  const [flow, setFlow] = useState<"idle" | "active" | "feedback" | "saved">("idle");
  const [selectedType, setSelectedType] = useState<CompanionActivityType>(recommendedType);
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const [participation, setParticipation] = useState<CompanionActivityFeedback["participation"] | null>(null);
  const [moodAfter, setMoodAfter] = useState<CompanionActivityFeedback["moodAfter"] | null>(null);
  const [frustration, setFrustration] = useState(false);
  const [fatigue, setFatigue] = useState(false);
  const selectedTemplate = companionActivityTemplates[selectedType];
  const latestRecord = records[0];
  const canSave = !!participation && !!moodAfter;
  const positiveFeedback = participation === "willing" && moodAfter === "calmer" && !frustration && !fatigue;

  function selectActivity(type: CompanionActivityType) {
    setSelectedType(type);
    setFlow("idle");
  }

  function startActivity() {
    setStoppedEarly(false);
    setParticipation(null);
    setMoodAfter(null);
    setFrustration(false);
    setFatigue(false);
    setFlow("active");
    onTrack("activity_started", {
      activity_type: selectedType,
      activity_name: selectedTemplate.name
    });
    void selectionHaptic();
  }

  function endActivity(nextStoppedEarly: boolean) {
    setStoppedEarly(nextStoppedEarly);
    setFlow("feedback");
    onTrack(nextStoppedEarly ? "activity_stopped" : "activity_completed", {
      activity_type: selectedType,
      stopped_early: nextStoppedEarly
    });
    void selectionHaptic();
  }

  function saveFeedback() {
    if (!canSave || !participation || !moodAfter) return;

    onSave({
      activityType: selectedType,
      activityName: selectedTemplate.name,
      durationMinutes: stoppedEarly ? Math.max(1, Math.round(selectedTemplate.durationMinutes / 2)) : selectedTemplate.durationMinutes,
      participation,
      moodAfter,
      frustration,
      fatigue,
      stoppedEarly
    });
    setFlow("saved");
    void selectionHaptic();
  }

  return (
    <Card tone="brand">
      <View style={styles.headerRow}>
        <Images color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>陪 {nickname} 做一个轻量活动</Text>
      </View>
      <Text style={styles.body}>今日推荐：{companionActivityTemplates[recommendedType].name}。重点是陪伴和情绪，不计分、不纠错。</Text>
      <View style={styles.recommendationBox}>
        <Text style={styles.recommendationText}>{recommendationReason}</Text>
      </View>

      {latestRecord ? (
        <View style={styles.activityLastBox}>
          <Text style={styles.activityLastTitle}>上次陪伴反馈</Text>
          <Text style={styles.activityLastText}>
            {latestRecord.activityName} · {latestRecord.participation === "willing" ? "愿意参与" : latestRecord.participation === "hesitant" ? "不太愿意" : "明显抗拒"} ·{" "}
            {latestRecord.moodAfter === "calmer" ? "更平静" : latestRecord.moodAfter === "same" ? "差不多" : "更烦躁"}
          </Text>
        </View>
      ) : null}

      {flow === "idle" ? (
        <>
          <View style={styles.activitySelector}>
            {(Object.keys(companionActivityTemplates) as CompanionActivityType[]).map((type) => {
              const template = companionActivityTemplates[type];
              const selected = selectedType === type;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  hitSlop={hitSlop}
                  onPress={() => selectActivity(type)}
                  style={[styles.activityOption, selected && styles.activityOptionSelected]}
                >
                  <Text style={[styles.activityOptionTitle, selected && styles.activityOptionTitleSelected]}>{template.name}</Text>
                  <Text style={[styles.activityOptionMeta, selected && styles.activityOptionMetaSelected]}>
                    {template.durationMinutes} 分钟 · 难度{template.difficulty}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.activityPreviewRow}>
            {["不考记忆", "无倒计时", "可随时停止", selectedTemplate.bestFor].map((item) => (
              <View key={item} style={styles.activityPreviewChip}>
                <Text style={styles.activityPreviewText}>{item}</Text>
              </View>
            ))}
          </View>
          <View style={styles.boundaryBox}>
            <Text style={styles.boundaryText}>这不是治疗方案。若活动中出现烦躁、疲惫或抗拒，建议停止并改为安静陪伴。</Text>
          </View>
          <View style={styles.cardAction}>
            <Button label={`开始${selectedTemplate.name}`} onPress={startActivity} />
          </View>
        </>
      ) : null}

      {flow === "active" ? (
        <View style={styles.activityFlowBox}>
          <Text style={styles.activityFlowTitle}>怎么陪她做</Text>
          {selectedTemplate.steps.map((step, index) => (
            <View key={step} style={styles.activityStepRow}>
              <View style={styles.activityStepIndex}>
                <Text style={styles.activityStepIndexText}>{index + 1}</Text>
              </View>
              <Text style={styles.activityStepText}>{step}</Text>
            </View>
          ))}
          <View style={styles.boundaryBox}>
            <Text style={styles.boundaryText}>停止条件：出现烦躁、疲惫、抗拒或明显挫败时，直接停止，不需要完成所有步骤。</Text>
          </View>
          <Text style={styles.activityMemoryHint}>{selectedTemplate.memoryHint}</Text>
          <View style={styles.activityActionRow}>
            <Button label="完成活动" onPress={() => endActivity(false)} />
            <Button label="提前停止" variant="secondary" onPress={() => endActivity(true)} />
          </View>
        </View>
      ) : null}

      {flow === "feedback" ? (
        <View style={styles.activityFlowBox}>
          <Text style={styles.activityFlowTitle}>记录刚才的反应</Text>
          <Text style={styles.dimLabel}>参与意愿</Text>
          <View style={styles.moodRow}>
            {participationOptions.map((item) => (
              <Choice key={item.value} label={item.label} active={participation === item.value} onPress={() => setParticipation(item.value)} />
            ))}
          </View>
          <Text style={styles.dimLabel}>活动后情绪</Text>
          <View style={styles.moodRow}>
            {moodAfterOptions.map((item) => (
              <Choice key={item.value} label={item.label} active={moodAfter === item.value} onPress={() => setMoodAfter(item.value)} />
            ))}
          </View>
          <Text style={styles.dimLabel}>有没有这些情况？</Text>
          <View style={styles.choiceRow}>
            <Choice label="有挫败感" active={frustration} onPress={() => setFrustration((value) => !value)} />
            <Choice label="看起来疲惫" active={fatigue} onPress={() => setFatigue((value) => !value)} />
          </View>
          <View style={styles.activityActionSingle}>
            <Button label="保存活动反馈" disabled={!canSave} onPress={saveFeedback} />
          </View>
        </View>
      ) : null}

      {flow === "saved" ? (
        <View style={styles.activityFlowBox}>
          <Text style={styles.activityFlowTitle}>已保存陪伴反馈</Text>
          <Text style={styles.body}>
            {positiveFeedback
              ? `这次活动看起来比较适合她。我已生成候选记忆，确认后之后会优先提醒你使用${selectedTemplate.name}。`
              : "这次先不勉强。下次可以降低难度、缩短时间，或换成安静听音乐/一起坐一会儿。"}
          </Text>
          <View style={styles.activityActionSingle}>
            <Button label="再做一次活动" variant="secondary" onPress={startActivity} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function PreviousDayFollowupCard({
  followups,
  onActionChange
}: {
  followups: FollowupAction[];
  onActionChange: (itemId: string, actionId: string, status: ActionStatus, reason?: string) => void;
}) {
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const visibleFollowups = followups.filter((item) => !answered[`${item.itemId}_${item.actionId}`]).slice(0, 2);

  if (visibleFollowups.length === 0) {
    return null;
  }

  async function answer(followup: FollowupAction, status: "done" | "blocked" | "skip") {
    setAnswered((current) => ({ ...current, [`${followup.itemId}_${followup.actionId}`]: true }));
    if (status !== "skip") {
      onActionChange(
        followup.itemId,
        followup.actionId,
        status,
        status === "blocked" ? "追问时标记为没做到" : undefined
      );
    }
    await selectionHaptic();
  }

  return (
    <Card tone="info">
      <View style={styles.headerRow}>
        <Moon color={colors.status.info} size={20} />
        <Text style={styles.cardTitle}>昨天建议的事，今天怎么样了？</Text>
      </View>
      {visibleFollowups.map((followup) => (
        <View key={`${followup.itemId}_${followup.actionId}`} style={styles.followupBlock}>
          <Text style={styles.body}>昨天建议你：{followup.actionLabel}，今天怎么样了？</Text>
          <View style={styles.followupActions}>
            <Button label="做到了" variant="secondary" onPress={() => answer(followup, "done")} />
            <Button label="没做到" variant="ghost" onPress={() => answer(followup, "blocked")} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="跳过这条追问"
              hitSlop={hitSlop}
              onPress={() => answer(followup, "skip")}
              style={styles.skipButton}
            >
              <Text style={styles.skipText}>跳过</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </Card>
  );
}

function Choice({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={hitSlop}
      onPress={onPress}
      style={[styles.choice, active && styles.choiceActive]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

function computeStressLevel(checkin: DraftCheckin): StressLevel {
  if (checkin.pressure === "crisis") {
    return "crisis";
  }
  if (checkin.pressure === "high" || (checkin.pressure === "medium" && checkin.supportToday === "no")) {
    return "high";
  }
  if (checkin.pressure === "medium" || checkin.supportToday === "no") {
    return "medium";
  }
  return "low";
}

function buildCaregiverAdvice(checkin: CaregiverCheckin) {
  if (checkin.stressLevel === "crisis") {
    return "今天先不要硬撑。请尽快联系一位可信任的人来接手一段时间；如果担心安全，请立即联系当地紧急服务。";
  }
  if (checkin.stressLevel === "high") {
    return "今天目标放低一点：先保证安全和基本照护，其他事情可以延后。";
  }
  if (checkin.stressLevel === "medium") {
    return "今天把任务拆小一点。能请人搭把手的部分，先交出去一点。";
  }
  return "今天先按平常节奏来。记得给自己留一点缓冲，不需要把每件事都做到满分。";
}

function CaregiverFourDimCheckin({ onSave }: { onSave: (checkin: CaregiverCheckin) => void }) {
  const [checkin, setCheckin] = useState<DraftCheckin>({
    pressure: null,
    supportToday: null
  });
  const [savedCheckin, setSavedCheckin] = useState<CaregiverCheckin | null>(null);
  const canSave = !!checkin.pressure;

  function update(next: Partial<DraftCheckin>) {
    setCheckin((current) => ({ ...current, ...next }));
    setSavedCheckin(null);
  }

  async function submit() {
    if (!canSave || !checkin.pressure) return;

    const pressureOption = pressureOptions.find((item) => item.value === checkin.pressure);

    const finalCheckin: CaregiverCheckin = {
      sleepHoursBucket: "unknown",
      moodScore: pressureOption?.moodScore ?? 3,
      supportToday: checkin.supportToday ?? "unknown",
      personalTime: null,
      stressLevel: computeStressLevel(checkin)
    };

    setSavedCheckin(finalCheckin);
    onSave(finalCheckin);
    await selectionHaptic();
  }

  return (
    <Card tone="info">
      <View style={styles.headerRow}>
        <HeartPulse color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>顺手记一下你的状态</Text>
      </View>

      <Text style={styles.dimLabel}>现在照护压力怎么样？</Text>
      <View style={styles.moodRow}>
        {pressureOptions.map((item) => (
          <Choice key={item.value} label={item.label} active={checkin.pressure === item.value} onPress={() => update({ pressure: item.value })} />
        ))}
      </View>

      <Text style={styles.dimLabel}>今天有没有人能搭把手？</Text>
      <View style={styles.choiceRow}>
        {supportOptions.map((item) => (
          <Choice
            key={item.value}
            label={item.label}
            active={checkin.supportToday === item.value}
            onPress={() => update({ supportToday: item.value })}
          />
        ))}
      </View>

      {savedCheckin ? (
        <View style={styles.adviceBox}>
          <View style={styles.adviceAccent} />
          <Text style={styles.adviceText}>{buildCaregiverAdvice(savedCheckin)}</Text>
        </View>
      ) : (
        <Text style={styles.body}>可选填。保存后，这里会显示一条给你自己的提醒。</Text>
      )}
      <View style={styles.checkinAction}>
        <Button
          label={savedCheckin ? "已保存今天状态" : "保存今天状态"}
          variant={savedCheckin ? "secondary" : "primary"}
          disabled={!canSave}
          onPress={submit}
        />
      </View>
    </Card>
  );
}

function MoodTrendChart({ checkins }: { checkins: CaregiverCheckinRecord[] }) {
  const ordered = [...checkins].reverse().slice(-7);
  const hasEnoughData = ordered.length >= 3;
  const highCount = ordered.filter((item) => item.stressLevel === "high" || item.stressLevel === "crisis").length;

  return (
    <Card tone="info">
      <View style={styles.headerRow}>
        <TrendingUp color={colors.status.info} size={20} />
        <Text style={styles.cardTitle}>近 7 天你的状态</Text>
      </View>
      <View style={styles.trendWrap}>
        {Array.from({ length: 7 }).map((_, index) => {
          const item = ordered[index];
          const score = item?.moodScore;
          const height = score ? 18 + score * 9 : 14;
          return (
            <View key={index} style={styles.trendColumn}>
              <View
                style={[
                  styles.trendDot,
                  {
                    height,
                    backgroundColor: score ? (score <= 2 ? colors.status.watch : colors.brand.primary) : colors.border.subtle
                  }
                ]}
              />
            </View>
          );
        })}
      </View>
      <Text style={styles.body}>
        {hasEnoughData
          ? highCount >= 3
            ? "近几次压力偏高，建议尽快安排轮替照护或外部支持。"
            : "趋势来自你提交的状态记录。继续记录可以帮助识别长期压力变化。"
          : "继续记录，3 天后可见趋势。"}
      </Text>
    </Card>
  );
}

function AttentionItemCard({
  item,
  onActionChange
}: {
  item: AttentionItem;
  onActionChange: (itemId: string, actionId: string, status: ActionStatus, reason?: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [blockedAction, setBlockedAction] = useState<string | null>(null);
  const severityTone = item.severity === "high" ? "alert" : item.severity === "medium" ? "watch" : "brand";

  async function markDone(actionId: string) {
    onActionChange(item.id, actionId, "done");
    await lightImpactHaptic();
  }

  function block(reason: string) {
    if (!blockedAction) return;
    onActionChange(item.id, blockedAction, "blocked", reason);
    setBlockedAction(null);
  }

  return (
    <Card tone={severityTone}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${item.title}，点按${expanded ? "收起" : "展开"}`}
        hitSlop={hitSlop}
        onPress={() => setExpanded((value) => !value)}
        style={styles.attentionHeader}
      >
        <View style={styles.attentionTitleRow}>
          {item.severity === "high" ? (
            <Bell color={colors.status.alert} size={20} />
          ) : (
            <Eye color={colors.status.watch} size={20} />
          )}
          <Text style={styles.cardTitle}>{item.title}</Text>
        </View>
        <ChevronDown color={colors.text.secondary} size={20} />
      </Pressable>
      {expanded ? (
        <View>
          <View style={styles.evidenceBox}>
            <Text style={styles.evidenceText}>触发依据：{item.evidence}</Text>
          </View>
          <Text style={styles.dimLabel}>今晚能做到的话——</Text>
          {item.actions.map((action) => (
            <View key={action.id} style={styles.actionRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: action.status === "done" }}
                accessibilityLabel={`${action.label}，点按标记完成`}
                hitSlop={hitSlop}
                onPress={() => markDone(action.id)}
                style={({ pressed }) => [styles.actionMainPress, pressed && styles.actionRowPressed]}
              >
                <View style={[styles.checkbox, action.status === "done" && styles.checkboxDone, action.status === "blocked" && styles.checkboxBlocked]}>
                  {action.status === "done" ? <Check color="#FFFFFF" size={16} /> : null}
                  {action.status === "blocked" ? <X color="#FFFFFF" size={14} /> : null}
                </View>
                <Text style={[styles.actionLabel, action.status === "blocked" && styles.blockedText]}>{action.label}</Text>
              </Pressable>
              {action.status === "pending" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`标记${action.label}做不到`}
                  hitSlop={hitSlop}
                  onPress={() => setBlockedAction(action.id)}
                  style={styles.blockButton}
                >
                  <Text style={styles.blockButtonText}>做不到</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <Text style={styles.boundaryText}>{item.doctorFeedbackHint}</Text>
        </View>
      ) : null}

      <Modal visible={blockedAction !== null} transparent animationType="slide" onRequestClose={() => setBlockedAction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>为什么今晚做不到？</Text>
            {["只有我一个人", "老人不配合", "家里没有设备", "我太累了"].map((reason) => (
              <Pressable key={reason} accessibilityRole="button" onPress={() => block(reason)} style={styles.reasonButton}>
                <Text style={styles.reasonText}>{reason}</Text>
              </Pressable>
            ))}
            <Button label="取消" variant="ghost" onPress={() => setBlockedAction(null)} />
          </View>
        </View>
      </Modal>
    </Card>
  );
}

function buildPreviousDayFollowups(items: AttentionItem[]): FollowupAction[] {
  const today = new Date().toDateString();

  return items
    .filter((item) => new Date(item.createdAt).toDateString() !== today)
    .flatMap((item) =>
      item.actions
        .filter((action) => action.status === "pending")
        .map((action) => ({
          itemId: item.id,
          actionId: action.id,
          itemTitle: item.title,
          actionLabel: action.label
        }))
    );
}

function dedupeTodayAttentionItems(items: AttentionItem[]) {
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

function recommendCompanionActivity(
  items: AttentionItem[],
  checkins: CaregiverCheckinRecord[]
): { type: CompanionActivityType; reason: string } {
  const latestCheckin = checkins[0];
  const highPressure = latestCheckin?.stressLevel === "high" || latestCheckin?.stressLevel === "crisis";
  const highAttention = items.some((item) => item.severity === "high" || item.severity === "crisis");
  const behaviorOrNightSignal = items.some((item) => item.type === "behavior" || item.type === "night_safety" || item.type === "wandering");

  if (highPressure || highAttention || behaviorOrNightSignal) {
    return {
      type: "photo_reminiscence",
      reason: "今天更适合熟悉、低刺激的陪伴方式，先帮助情绪稳定。"
    };
  }

  if (items.length === 0 || latestCheckin?.stressLevel === "low") {
    return {
      type: "object_matching",
      reason: "今天没有明显高风险记录，可以试一个短、轻、可随时停止的互动小游戏。"
    };
  }

  return {
    type: "familiar_sorting",
    reason: "今天可以用熟悉物品做一点轻量参与，不需要完成任务或纠错。"
  };
}

export function TodayCareScreen() {
  const {
    patient,
    attentionItems,
    memoryItems,
    caregiverCheckins,
    companionActivityRecords,
    updateActionStatus,
    saveCaregiverCheckin,
    saveCompanionActivityFeedback,
    trackEvent
  } = useCareMind();
  const visibleAttentionItems = useMemo(() => dedupeTodayAttentionItems(attentionItems), [attentionItems]);
  const effectiveMemory = memoryItems.find((item) => item.type === "effective_strategy" && item.status === "confirmed");
  const previousDayFollowups = useMemo(() => buildPreviousDayFollowups(visibleAttentionItems), [visibleAttentionItems]);
  const recommendedActivity = useMemo(
    () => recommendCompanionActivity(visibleAttentionItems, caregiverCheckins),
    [visibleAttentionItems, caregiverCheckins]
  );

  function updateAction(itemId: string, actionId: string, status: ActionStatus, reason?: string) {
    updateActionStatus(itemId, actionId, status, reason);
  }

  return (
    <Screen>
      <PageHeader title="今日照护" subtitle="把零散照护记录整理成今晚行动与复诊材料" />
      <PreviousDayFollowupCard followups={previousDayFollowups} onActionChange={updateAction} />

      <SectionTitle title="今日陪伴" helper="低压力活动，不测试记忆" />
      <CompanionActivityEntryCard
        nickname={patient.nickname}
        records={companionActivityRecords}
        recommendedType={recommendedActivity.type}
        recommendationReason={recommendedActivity.reason}
        onSave={saveCompanionActivityFeedback}
        onTrack={trackEvent}
      />

      <SectionTitle title="今天值得关注" helper="只展示今晚最需要处理的事项" />
      {visibleAttentionItems.length > 0 ? (
        visibleAttentionItems.map((item) => <AttentionItemCard key={item.id} item={item} onActionChange={updateAction} />)
      ) : (
        <EmptyTodayCard />
      )}

      <SectionTitle title="你的状态" helper="轻量记录，不需要填得很完整" />
      <CaregiverFourDimCheckin onSave={saveCaregiverCheckin} />
      <MoodTrendChart checkins={caregiverCheckins} />

      {effectiveMemory ? (
        <>
          <SectionTitle title="上次有效方法" />
          <EffectiveStrategyCard item={effectiveMemory} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text.primary,
    flex: 1
  },
  body: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: 10
  },
  recommendationBox: {
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 10,
    marginTop: 12
  },
  recommendationText: {
    ...typography.helper,
    color: colors.brand.primaryDark
  },
  activityLastBox: {
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 10,
    marginTop: 14
  },
  activityLastTitle: {
    ...typography.small,
    color: colors.brand.primaryDark,
    fontWeight: "800" as const
  },
  activityLastText: {
    ...typography.helper,
    color: colors.text.primary,
    marginTop: 3
  },
  activitySelector: {
    gap: 8,
    marginTop: 14
  },
  activityOption: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,248,0.64)",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  activityOptionSelected: {
    backgroundColor: colors.surface.card,
    borderColor: colors.brand.primary
  },
  activityOptionTitle: {
    ...typography.label,
    color: colors.text.primary
  },
  activityOptionTitleSelected: {
    color: colors.brand.primaryDark
  },
  activityOptionMeta: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 3
  },
  activityOptionMetaSelected: {
    color: colors.brand.primaryDark
  },
  activityPreviewRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14
  },
  activityPreviewChip: {
    minHeight: 36,
    borderRadius: 18,
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: "#CFE4D2"
  },
  activityPreviewText: {
    ...typography.small,
    color: colors.brand.primaryDark,
    fontWeight: "800" as const
  },
  boundaryBox: {
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 10,
    marginTop: 14
  },
  activityFlowBox: {
    borderRadius: 18,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 12,
    marginTop: 14
  },
  activityFlowTitle: {
    ...typography.label,
    color: colors.text.primary
  },
  activityStepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 12
  },
  activityStepIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primary
  },
  activityStepIndexText: {
    ...typography.small,
    color: colors.text.inverse,
    fontWeight: "800" as const
  },
  activityStepText: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  activityMemoryHint: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 10
  },
  activityActionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14
  },
  activityActionSingle: {
    marginTop: 14
  },
  cardAction: {
    marginTop: 14
  },
  followupBlock: {
    borderRadius: 14,
    backgroundColor: colors.surface.muted,
    padding: 12,
    marginTop: 12
  },
  followupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12
  },
  skipButton: {
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 8
  },
  skipText: {
    ...typography.label,
    color: colors.text.secondary
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text.primary,
    marginTop: 16,
    marginBottom: 8
  },
  dimLabel: {
    ...typography.helper,
    fontWeight: "600" as const,
    color: colors.text.secondary,
    marginTop: 16,
    marginBottom: 8
  },
  choiceRow: {
    flexDirection: "row",
    gap: 8
  },
  moodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  choice: {
    minHeight: 44,
    flex: 1,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: colors.border.subtle
  },
  choiceActive: {
    backgroundColor: colors.brand.primarySoft,
    borderColor: colors.brand.primary
  },
  choiceText: {
    ...typography.small,
    fontWeight: "700",
    color: colors.text.secondary
  },
  choiceTextActive: {
    color: colors.brand.primaryDark
  },
  adviceBox: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start"
  },
  adviceAccent: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.brand.primary,
    alignSelf: "stretch",
    minHeight: 16
  },
  adviceText: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  checkinAction: {
    marginTop: 14
  },
  trendWrap: {
    height: 72,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 14
  },
  trendColumn: {
    flex: 1,
    height: "100%",
    justifyContent: "flex-end"
  },
  trendDot: {
    minHeight: 14,
    borderRadius: 9
  },
  attentionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  attentionTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  evidenceBox: {
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    padding: 12,
    marginTop: 14
  },
  evidenceText: {
    ...typography.helper,
    color: colors.text.primary
  },
  actionRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: 8,
    marginBottom: 8
  },
  actionMainPress: {
    minHeight: 50,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 8
  },
  actionRowPressed: {
    opacity: 0.72
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border.strong,
    alignItems: "center",
    justifyContent: "center"
  },
  checkboxDone: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary
  },
  checkboxBlocked: {
    backgroundColor: colors.border.strong,
    borderColor: colors.border.strong
  },
  actionLabel: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  blockedText: {
    color: colors.text.secondary
  },
  blockButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 8
  },
  blockButtonText: {
    ...typography.small,
    fontWeight: "600" as const,
    color: colors.text.muted
  },
  boundaryText: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 6
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(31,41,51,0.28)"
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: colors.surface.card,
    ...shadow.sheet
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.subtle,
    alignSelf: "center",
    marginBottom: 16
  },
  sheetTitle: {
    ...typography.cardTitle,
    color: colors.text.primary,
    marginBottom: 12
  },
  reasonButton: {
    minHeight: 52,
    borderRadius: 16,
    justifyContent: "center",
    backgroundColor: colors.surface.muted,
    paddingHorizontal: 14,
    marginBottom: 8
  },
  reasonText: {
    ...typography.label,
    color: colors.text.primary
  }
});
