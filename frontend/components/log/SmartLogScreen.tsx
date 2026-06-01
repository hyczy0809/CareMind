import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Speech from "expo-speech";
import {
  Check,
  ClipboardList,
  Mic,
  Pencil,
  Play,
  Sparkles,
  Volume2,
  X
} from "lucide-react-native";
import { useCareMind } from "../../lib/caremind-store";
import { selectionHaptic, successHaptic } from "../../lib/safe-haptics";
import { colors, hitSlop, shadow, typography } from "../../lib/theme";
import type { MemoryItem, StructuredLog } from "../../types/caremind";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Screen } from "../ui/Screen";
import { MemoryCandidateCard } from "../memory/MemoryCandidateCard";
import { MemoryUsedPill } from "../memory/MemoryUsedPill";
import { SimilarEventCard } from "../memory/SimilarEventCard";

type ParseState = "idle" | "parsing" | "parsed" | "saved";
type SummaryField = "sleep" | "behavior" | "nutrition" | "caregiver";
type ScriptAdvice = {
  notRecommended: string;
  recommended: string;
  principle: string;
};

const progressSteps = ["提取照护事件", "识别今天值得关注", "生成沟通建议", "检查是否需要记住新模式"];
const quickChips = ["夜里起来了", "不肯吃饭", "说有人偷钱", "不肯吃药"];
const medicalKeywords = /诊断|停药|换药|加药|减药|补药|MRI|CT|核磁|检查|处方|药量/;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function MedicalBoundaryBubble({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.boundaryBubble}>
      <Text style={styles.boundaryBubbleText}>我不能判断诊断或用药，但可以帮你整理成复诊时医生容易理解的问题。</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭医疗边界提示" hitSlop={hitSlop} onPress={onClose} style={styles.bubbleClose}>
        <X color={colors.status.info} size={18} />
      </Pressable>
    </View>
  );
}

