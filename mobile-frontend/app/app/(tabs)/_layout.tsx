import { Tabs } from "expo-router";
import { TabBar } from "@/components/tab-bar";
import { font } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

/**
 * Screen order here is the left-to-right swipe order — keep it in sync with
 * `TAB_ROUTES` in `components/swipe-tabs.tsx`.
 */
export default function TabLayout() {
  const t = useTokens();

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerTitleStyle: { fontFamily: font.display, fontSize: 20 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.bg },
        animation: "shift",
      }}
    >
      <Tabs.Screen name="index" options={{ headerShown: false }} />
      <Tabs.Screen name="timeline" options={{ title: "Timeline" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      {/* hide template leftover if present */}
      <Tabs.Screen name="two" options={{ href: null }} />
    </Tabs>
  );
}
