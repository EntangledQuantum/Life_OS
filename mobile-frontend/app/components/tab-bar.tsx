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
import { useLayout } from "@/lib/responsive";

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

const RAIL_WIDTH = 104;

/**
 * One bar, two shapes. On a phone it is the bottom bar; from `medium` up it
 * becomes a left rail, which is what an iPad expects and what stops four tabs
 * from sitting marooned across 1300pt of edge.
 *
 * `app/(tabs)/_layout.tsx` sets `tabBarPosition` to match — that is what turns
 * the navigator's own container into a row and renders this first.
 */
export function TabBar({ state, navigation }: TabBarProps) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { wide } = useLayout();
  const [span, setSpan] = useState(0);
  const railTop = insets.top + 12;
  const railBottom = Math.max(insets.bottom, 12);

  // Which of OUR tabs is showing — route order in `state` may include hidden ones.
  const activeName = state.routes[state.index]?.name;
  const active = Math.max(
    0,
    TABS.findIndex((x) => x.name === activeName),
  );

  const slot = span / TABS.length;
  const offset = useDerivedValue(() =>
    withSpring(active * slot, { damping: 18, stiffness: 190 }),
  );
  const pill = useAnimatedStyle(() =>
    wide
      ? { transform: [{ translateY: offset.value }], height: slot }
      : { transform: [{ translateX: offset.value }], width: slot },
  );

  const onPress = (tab: (typeof TABS)[number], i: number) => {
    const route = state.routes.find((r) => r.name === tab.name);
    if (!route) return;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (i === active || event.defaultPrevented) return;
    void Haptics.selectionAsync();
    navigation.navigate(tab.name);
  };

  return (
    <View
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        // The tabs are flex children *inside* the padding, so the pill has to
        // travel the content box, not the whole bar.
        setSpan(wide ? height - railTop - railBottom : width);
      }}
      style={
        wide
          ? {
              width: RAIL_WIDTH + insets.left,
              backgroundColor: t.bgLift,
              borderRightWidth: 1,
              borderRightColor: t.border,
              paddingLeft: insets.left,
              paddingTop: railTop,
              paddingBottom: railBottom,
            }
          : {
              flexDirection: "row",
              backgroundColor: t.bgLift,
              borderTopWidth: 1,
              borderTopColor: t.border,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 10),
            }
      }
    >
      {span > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            wide
              ? {
                  position: "absolute",
                  left: insets.left,
                  right: 0,
                  top: railTop,
                  justifyContent: "center",
                }
              : { position: "absolute", top: 6, bottom: 0, alignItems: "center" },
            pill,
          ]}
        >
          {wide ? (
            <>
              {/* the marker hugs the content edge, the way a sidebar does */}
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  width: 3,
                  height: 30,
                  borderTopRightRadius: 2,
                  borderBottomRightRadius: 2,
                  backgroundColor: t.accent,
                }}
              />
              <View
                style={{
                  alignSelf: "center",
                  width: 62,
                  height: 46,
                  borderRadius: radius.md,
                  backgroundColor: rgba(t.accent, 0.16),
                }}
              />
            </>
          ) : (
            <>
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
            </>
          )}
        </Animated.View>
      ) : null}

      {TABS.map((tab, i) => {
        const focused = i === active;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            onPress={() => onPress(tab, i)}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: wide ? 5 : 3,
              paddingTop: wide ? 0 : 10,
            }}
          >
            <Text
              style={{
                fontSize: wide ? 21 : 17,
                color: focused ? t.accent : t.faint,
              }}
            >
              {tab.icon}
            </Text>
            <Text
              style={{
                fontFamily: focused ? font.bodySemi : font.bodyMedium,
                fontSize: wide ? 12 : 11,
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
