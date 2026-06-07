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

const toneStyles = {
  default: {
    backgroundColor: colors.surface.card,
    borderColor: colors.border.subtle
  },
  brand: {
    backgroundColor: colors.surface.brand,
    borderColor: "#CFE4D2"
  },
  watch: {
    backgroundColor: colors.surface.watch,
    borderColor: "#EBD39B"
  },
  alert: {
    backgroundColor: colors.surface.alert,
    borderColor: "#E8B4A4"
  },
  info: {
    backgroundColor: colors.statusSoft.info,
    borderColor: "#C9D8E2"
  }
};

export function Card({ children, tone = "default", padded = true }: CardProps) {
  const accentColor = accentColors[tone];
  return (
    <View style={[styles.card, toneStyles[tone]]}>
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
    borderRadius: radius.xl,
    marginBottom: 13,
    overflow: "hidden",
    borderWidth: 1,
    ...shadow.card
  },
  accentBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl
  },
  padded: {
    padding: 16
  },
  paddedWithAccent: {
    paddingLeft: 20
  }
});
