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
  const labelStyle = variant === "primary" || variant === "danger" ? styles.lightLabel : styles.darkLabel;

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
        pressed && !disabled ? styles.pressed : null
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
    minHeight: 52,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16
  },
  primary: {
    backgroundColor: colors.brand.primary
  },
  secondary: {
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: "#B8E6D4"
  },
  ghost: {
    backgroundColor: colors.surface.muted
  },
  danger: {
    backgroundColor: colors.status.alert
  },
  disabled: {
    opacity: 0.48
  },
  pressed: {
    transform: [{ scale: 0.98 }]
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
  icon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center"
  }
});
