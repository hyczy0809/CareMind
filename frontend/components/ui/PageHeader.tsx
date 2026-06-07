import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Settings } from "lucide-react-native";
import { router } from "expo-router";
import { colors, hitSlop, shadow, typography } from "../../lib/theme";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开设置"
          hitSlop={hitSlop}
          onPress={() => router.push("/settings")}
          style={styles.settingsButton}
        >
          <Settings color={colors.text.secondary} size={22} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14
  },
  titleBlock: {
    flex: 1,
    paddingTop: 2
  },
  title: {
    ...typography.pageTitle,
    color: colors.text.primary
  },
  subtitle: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 3,
    maxWidth: 320
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadow.soft
  }
});
