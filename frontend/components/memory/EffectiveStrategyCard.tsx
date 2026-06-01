import { StyleSheet, Text, View } from "react-native";
import { Lightbulb, Plus } from "lucide-react-native";
import type { MemoryItem } from "../../types/caremind";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { colors, typography } from "../../lib/theme";

interface EffectiveStrategyCardProps {
  item: MemoryItem;
}

export function EffectiveStrategyCard({ item }: EffectiveStrategyCardProps) {
  return (
    <Card tone="brand">
      <View style={styles.headerRow}>
        <Lightbulb color={colors.brand.primaryDark} size={21} />
        <Text style={styles.title}>上次有帮助的方法</Text>
      </View>
      <Text style={styles.body}>{item.description}</Text>
      <Text style={styles.source}>来源：{item.evidence.join("、")}</Text>
      <View style={styles.buttonWrap}>
        <Button
          label="加入今晚计划"
          variant="secondary"
          icon={<Plus color={colors.brand.primaryDark} size={18} />}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  title: {
    ...typography.cardTitle,
    color: colors.text.primary,
    flex: 1
  },
  body: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: 12
  },
  source: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 8
  },
  buttonWrap: {
    marginTop: 14
  }
});
