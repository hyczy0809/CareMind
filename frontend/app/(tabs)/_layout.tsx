import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { ClipboardList, FileText, Home } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../lib/theme";

function TabIcon({
  focused,
  color,
  children
}: {
  focused: boolean;
  color: string;
  children: (color: string, size: number) => ReactNode;
}) {
  return (
    <View style={[styles.iconBubble, focused && styles.iconBubbleActive]}>
      {children(color, focused ? 22 : 21)}
    </View>
  );
}

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
          fontWeight: "700",
          marginTop: 2
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
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} color={color}>
              {(iconColor, size) => <Home color={iconColor} size={size} />}
            </TabIcon>
          )
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: "智能记录",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} color={color}>
              {(iconColor, size) => <ClipboardList color={iconColor} size={size} />}
            </TabIcon>
          )
        }}
      />
      <Tabs.Screen
        name="follow-up"
        options={{
          title: "复诊准备",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused} color={color}>
              {(iconColor, size) => <FileText color={iconColor} size={size} />}
            </TabIcon>
          )
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    minHeight: 82,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,248,0.94)",
    position: "absolute",
    shadowColor: "#7A5B42",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 12
  },
  tabBarItem: {
    minHeight: 56,
    paddingTop: 4
  },
  iconBubble: {
    width: 38,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center"
  },
  iconBubbleActive: {
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: "#CFE4D2"
  }
});
