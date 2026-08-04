import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors, accentColor } from "@/lib/theme";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const map: Record<string, string> = {
    Today: "◎",
    Timeline: "☰",
    Goals: "◇",
    Settings: "⚙",
  };
  return (
    <Text
      style={{
        fontSize: 18,
        color: focused ? accentColor("nebula") : colors.faint,
        marginBottom: -2,
      }}
    >
      {map[label] ?? "·"}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: "Figtree_600SemiBold",
          fontSize: 17,
        },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: accentColor("nebula"),
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: {
          fontFamily: "Figtree_500Medium",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Today" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: "Timeline",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Timeline" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Goals" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Settings" focused={focused} />
          ),
        }}
      />
      {/* hide template leftover if present */}
      <Tabs.Screen name="two" options={{ href: null }} />
    </Tabs>
  );
}
