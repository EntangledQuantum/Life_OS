import { Tabs } from "expo-router";
import { TabBar } from "@/components/tab-bar";
import { font } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";

/**
 * Screen order here is the left-to-right swipe order — keep it in sync with
 * `TAB_ROUTES` in `components/swipe-tabs.tsx`.
 */
export default function TabLayout() {
  const t = useTokens();
  const { wide } = useLayout();

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
        /*
         * From `medium` up the bar becomes a left rail. The navigator reads
         * this to switch its own container to a row and render the bar first;
         * `components/tab-bar.tsx` changes shape to match.
         */
        tabBarPosition: wide ? "left" : "bottom",
      }}
    >
      <Tabs.Screen name="index" options={{ headerShown: false }} />
      <Tabs.Screen name="timeline" options={{ title: "Timeline" }} />
      <Tabs.Screen name="study" options={{ title: "Study" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
      <Tabs.Screen name="analytics" options={{ title: "Analytics" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      {/* hide template leftover if present */}
      <Tabs.Screen name="two" options={{ href: null }} />
    </Tabs>
  );
}
