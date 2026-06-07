import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { CareMindProvider } from "../lib/caremind-store";
import { colors } from "../lib/theme";
import { initPrivacyMode } from "../lib/inference/privacy-mode";

export default function RootLayout() {
  // Hydrate the privacy-mode flag from AsyncStorage before any inference runs.
  // We don't block rendering on it (the cached value defaults to false, which
  // is the safe-fail behaviour: a not-yet-ready flag dispatches to cloud).
  const [, setPrivacyReady] = useState(false);
  useEffect(() => {
    initPrivacyMode()
      .catch((error) => console.warn("initPrivacyMode failed", error))
      .finally(() => setPrivacyReady(true));
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface.app }}>
      <CareMindProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.surface.app }
          }}
        />
      </CareMindProvider>
    </GestureHandlerRootView>
  );
}
