import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
} from "react-native-reanimated";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

/**
 * Structural typing instead of importing `BottomTabBarProps` — the tab
 * navigator is a transitive dependency of expo-router and not one this app
 * declares, so we do not import its types either.
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (event: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
  };
}

const TABS = [
  { name: "index", label: "Today", icon: "◉" },
  { name: "timeline", label: "Timeline", icon: "⌗" },
  { name: "goals", label: "Goals", icon: "◈" },
  { name: "settings", label: "Settings", icon: "⚙" },
] as const;

export function TabBar({ state, navigation }: TabBarProps) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);

  // Which of OUR tabs is showing — route order in `state` may include hidden ones.
  const activeName = state.routes[state.index]?.name;
  const active = Math.max(
    0,
    TABS.findIndex((x) => x.name === activeName),
  );

  const slot = width / TABS.length;
  const x = useDerivedValue(() =>
    withSpring(active * slot, { damping: 18, stiffness: 190 }),
  );
  const pill = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: slot,
  }));

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        backgroundColor: t.bgLift,
        borderTopWidth: 1,
        borderTopColor: t.border,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", top: 6, bottom: 0, alignItems: "center" }, pill]}
        >
          <View
            style={{
              width: 44,
              height: 3,
              borderRadius: 2,
              backgroundColor: t.accent,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: -4,
              width: 60,
              height: 22,
              borderRadius: radius.pill,
              backgroundColor: rgba(t.accent, 0.16),
            }}
          />
        </Animated.View>
      ) : null}

      {TABS.map((tab, i) => {
        const focused = i === active;
        const route = state.routes.find((r) => r.name === tab.name);
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            onPress={() => {
              if (!route) return;
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (focused || event.defaultPrevented) return;
              void Haptics.selectionAsync();
              navigation.navigate(tab.name);
            }}
            style={{ flex: 1, alignItems: "center", gap: 3, paddingTop: 10 }}
          >
            <Text style={{ fontSize: 17, color: focused ? t.accent : t.faint }}>
              {tab.icon}
            </Text>
            <Text
              style={{
                fontFamily: focused ? font.bodySemi : font.bodyMedium,
                fontSize: 11,
                color: focused ? t.text : t.faint,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
