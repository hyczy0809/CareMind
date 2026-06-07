import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, hitSlop, radius, typography } from "../../lib/theme";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  accessibilityLabel
}: ButtonProps) {
  const variantStyle = styles[variant];
  const labelStyle =
    variant === "primary" || variant === "danger"
      ? styles.lightLabel
      : variant === "ghost"
        ? styles.ghostLabel
        : styles.darkLabel;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyle,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading ? styles.pressed : null
      ]}
    >
      {loading ? <ActivityIndicator color={variant === "primary" ? "#FFFFFF" : colors.brand.primary} /> : null}
      {!loading && icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.label, labelStyle]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "transparent"
  },
  primary: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary
  },
  secondary: {
    backgroundColor: colors.surface.info,
    borderColor: "#E7CBB0"
  },
  ghost: {
    backgroundColor: "rgba(255,253,248,0.58)",
    borderColor: colors.border.subtle
  },
  danger: {
    backgroundColor: colors.status.alert,
    borderColor: colors.status.alert
  },
  disabled: {
    opacity: 0.50
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }]
  },
  label: {
    ...typography.label
  },
  lightLabel: {
    color: colors.text.inverse
  },
  darkLabel: {
    color: colors.text.primary
  },
  ghostLabel: {
    color: colors.text.secondary
  },
  icon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center"
  }
});
