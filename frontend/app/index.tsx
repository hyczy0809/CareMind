import { Redirect } from "expo-router";
import { OnboardingScreen } from "../components/onboarding/OnboardingScreen";
import { useCareMind } from "../lib/caremind-store";

export default function IndexScreen() {
  const { hydrated, onboardingCompleted } = useCareMind();

  if (!hydrated) {
    return null;
  }

  if (onboardingCompleted) {
    return <Redirect href="/(tabs)/today" />;
  }

  return <OnboardingScreen />;
}
