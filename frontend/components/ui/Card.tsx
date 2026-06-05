import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius, shadow } from "../../lib/theme";

interface CardProps {
  children: ReactNode;
  tone?: "default" | "brand" | "watch" | "alert" | "info";
  padded?: boolean;
}

const accentColors = {
  default: null,
  brand: colors.brand.primary,
  watch: colors.status.watch,
  alert: colors.status.alert,
  info: colors.status.info
};

export function Card({ children, tone = "default", padded = true }: CardProps) {
  const accentColor = accentColors[tone];
  return (
    <View style={styles.card}>
      {accentColor ? (
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
      ) : null}
      <View style={[padded && styles.padded, accentColor ? styles.paddedWithAccent : null]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface.card,
    borderRadius: radius.xl,
    marginBottom: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadow.card
  },
  accentBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl
  },
  padded: {
    padding: 15
  },
  paddedWithAccent: {
    paddingLeft: 19
  }
});
