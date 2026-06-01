import { StyleSheet, Text, View } from "react-native";
import { DatabaseZap } from "lucide-react-native";
import { colors, typography } from "../../lib/theme";

interface MemoryUsedPillProps {
  label: string;
}

export function MemoryUsedPill({ label }: MemoryUsedPillProps) {
  return (
    <View style={styles.container} accessibilityRole="text">
      <DatabaseZap color={colors.status.info} size={15} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: 18,
    paddingHorizontal: 12,
    backgroundColor: colors.statusSoft.info
  },
  label: {
    ...typography.small,
    fontWeight: "700",
    color: colors.status.info
  }
});
