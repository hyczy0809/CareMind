import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Brain, Check, X } from "lucide-react-native";
import type { MemoryItem } from "../../types/caremind";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { selectionHaptic, successHaptic } from "../../lib/safe-haptics";
import { colors, hitSlop, typography } from "../../lib/theme";

interface MemoryCandidateCardProps {
  item: MemoryItem;
}

export function MemoryCandidateCard({ item }: MemoryCandidateCardProps) {
  const [status, setStatus] = useState(item.status);

  async function remember() {
    setStatus("confirmed");
    await successHaptic();
  }

  async function dismiss() {
    setStatus("dismissed");
    await selectionHaptic();
  }

  if (status === "confirmed") {
    return (
      <Card tone="brand">
        <View style={styles.headerRow}>
          <Check color={colors.brand.primaryDark} size={20} />
          <Text style={styles.confirmedTitle}>已记住：{item.title}</Text>
        </View>
        <Text style={styles.body}>下次出现类似情况时，我会优先提醒这个方法。</Text>
      </Card>
    );
  }

  if (status === "dismissed") {
    return (
      <Card>
        <View style={styles.headerRow}>
          <X color={colors.text.muted} size={20} />
          <Text style={styles.dismissedTitle}>已暂时不记</Text>
        </View>
        <Text style={styles.body}>之后 7 天内不会重复询问同一条候选记忆。</Text>
      </Card>
    );
  }

  return (
    <Card tone="info">
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Brain color={colors.status.info} size={20} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>是否记住这个方法？</Text>
          <Text style={styles.subtitle}>{item.title}</Text>
        </View>
      </View>

      <Text style={styles.body}>{item.description}</Text>

      <View style={styles.evidenceWrap}>
        {item.evidence.map((evidence) => (
          <View key={evidence} style={styles.evidencePill}>
            <Text style={styles.evidenceText}>{evidence}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <View style={styles.primaryAction}>
          <Button label="记住" onPress={remember} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="暂时不记这条信息"
          hitSlop={hitSlop}
          onPress={dismiss}
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryText}>暂时不记</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF99"
  },
  titleBlock: {
    flex: 1
  },
  title: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  subtitle: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 2
  },
  body: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 12
  },
  evidenceWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12
  },
  evidencePill: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#FFFFFFAA"
  },
  evidenceText: {
    ...typography.small,
    fontWeight: "700",
    color: colors.text.secondary
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16
  },
  primaryAction: {
    flex: 1
  },
  secondaryAction: {
    minHeight: 52,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryText: {
    ...typography.label,
    color: colors.text.secondary
  },
  confirmedTitle: {
    ...typography.cardTitle,
    color: colors.brand.primaryDark,
    flex: 1
  },
  dismissedTitle: {
    ...typography.cardTitle,
    color: colors.text.secondary,
    flex: 1
  }
});
