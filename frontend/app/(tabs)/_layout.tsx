import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { ClipboardList, FileText, Home } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../lib/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 18);
  const tabBarHeight = 62 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700"
        },
        tabBarItemStyle: styles.tabBarItem,
        tabBarStyle: [
          styles.tabBar,
          {
            height: tabBarHeight,
            paddingBottom: bottomPadding
          }
        ],
        tabBarBackground: () => <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFill} />
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
    minHeight: 82,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,249,0.92)",
    position: "absolute",
    shadowColor: "#3A2D23",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 12
  },
  tabBarItem: {
    minHeight: 56,
    paddingTop: 4
  }
});
