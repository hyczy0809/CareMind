import { Pressable, StyleSheet, Text, View } from "react-native";
import { Edit3, Trash2 } from "lucide-react-native";
import { useCareMind } from "../../lib/caremind-store";
import { colors, hitSlop, typography } from "../../lib/theme";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Pill } from "../ui/Pill";
import { Screen } from "../ui/Screen";
import { SectionTitle } from "../ui/SectionTitle";

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

export function MemorySettingsScreen() {
  const { patient, memoryItems } = useCareMind();

  return (
    <Screen>
      <PageHeader title="已记住的信息" subtitle={`${patient.nickname} · 可随时编辑或删除`} right={<View />} />
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
