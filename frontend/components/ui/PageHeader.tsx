import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Settings } from "lucide-react-native";
import { router } from "expo-router";
import { colors, hitSlop, typography } from "../../lib/theme";

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
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12
  },
  titleBlock: {
    flex: 1
  },
  title: {
    ...typography.pageTitle,
    color: colors.text.primary
  },
  subtitle: {
    ...typography.helper,
    color: colors.text.muted,
    marginTop: 2
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle
  }
});
