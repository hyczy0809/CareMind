import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

async function runNativeHaptic(callback: () => Promise<void>) {
  if (Platform.OS === "web") {
    return;
  }

  try {
    await callback();
  } catch {
    // Haptics are enhancement-only. Never block the primary interaction.
  }
}

export function selectionHaptic() {
  return runNativeHaptic(() => Haptics.selectionAsync());
}

export function lightImpactHaptic() {
  return runNativeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function successHaptic() {
  return runNativeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
