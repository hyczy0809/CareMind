import { Pressable, StyleSheet, Text, View } from "react-native";
import { Activity, Edit3, Trash2 } from "lucide-react-native";
import type { AnalyticsEvent } from "../../types/caremind";
import { useCareMind } from "../../lib/caremind-store";
import { colors, hitSlop, typography } from "../../lib/theme";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Pill } from "../ui/Pill";
import { Screen } from "../ui/Screen";
import { SectionTitle } from "../ui/SectionTitle";
import { PrivacyModeCard } from "./PrivacyModeCard";

function statusLabel(status: string) {
  switch (status) {
    case "candidate":
      return "等你确认";
    case "confirmed":
      return "已记住";
    case "local_only":
      return "仅本机保存";
    case "synced":
      return "已同步";
    case "stale":
      return "需要重新确认";
    default:
      return "已忽略";
  }
}

function eventLabel(name: AnalyticsEvent["name"]) {
  const labels: Record<AnalyticsEvent["name"], string> = {
    demo_data_loaded: "加载演示数据",
    onboarding_completed: "完成首次引导",
    activity_started: "开始陪伴活动",
    activity_completed: "完成陪伴活动",
    activity_stopped: "提前停止活动",
    activity_feedback_saved: "保存活动反馈",
    activity_memory_candidate_created: "生成活动记忆候选",
    care_log_ai_parse_succeeded: "AI 整理照护记录成功",
    care_log_ai_parse_failed: "AI 整理照护记录失败",
    care_log_saved: "保存照护记录",
    action_status_changed: "更新行动状态",
    caregiver_checkin_saved: "保存照护者状态",
    memory_confirmed: "确认长期记忆",
    memory_dismissed: "忽略长期记忆",
    followup_range_changed: "切换复诊范围",
    followup_report_loaded: "生成复诊摘要",
    followup_report_failed: "复诊摘要生成失败",
    followup_copy_started: "生成可复制复诊摘要",
    followup_copy_succeeded: "复制复诊摘要成功",
    followup_copy_failed: "复制复诊摘要失败",
    document_upload_started: "开始上传复诊资料",
    document_upload_succeeded: "复诊资料上传成功",
    document_upload_failed: "复诊资料上传失败",
    document_parse_started: "开始整理资料草稿",
    document_parse_succeeded: "资料草稿整理成功",
    document_parse_failed: "资料草稿整理失败",
    document_review_confirmed: "确认资料用于复诊",
    document_deleted: "删除复诊资料",
    voice_input_started: "开始语音记录",
    voice_input_succeeded: "语音转文字成功",
    voice_input_failed: "语音转文字失败",
    voice_input_unsupported: "当前环境不支持语音"
  };

  return labels[name];
}

function formatEventTime(dateText: string) {
  return new Date(dateText).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatProperties(properties: AnalyticsEvent["properties"]) {
  const pairs = Object.entries(properties).filter(([, value]) => value !== null && value !== "");
  if (pairs.length === 0) return "无额外上下文";

  return pairs
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

export function MemorySettingsScreen() {
  const { patient, memoryItems, analyticsEvents } = useCareMind();

  return (
    <Screen>
      <PageHeader title="已记住的信息" subtitle={`${patient.nickname} · 可随时编辑或删除`} right={<View />} />
      <SectionTitle title="隐私模式" helper="选择是否优先使用本机模型处理照护记录" />
      <PrivacyModeCard />
      <SectionTitle title="关于已记住的信息" />
      <Card tone="info">
        <Text style={styles.body}>这些信息用于让 CareMind 更了解你的家庭照护情况。医疗结论和用药信息不会由 CareMind 自动推断。</Text>
      </Card>
      <SectionTitle title="患者习惯与有效方法" />
      {memoryItems.length > 0 ? (
        memoryItems.map((item) => (
          <Card key={item.id}>
            <View style={styles.headerRow}>
              <View style={styles.titleBlock}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.body}>{item.description}</Text>
              </View>
              <Pill label={statusLabel(item.status)} tone={item.status === "confirmed" ? "brand" : "info"} />
            </View>
            <Text style={styles.source}>来源：{item.evidence.join("、")}</Text>
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={`编辑${item.title}`} hitSlop={hitSlop} style={styles.actionButton}>
                <Edit3 color={colors.text.secondary} size={18} />
                <Text style={styles.actionText}>编辑</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`删除${item.title}`} hitSlop={hitSlop} style={styles.actionButton}>
                <Trash2 color={colors.status.alert} size={18} />
                <Text style={[styles.actionText, styles.deleteText]}>删除</Text>
              </Pressable>
            </View>
          </Card>
        ))
      ) : (
        <Card>
          <Text style={styles.cardTitle}>还没有已记住的信息</Text>
          <Text style={styles.body}>在“智能记录”里保存记录后，如果出现可长期使用的模式或方法，我会先问你是否记住。</Text>
        </Card>
      )}

      <SectionTitle title="核心事件" helper="仅本机保存，用于 demo 验收和调试" />
      {analyticsEvents.length > 0 ? (
        analyticsEvents.slice(0, 20).map((event) => (
          <Card key={event.id}>
            <View style={styles.headerRow}>
              <Activity color={colors.status.info} size={18} />
              <View style={styles.titleBlock}>
                <Text style={styles.cardTitle}>{eventLabel(event.name)}</Text>
                <Text style={styles.body}>{formatProperties(event.properties)}</Text>
              </View>
              <Pill label={formatEventTime(event.createdAt)} tone="info" />
            </View>
          </Card>
        ))
      ) : (
        <Card>
          <Text style={styles.cardTitle}>还没有核心事件</Text>
          <Text style={styles.body}>保存记录、切换复诊范围或生成可复制摘要后，这里会出现本机事件记录。</Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10
  },
  titleBlock: {
    flex: 1
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  body: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 6
  },
  source: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 12
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface.muted
  },
  actionText: {
    ...typography.label,
    color: colors.text.secondary
  },
  deleteText: {
    color: colors.status.alert
  }
});
