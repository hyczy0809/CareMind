import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../lib/theme";

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  bottomInset?: number;
}

export function Screen({ children, scroll = true, bottomInset = 124 }: ScreenProps) {
  if (!scroll) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <LinearGradient colors={[colors.surface.app, colors.surface.wash]} style={styles.background}>
          <View style={[styles.staticContent, { paddingBottom: bottomInset }]}>{children}</View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <LinearGradient colors={[colors.surface.app, colors.surface.wash]} style={styles.background}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        >
          {children}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface.app
  },
  background: {
    flex: 1
  },
  content: {
    width: "100%",
    maxWidth: 500,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 16
  },
  staticContent: {
    flex: 1,
    width: "100%",
    maxWidth: 500,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 16
  }
});
