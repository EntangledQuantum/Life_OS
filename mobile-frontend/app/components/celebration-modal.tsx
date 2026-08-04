import { useEffect, useMemo } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import type { Goal } from "@/lib/types";
import { font, radius, rgba, type Tokens } from "@/lib/theme";
import { useTheme } from "@/lib/theme-provider";

/**
 * Full-screen and unmissable. `celebration-seen` fires ONLY when the user taps
 * through — the goal is not finished until they have watched it finish
 * (CLIENT_GUIDE §4.2). Never auto-dismiss, never dismiss on backdrop tap.
 */
export function CelebrationModal({
  goal,
  intensity = "full",
  reducedMotion = false,
  onDismiss,
}: {
  goal: Goal | null;
  intensity?: "full" | "minimal" | "off";
  reducedMotion?: boolean;
  onDismiss: () => void;
}) {
  const { t, osReducedMotion } = useTheme();
  const reduce = reducedMotion || osReducedMotion;
  const { width, height } = useWindowDimensions();

  const pop = useSharedValue(0);
  const float = useSharedValue(0);

  useEffect(() => {
    if (!goal || intensity === "off") return;
    if (!reduce) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    pop.value = 0;
    pop.value = reduce
      ? withTiming(1, { duration: 180 })
      : withSpring(1, { damping: 9, stiffness: 130, mass: 0.8 });
    float.value = reduce
      ? 0
      : withRepeat(
          withSequence(
            withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          false,
        );
  }, [goal, intensity, reduce, pop, float]);

  const emojiStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [
      { scale: 0.4 + pop.value * 0.6 },
      { translateY: (0.5 - float.value) * 10 },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: pop.value * (0.5 + float.value * 0.4),
    transform: [{ scale: 0.8 + pop.value * 0.2 + float.value * 0.05 }],
  }));

  if (!goal || intensity === "off") return null;
  const loud = intensity === "full";

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.94)",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        }}
      >
        {/* halo */}
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute" }, ringStyle]}
        >
          <Svg width={width} height={width}>
            <Defs>
              <RadialGradient id="cel-halo" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={t.accent} stopOpacity="0.4" />
                <Stop offset="55%" stopColor={t.accent2} stopOpacity="0.14" />
                <Stop offset="100%" stopColor={t.accent2} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx={width / 2} cy={width / 2} r={width / 2} fill="url(#cel-halo)" />
          </Svg>
        </Animated.View>

        {loud && !reduce ? <Confetti width={width} height={height} t={t} /> : null}

        <Animated.Text style={[{ fontSize: loud ? 92 : 56 }, emojiStyle]}>
          {goal.emoji || "🎯"}
        </Animated.Text>

        <Animated.View
          entering={reduce ? undefined : FadeIn.delay(220).duration(400)}
          style={{ alignItems: "center" }}
        >
          <Text
            style={{
              marginTop: 20,
              color: t.accent,
              fontFamily: font.bodySemi,
              fontSize: 12,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            Goal complete
          </Text>
          <Text
            style={{
              marginTop: 12,
              color: t.text,
              fontFamily: font.display,
              fontSize: 32,
              lineHeight: 38,
              textAlign: "center",
              letterSpacing: -0.5,
            }}
          >
            {goal.title}
          </Text>
          {goal.whyItMatters ? (
            <Text
              style={{
                marginTop: 14,
                color: t.muted,
                fontFamily: font.body,
                fontSize: 15,
                lineHeight: 23,
                textAlign: "center",
                maxWidth: 320,
              }}
            >
              {goal.whyItMatters}
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View entering={reduce ? undefined : FadeIn.delay(600).duration(400)}>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onDismiss();
            }}
            style={({ pressed }) => ({
              marginTop: 40,
              backgroundColor: t.accent,
              paddingHorizontal: 34,
              paddingVertical: 15,
              borderRadius: radius.md,
              borderCurve: "continuous",
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Text
              style={{ color: t.onAccent, fontFamily: font.display, fontSize: 16 }}
            >
              I saw it
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------- confetti */

const PIECES = 18;

function Confetti({
  width,
  height,
  t,
}: {
  width: number;
  height: number;
  t: Tokens;
}) {
  const palette = useMemo(
    () => [t.accent, t.accent2, t.positive, t.warning, t.text],
    [t],
  );
  return (
    <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: PIECES }, (_, i) => (
        <Piece
          key={i}
          index={i}
          x={((i * 37) % 100) / 100 * width}
          height={height}
          color={palette[i % palette.length]}
        />
      ))}
    </View>
  );
}

function Piece({
  index,
  x,
  height,
  color,
}: {
  index: number;
  x: number;
  height: number;
  color: string;
}) {
  const p = useSharedValue(0);
  const spin = 180 + (index % 5) * 220;
  const drift = ((index % 7) - 3) * 22;

  useEffect(() => {
    p.value = withDelay(
      index * 110,
      withRepeat(
        withTiming(1, { duration: 3600 + (index % 4) * 700, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, [p, index]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: -60 + p.value * (height + 120) },
      { translateX: Math.sin(p.value * Math.PI * 2) * drift },
      { rotate: `${p.value * spin}deg` },
    ],
    opacity: p.value > 0.85 ? (1 - p.value) * 6.6 : 1,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: x,
          top: 0,
          width: 7,
          height: 11,
          borderRadius: 2,
          backgroundColor: rgba(color, 0.9),
        },
        style,
      ]}
    />
  );
}
