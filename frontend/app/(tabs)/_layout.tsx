import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { ClipboardList, FileText, Home } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { colors } from "../../lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700"
        },
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFill} />
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "今日照护",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: "智能记录",
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="follow-up"
        options={{
          title: "复诊准备",
          tabBarIcon: ({ color, size }) => <FileText color={color} size={size} />
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    minHeight: 64,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: "rgba(255,255,255,0.86)",
    position: "absolute"
  }
});
