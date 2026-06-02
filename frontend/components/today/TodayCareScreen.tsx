import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  HeartPulse,
  LineChart,
  ShieldCheck,
  X
} from "lucide-react-native";
import type {
  ActionStatus,
  AttentionItem,
  CaregiverCheckin,
  CaregiverCheckinRecord,
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

function EmptyTodayCard() {
  return (
    <Card>
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

function PatientStatusBar({
  nickname,
  updatedAt,
  attentionItems
}: {
  nickname: string;
  updatedAt: string;
  attentionItems: AttentionItem[];
}) {
  const highRisk = attentionItems.some((item) => item.severity === "high" || item.severity === "crisis");
  const hasAttention = attentionItems.length > 0;
  const statusLabel = highRisk ? "需留意" : hasAttention ? "有待处理" : "平稳";
  const statusStyle = highRisk ? styles.statusAlert : hasAttention ? styles.statusWatch : styles.statusCalm;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${nickname}，状态${statusLabel}，${updatedAt}`}
      hitSlop={hitSlop}
      onPress={() => router.push("/settings")}
      style={styles.statusBar}
    >
      <View style={styles.statusAvatar}>
        <CircleUserRound color={colors.brand.primaryDark} size={26} />
      </View>
      <View style={styles.statusContent}>
        <Text style={styles.statusName}>{nickname}</Text>
        <View style={styles.timeRow}>
          <Clock3 color={colors.text.muted} size={14} />
          <Text style={styles.muted}>{updatedAt}</Text>
        </View>
      </View>
      <View style={[styles.statusBadge, statusStyle]}>
        <Text style={styles.statusBadgeText}>{statusLabel}</Text>
      </View>
    </Pressable>
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
        <Clock3 color={colors.status.info} size={20} />
        <Text style={styles.cardTitle}>昨日行动追问</Text>
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
    <Card>
      <View style={styles.headerRow}>
        <HeartPulse color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>顺手记一下你的状态</Text>
      </View>

      <Text style={styles.fieldLabel}>现在照护压力</Text>
      <View style={styles.moodRow}>
        {pressureOptions.map((item) => (
          <Choice key={item.value} label={item.label} active={checkin.pressure === item.value} onPress={() => update({ pressure: item.value })} />
        ))}
      </View>

      <Text style={styles.fieldLabel}>今天有没有人能搭把手？</Text>
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
          <Text style={styles.adviceText}>{buildCaregiverAdvice(savedCheckin)}</Text>
        </View>
      ) : (
        <Text style={styles.body}>可选填。保存后，我会给你一个今天更轻一点的照护建议。</Text>
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
    <Card>
      <View style={styles.headerRow}>
        <LineChart color={colors.status.info} size={20} />
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
          <AlertTriangle color={item.severity === "high" ? colors.status.alert : colors.status.watch} size={20} />
          <Text style={styles.cardTitle}>{item.title}</Text>
        </View>
        <ChevronDown color={colors.text.secondary} size={20} />
      </Pressable>
      {expanded ? (
        <View>
          <View style={styles.evidenceBox}>
            <Text style={styles.evidenceText}>触发依据：{item.evidence}</Text>
          </View>
          <Text style={styles.fieldLabel}>勾选今晚能完成的事</Text>
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

export function TodayCareScreen() {
  const { patient, attentionItems, memoryItems, caregiverCheckins, updateActionStatus, saveCaregiverCheckin } = useCareMind();
  const effectiveMemory = memoryItems.find((item) => item.type === "effective_strategy" && item.status === "confirmed");
  const previousDayFollowups = useMemo(() => buildPreviousDayFollowups(attentionItems), [attentionItems]);

  function updateAction(itemId: string, actionId: string, status: ActionStatus, reason?: string) {
    updateActionStatus(itemId, actionId, status, reason);
  }

  return (
    <Screen>
      <PageHeader title="今日照护" subtitle={`${patient.nickname} · ${patient.updatedAt}`} />
      <PatientStatusBar nickname={patient.nickname} updatedAt={patient.updatedAt} attentionItems={attentionItems} />
      <PreviousDayFollowupCard followups={previousDayFollowups} onActionChange={updateAction} />

      <SectionTitle title="今天值得关注" helper="只展示今晚最需要处理的事项" />
      {attentionItems.length > 0 ? (
        attentionItems.map((item) => <AttentionItemCard key={item.id} item={item} onActionChange={updateAction} />)
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
  statusBar: {
    minHeight: 68,
    borderRadius: 22,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 12
  },
  statusAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft
  },
  statusContent: {
    flex: 1
  },
  statusName: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  statusBadge: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  statusCalm: {
    backgroundColor: colors.statusSoft.calm
  },
  statusWatch: {
    backgroundColor: colors.statusSoft.watch
  },
  statusAlert: {
    backgroundColor: colors.statusSoft.alert
  },
  statusBadgeText: {
    ...typography.small,
    fontWeight: "800",
    color: colors.text.primary
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2
  },
  muted: {
    ...typography.helper,
    color: colors.text.muted
  },
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
  cardAction: {
    marginTop: 14
  },
  followupBlock: {
    borderRadius: 16,
    backgroundColor: "#FFFFFF99",
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
    backgroundColor: colors.surface.muted,
    borderWidth: 1,
    borderColor: "transparent"
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
    borderRadius: 16,
    backgroundColor: colors.statusSoft.watch,
    padding: 12
  },
  adviceText: {
    ...typography.helper,
    color: colors.text.primary
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
    borderRadius: 16,
    backgroundColor: "#FFFFFF99",
    padding: 12,
    marginTop: 14
  },
  evidenceText: {
    ...typography.helper,
    color: colors.text.primary
  },
  actionRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "#FFFFFF88",
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
    backgroundColor: colors.status.alert,
    borderColor: colors.status.alert
  },
  actionLabel: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  blockedText: {
    color: colors.status.alert
  },
  blockButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 8
  },
  blockButtonText: {
    ...typography.small,
    fontWeight: "700",
    color: colors.status.alert
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
