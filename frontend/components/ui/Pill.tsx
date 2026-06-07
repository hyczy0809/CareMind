import { StyleSheet, Text, View } from "react-native";
import { colors, radius, typography } from "../../lib/theme";

interface PillProps {
  label: string;
  tone?: "brand" | "watch" | "alert" | "info" | "neutral";
}

export function Pill({ label, tone = "neutral" }: PillProps) {
  const toneStyle = toneStyles[tone];
  return (
    <View style={[styles.pill, toneStyle.container]}>
      <Text style={[styles.label, toneStyle.label]}>{label}</Text>
    </View>
  );
}

const toneStyles = {
  brand: {
    container: { backgroundColor: colors.brand.primarySoft },
    label: { color: colors.brand.primaryDark }
  },
  watch: {
    container: { backgroundColor: colors.statusSoft.watch },
    label: { color: colors.status.watch }
  },
  alert: {
    container: { backgroundColor: colors.statusSoft.alert },
    label: { color: colors.status.alert }
  },
  info: {
    container: { backgroundColor: colors.statusSoft.info },
    label: { color: colors.status.info }
  },
  neutral: {
    container: { backgroundColor: colors.surface.muted },
    label: { color: colors.text.secondary }
  }
};

const styles = StyleSheet.create({
  pill: {
    minHeight: 32,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.subtle
  },
  label: {
    ...typography.small,
    fontWeight: "700"
  }
});
