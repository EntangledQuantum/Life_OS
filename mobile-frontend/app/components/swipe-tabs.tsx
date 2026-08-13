import { useMemo, useRef, type ReactNode } from "react";
import { PanResponder, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";

/** Left-to-right tab order. Must match the order in `app/(tabs)/_layout.tsx`. */
export const TAB_ROUTES = [
  "/(tabs)",
  "/(tabs)/timeline",
  "/(tabs)/study",
  "/(tabs)/goals",
  "/(tabs)/settings",
] as const;

export const TAB_COUNT = TAB_ROUTES.length;

/**
 * Horizontal swipe between tabs, on top of the vertical scrolling each screen
 * already does.
 *
 * Built on PanResponder rather than a pager: the responder is only claimed once
 * a gesture is clearly horizontal (twice as much x as y, past a threshold), so
 * the ScrollView underneath keeps every vertical drag. Dragging also moves the
 * screen a little, because a swipe with no feedback feels broken.
 */
export function SwipeTabs({
  index,
  children,
  enabled = true,
}: {
  index: number;
  children: ReactNode;
  enabled?: boolean;
}) {
  const router = useRouter();
  const t = useTokens();
  const { width, wide } = useLayout();
  const drag = useSharedValue(0);
  // Guards against a second navigation while the first is still settling.
  const navigating = useRef(false);
  /**
   * Harder to trigger on a large screen: the rail is already showing every tab,
   * so a horizontal drag there is far more likely to be a stray thumb than an
   * attempt to navigate.
   */
  const claim = wide ? 40 : 18;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          enabled &&
          Math.abs(g.dx) > claim &&
          Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderMove: (_e, g) => {
          const atEdge =
            (g.dx > 0 && index === 0) || (g.dx < 0 && index === TAB_COUNT - 1);
          // Rubber-band at the ends so it's obvious there's nothing there.
          drag.value = atEdge ? g.dx * 0.18 : g.dx * 0.35;
        },
        onPanResponderRelease: (_e, g) => {
          const far = Math.abs(g.dx) > width * 0.22;
          const fast = Math.abs(g.vx) > 0.45 && Math.abs(g.dx) > 40;
          const dir = g.dx < 0 ? 1 : -1;
          const next = index + dir;

          if ((far || fast) && next >= 0 && next < TAB_COUNT && !navigating.current) {
            navigating.current = true;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            drag.value = withTiming(dir * -width * 0.12, { duration: 120 }, () => {
              drag.value = 0;
            });
            router.navigate(TAB_ROUTES[next]);
            setTimeout(() => {
              navigating.current = false;
            }, 350);
          } else {
            drag.value = withSpring(0, { damping: 20, stiffness: 180 });
          }
        },
        onPanResponderTerminate: () => {
          drag.value = withSpring(0, { damping: 20, stiffness: 180 });
        },
      }),
    [enabled, index, width, claim, router, drag],
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} {...responder.panHandlers}>
      <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
    </View>
  );
}
