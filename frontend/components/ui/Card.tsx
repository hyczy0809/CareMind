import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius, shadow } from "../../lib/theme";

interface CardProps {
  children: ReactNode;
  tone?: "default" | "brand" | "watch" | "alert" | "info";
  padded?: boolean;
}

const toneStyles = {
  default: {
    backgroundColor: colors.surface.card,
    borderColor: colors.border.subtle
  },
  brand: {
    backgroundColor: colors.statusSoft.calm,
    borderColor: "#B8E6D4"
  },
  watch: {
    backgroundColor: colors.statusSoft.watch,
    borderColor: "#F4D18A"
  },
  alert: {
    backgroundColor: colors.statusSoft.alert,
    borderColor: "#F1B8A9"
  },
  info: {
    backgroundColor: colors.statusSoft.info,
    borderColor: "#BFDDF3"
  }
};

export function Card({ children, tone = "default", padded = true }: CardProps) {
  return <View style={[styles.card, toneStyles[tone], padded && styles.padded]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.xl,
    marginBottom: 12,
    ...shadow.card
  },
  padded: {
    padding: 16
  }
});