function MagicLogInput({
  value,
  onChange,
  onParse,
  parseState,
  showBoundary,
  onDismissBoundary,
  error,
  nickname
}: {
  value: string;
  onChange: (value: string) => void;
  onParse: () => void;
  parseState: ParseState;
  showBoundary: boolean;
  onDismissBoundary: () => void;
  error: string | null;
  nickname: string;
}) {
  return (
    <Card>
      <Text style={styles.cardTitle}>今天 {nickname} 有什么让你担心的事吗？</Text>
      <Text style={styles.body}>写一句话就够了，也可以直接粘贴家属聊天记录。</Text>
      {showBoundary ? <MedicalBoundaryBubble onClose={onDismissBoundary} /> : null}
      <TextInput
        accessibilityLabel="输入今天发生了什么"
        editable={parseState !== "parsing"}
        multiline
        value={value}
        onChangeText={onChange}
        maxLength={1000}
        placeholder="今天妈妈有什么让你担心的事吗？"
        placeholderTextColor={colors.text.muted}
        style={[styles.textInput, parseState === "parsing" && styles.textInputDisabled]}
        textAlignVertical="top"
      />
      <View style={styles.inputMetaRow}>
        <Text style={styles.inputError}>{error ?? ""}</Text>
        <Text style={styles.charCount}>{value.length} / 1000</Text>
      </View>
      <View style={styles.quickRow}>
        {quickChips.map((chip) => (
          <Pressable
            key={chip}
            accessibilityRole="button"
            hitSlop={hitSlop}
            onPress={() => onChange(value ? `${value}，${chip}` : chip)}
            style={styles.quickChip}
          >
            <Text style={styles.quickChipText}>{chip}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.inputActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="长按说话" hitSlop={hitSlop} style={styles.voiceButton}>
          <Mic color={colors.brand.primaryDark} size={20} />
          <Text style={styles.voiceText}>长按说话</Text>
        </Pressable>
        <View style={styles.parseButton}>
          <Button label="帮我整理" loading={parseState === "parsing"} onPress={onParse} />
        </View>
      </View>
    </Card>
  );
}

function AgentProgressCard({ completedSteps }: { completedSteps: number }) {
  return (
    <Card tone="brand">
      <View style={styles.headerRow}>
        <Sparkles color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>正在帮你整理</Text>
      </View>
      <View style={styles.progressList}>
        {progressSteps.map((step, index) => {
          const done = index < completedSteps;
          const active = index === completedSteps;
          return (
            <View key={step} style={styles.progressRow}>
              <View style={[styles.progressIcon, done && styles.progressIconDone, active && styles.progressIconActive]}>
                {done ? <Check color="#FFFFFF" size={14} /> : <Text style={styles.progressNumber}>{index + 1}</Text>}
              </View>
              <Text style={styles.progressText}>{step}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function formatStructuredLog(structuredLog: StructuredLog) {
  const behavior = structuredLog.behavior[0];
  return {
    sleep:
      structuredLog.sleep.nightWakings === null
        ? structuredLog.sleep.note || "未提到夜间起床次数"
        : `夜间起床 ${structuredLog.sleep.nightWakings} 次`,
    behavior: behavior?.label ?? "未提到明显行为变化",
    nutrition: structuredLog.nutrition.note,
    caregiver: structuredLog.caregiver.quote ? `表达“${structuredLog.caregiver.quote}”` : "未提到照护者压力"
  };
}

function StructuredSummaryCard({
  structuredLog,
  onChange
}: {
  structuredLog: StructuredLog;
  onChange: (next: StructuredLog) => void;
}) {
  const rows = formatStructuredLog(structuredLog);
  const [editingField, setEditingField] = useState<SummaryField | null>(null);
  const [draftValue, setDraftValue] = useState("");

  function openEdit(field: SummaryField) {
    setEditingField(field);
    setDraftValue(rows[field]);
  }

  function markUnknown() {
    if (!editingField) return;
    saveField("未知");
  }

  function saveField(value = draftValue.trim()) {
    if (!editingField) return;
    const finalValue = value || "未知";
    const next: StructuredLog = {
      ...structuredLog,
      sleep: { ...structuredLog.sleep },
      behavior: [...structuredLog.behavior],
      nutrition: { ...structuredLog.nutrition },
      caregiver: { ...structuredLog.caregiver }
    };

    if (editingField === "sleep") {
      const numberMatch = finalValue.match(/(\d+)/);
      next.sleep = {
        nightWakings: numberMatch ? Number(numberMatch[1]) : null,
        note: finalValue
      };
    }

    if (editingField === "behavior") {
      next.behavior = finalValue === "未知" ? [] : [{ label: finalValue, evidence: "用户编辑确认", frequency: "已确认" }];
    }

    if (editingField === "nutrition") {
      next.nutrition = {
        mealIntake: finalValue === "未知" ? "unknown" : structuredLog.nutrition.mealIntake,
        note: finalValue
      };
    }

    if (editingField === "caregiver") {
      next.caregiver = {
        quote: finalValue === "未知" ? "" : finalValue,
        stressSignal: finalValue !== "未知"
      };
    }

    onChange(next);
    setEditingField(null);
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <ClipboardList color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>今天记录的内容</Text>
        <Pencil color={colors.text.muted} size={18} />
      </View>
      <View style={styles.summaryGrid}>
        <SummaryRow label="睡眠" value={rows.sleep} uncertain={structuredLog.sleep.nightWakings === null} onPress={() => openEdit("sleep")} />
        <SummaryRow label="行为" value={rows.behavior} uncertain={structuredLog.behavior.length === 0} onPress={() => openEdit("behavior")} />
        <SummaryRow label="饮食" value={rows.nutrition} uncertain={structuredLog.nutrition.mealIntake === "unknown"} onPress={() => openEdit("nutrition")} />
        <SummaryRow label="照护者" value={rows.caregiver} uncertain={!structuredLog.caregiver.stressSignal} onPress={() => openEdit("caregiver")} />
      </View>
      <Text style={styles.boundaryText}>这些是照护记录整理，不是诊断。你可以在保存前修改每个字段。</Text>

      <Modal visible={editingField !== null} transparent animationType="slide" onRequestClose={() => setEditingField(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>修改字段</Text>
            <TextInput
              accessibilityLabel="修改结构化字段"
              value={draftValue}
              onChangeText={setDraftValue}
              multiline
              style={[styles.textInput, styles.editInput]}
              textAlignVertical="top"
            />
            <View style={styles.sheetActions}>
              <Button label="保存修改" onPress={() => saveField()} />
              <Button label="标记为未知" variant="secondary" onPress={markUnknown} />
              <Button label="取消" variant="ghost" onPress={() => setEditingField(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  uncertain,
  onPress
}: {
  label: string;
  value: string;
  uncertain: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={onPress} style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      {uncertain ? (
        <View style={styles.uncertainBadge}>
          <Text style={styles.uncertainText}>待确认</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function AttentionPreviewCard() {
  return (
    <Card tone="watch">
      <Text style={styles.cardTitle}>今晚值得注意</Text>
      <Text style={styles.body}>我已经把这条记录同步到“今日照护”，那里会展示可勾选的行动建议。</Text>
      <View style={styles.speechButton}>
        <Button label="去今日照护查看" variant="secondary" onPress={() => router.push("/(tabs)/today")} />
      </View>
    </Card>
  );
}

function InstantScriptCard({ advice }: { advice: ScriptAdvice }) {
  function speak() {
    Speech.stop();
    Speech.speak(advice.recommended, { language: "zh-CN", pitch: 1.0, rate: 0.85 });
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <Volume2 color={colors.status.info} size={20} />
        <Text style={styles.cardTitle}>现在可以这样回应</Text>
      </View>
      <View style={styles.badScript}>
        <Text style={styles.badScriptLabel}>不建议说</Text>
        <Text style={styles.scriptText}>“{advice.notRecommended}”</Text>
      </View>
      <View style={styles.goodScript}>
        <Text style={styles.goodScriptLabel}>可以试着说</Text>
        <Text style={styles.scriptText}>“{advice.recommended}”</Text>
        <View style={styles.speechButton}>
          <Button label="播放这句话" variant="secondary" icon={<Play color={colors.brand.primaryDark} size={18} />} onPress={speak} />
        </View>
      </View>
      <Text style={styles.body}>原则：{advice.principle}</Text>
    </Card>
  );
}

function SavedState() {
  return (
    <Card tone="brand">
      <View style={styles.headerRow}>
        <Check color={colors.brand.primaryDark} size={22} />
        <Text style={styles.cardTitle}>已写入今天的照护日志</Text>
      </View>
      <Text style={styles.body}>去今日照护查看今晚行动建议，或继续再记一条。</Text>
      <View style={styles.speechButton}>
        <Button label="去今日照护" variant="secondary" onPress={() => router.push("/(tabs)/today")} />
      </View>
    </Card>
  );
}

function MilestoneToast({ text }: { text: string }) {
  return (
    <View style={styles.toast}>
      <Text style={styles.toastText}>{text}</Text>
    </View>
  );
}

export function SmartLogScreen() {
  const {
    patient,
    memoryItems,
    recordCount,
    lastRawNote,
    lastStructuredLog,
    previewStructuredLog,
    previewMemoryCandidate,
    saveLog
  } = useCareMind();
  const [value, setValue] = useState("");
  const [parseState, setParseState] = useState<ParseState>("idle");
  const [parsedLog, setParsedLog] = useState<StructuredLog | null>(null);
  const [candidate, setCandidate] = useState<MemoryItem | null>(null);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const [boundaryDismissed, setBoundaryDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hydratedInitialLog, setHydratedInitialLog] = useState(false);
  const similarMemory = useMemo(() => memoryItems.find((item) => item.status === "confirmed"), [memoryItems]);
  const scriptAdvice = parsedLog ? buildScriptAdvice(value, parsedLog) : null;
  const showBoundary = !boundaryDismissed && medicalKeywords.test(value);

  useEffect(() => {
    if (hydratedInitialLog || parseState !== "idle" || !lastRawNote || !lastStructuredLog) return;
    setValue(lastRawNote);
    setParsedLog(lastStructuredLog);
    setCandidate(previewMemoryCandidate(lastRawNote));
    setCompletedSteps(progressSteps.length);
    setParseState("saved");
    setHydratedInitialLog(true);
  }, [hydratedInitialLog, lastRawNote, lastStructuredLog, parseState, previewMemoryCandidate]);

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 3000);
  }

  async function parse() {
    if (!value.trim()) {
      setInputError("先写下今天发生了什么。");
      return;
    }

    setInputError(null);
    setParseState("parsing");
    setCompletedSteps(0);
    await selectionHaptic();

    for (let index = 1; index <= progressSteps.length; index += 1) {
      await wait(160);
      setCompletedSteps(index);
    }

    setParsedLog(previewStructuredLog(value));
    setCandidate(previewMemoryCandidate(value));
    setParseState("parsed");
  }

  async function save() {
    if (!parsedLog) return;
    saveLog(value, parsedLog);
    setParseState("saved");
    await successHaptic();
    showToast(recordCount === 0 ? `你帮 ${patient.nickname} 记录了第一个重要信息。` : "已保存，复诊摘要会同步更新。");
  }

  function resetInput() {
    setValue("");
    setParsedLog(null);
    setCandidate(null);
    setCompletedSteps(0);
    setInputError(null);
    setParseState("idle");
  }

  return (
    <Screen>
      <PageHeader title="智能记录" subtitle={`${patient.nickname} · 你说，我帮你整理`} />
      {toast ? <MilestoneToast text={toast} /> : null}
      <MagicLogInput
        value={value}
        onChange={(next) => {
          setValue(next);
          setInputError(null);
        }}
        onParse={parse}
        parseState={parseState}
        showBoundary={showBoundary}
        onDismissBoundary={() => setBoundaryDismissed(true)}
        error={inputError}
        nickname={patient.nickname}
      />
      {parseState === "parsing" ? <AgentProgressCard completedSteps={completedSteps} /> : null}
      {(parseState === "parsed" || parseState === "saved") && parsedLog ? (
        <>
          {memoryItems.length > 0 ? <MemoryUsedPill label="已参考已记住的信息" /> : null}
          <View style={styles.spacer} />
          <StructuredSummaryCard structuredLog={parsedLog} onChange={setParsedLog} />
          {parseState === "saved" ? <AttentionPreviewCard /> : null}
          {similarMemory ? (
            <SimilarEventCard date="已记住的信息" title={similarMemory.title} description={similarMemory.description} />
          ) : null}
          {scriptAdvice ? <InstantScriptCard advice={scriptAdvice} /> : null}
          {candidate ? <MemoryCandidateCard item={candidate} /> : null}
          {parseState === "saved" ? <SavedState /> : null}
          <View style={styles.saveActions}>
            <Button label={parseState === "saved" ? "再记一条" : "写入日志"} onPress={parseState === "saved" ? resetInput : save} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function buildScriptAdvice(note: string, structuredLog: StructuredLog): ScriptAdvice | null {
  const behavior = structuredLog.behavior[0]?.label ?? "";

  if (/偷|钱|丢/.test(note) || behavior.includes("物品")) {
    return {
      notRecommended: "没人偷，你别乱想。",
      recommended: "你是不是很担心？我陪你一起找找。",
      principle: "先回应担心，再陪伴确认，避免直接否定和争辩。"
    };
  }

  if (/要回家|回老家/.test(note) || behavior.includes("想回家")) {
    return {
      notRecommended: "这里就是家，你别再说了。",
      recommended: "你是不是有点想家？我们先坐一下，我陪你慢慢说。",
      principle: "先接住情绪，再用安全的陪伴动作转移注意力。"
    };
  }

  if (/拒药|不吃药|服药/.test(note)) {
    return {
      notRecommended: "你必须现在吃，不吃不行。",
      recommended: "我知道你现在不想吃，我们先歇一下，等你舒服点再看看。",
      principle: "降低对抗，记录拒药场景，不自行补药或调整剂量。"
    };
  }

  if (/不肯吃|不吃饭|吃得很少|饭/.test(note)) {
    return {
      notRecommended: "你怎么又不吃饭？",
      recommended: "我们先吃两口软一点的，吃不下也没关系，我陪着你。",
      principle: "减少压力，记录摄入量；如果持续少食或呛咳，应咨询医生或营养师。"
    };
  }

  return null;
}

const styles = StyleSheet.create({
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text.primary,
    flex: 1
  },
  body: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 8
  },
  boundaryBubble: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.statusSoft.info,
    borderWidth: 1,
    borderColor: "#BFDDF3",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14
  },
  boundaryBubbleText: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  bubbleClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF99"
  },
  textInput: {
    minHeight: 138,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.muted,
    padding: 14,
    marginTop: 14,
    ...typography.body,
    color: colors.text.primary
  },
  textInputDisabled: {
    opacity: 0.72
  },
  inputMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8
  },
  inputError: {
    ...typography.small,
    color: colors.status.watch,
    flex: 1
  },
  charCount: {
    ...typography.small,
    color: colors.text.muted
  },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12
  },
  quickChip: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft
  },
  quickChipText: {
    ...typography.small,
    fontWeight: "800",
    color: colors.brand.primaryDark
  },
  inputActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14
  },
  voiceButton: {
    minHeight: 52,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.brand.primarySoft
  },
  voiceText: {
    ...typography.label,
    color: colors.brand.primaryDark
  },
  parseButton: {
    flex: 1
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  progressList: {
    marginTop: 14,
    gap: 10
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  progressIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFAA"
  },
  progressIconDone: {
    backgroundColor: colors.brand.primary
  },
  progressIconActive: {
    borderWidth: 1,
    borderColor: colors.brand.primary
  },
  progressNumber: {
    ...typography.small,
    color: colors.text.secondary,
    fontWeight: "800"
  },
  progressText: {
    ...typography.helper,
    color: colors.text.primary
  },
  summaryGrid: {
    marginTop: 14,
    gap: 8
  },
  summaryRow: {
    minHeight: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface.muted,
    paddingHorizontal: 12
  },
  summaryLabel: {
    ...typography.label,
    width: 64,
    color: colors.brand.primaryDark
  },
  summaryValue: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  uncertainBadge: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.statusSoft.watch
  },
  uncertainText: {
    ...typography.small,
    fontWeight: "800",
    color: colors.status.watch
  },
  boundaryText: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 10
  },
  badScript: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: colors.statusSoft.alert,
    marginTop: 14
  },
  goodScript: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: colors.statusSoft.calm,
    marginTop: 10
  },
  badScriptLabel: {
    ...typography.small,
    fontWeight: "800",
    color: colors.status.alert
  },
  goodScriptLabel: {
    ...typography.small,
    fontWeight: "800",
    color: colors.brand.primaryDark
  },
  scriptText: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: 5
  },
  speechButton: {
    marginTop: 12
  },
  spacer: {
    height: 12
  },
  saveActions: {
    marginTop: 4,
    marginBottom: 12
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
    color: colors.text.primary
  },
  editInput: {
    minHeight: 112
  },
  sheetActions: {
    gap: 8,
    marginTop: 12
  },
  toast: {
    borderRadius: 16,
    backgroundColor: colors.brand.primary,
    padding: 12,
    marginBottom: 12
  },
  toastText: {
    ...typography.helper,
    fontWeight: "800",
    color: colors.text.inverse
  }
});
