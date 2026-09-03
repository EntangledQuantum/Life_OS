import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { ACTIVITIES, type Activity } from "@/lib/types";
import { ACTIVITY_COLORS, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { formatElapsed } from "@/lib/format";

const ICONS: Record<Activity, string> = {
  "Deep Work": "🎯",
  Study: "📖",
  Exercise: "🏃",
  Break: "☕",
  "Life Admin": "🗂",
  Sleep: "🌙",
  Exploration: "🔭",
};

/**
 * "Right now" is one line plus one button. The seven activity chips used to sit
 * permanently on the dashboard, which is a menu you have to re-read every time
 * you glance at your day — the opposite of what this app is for. They live in a
 * sheet behind an explicit Change now.
 */
export function ActivitySession({
  active,
  onSelect,
  onClear,
}: {
  active: { activity: string; startedAt: string } | null;
  onSelect: (a: Activity) => void;
  onClear: () => void;
}) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active?.startedAt) {
      setElapsed(0);
      return;
    }
    const start = new Date(active.startedAt).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active?.startedAt, active?.activity]);

  const tint = active
    ? (ACTIVITY_COLORS[active.activity as Activity] ?? t.accent)
    : t.faint;

  return (
    <>
      {/*
        Deliberately smaller than a habit row is tall.

        This is one fact about the day — what you are doing — and it was built
        at card scale: a 44pt tile, an 18pt title and a button the size of the
        tick on a habit. That put the least actionable thing on the screen at
        the top of the visual order, and made "Change" look like a completion
        control, which it is not. It is a strip now, and its button is a
        secondary one.
      */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: t.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: active ? rgba(tint, 0.35) : t.border,
          paddingVertical: 9,
          paddingHorizontal: 11,
          borderCurve: "continuous",
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            backgroundColor: rgba(tint, 0.16),
            alignItems: "center",
            justifyContent: "center",
            borderCurve: "continuous",
          }}
        >
          <Text style={{ fontSize: 15 }}>
            {active ? (ICONS[active.activity as Activity] ?? "◎") : "○"}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: t.faint, fontFamily: font.bodySemi, fontSize: 9, letterSpacing: 1.1 }}
          >
            RIGHT NOW
          </Text>
          <Text
            style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 14 }}
            numberOfLines={1}
          >
            {active?.activity ?? "Nothing running"}
          </Text>
        </View>

        {active ? (
          <Text
            style={{
              color: tint,
              fontFamily: font.mono,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatElapsed(elapsed)}
          </Text>
        ) : null}

        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setOpen(true);
          }}
          hitSlop={10}
          style={({ pressed }) => ({
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: radius.pill,
            backgroundColor: pressed ? t.accent : rgba(t.accent, 0.14),
            borderCurve: "continuous",
          })}
        >
          <Text style={{ color: t.accent, fontFamily: font.bodySemi, fontSize: 11 }}>
            {active ? "Change" : "Start"}
          </Text>
        </Pressable>
      </View>

      <ActivitySheet
        visible={open}
        current={active?.activity ?? null}
        onClose={() => setOpen(false)}
        onSelect={(a) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onSelect(a);
          setOpen(false);
        }}
        onClear={() => {
          onClear();
          setOpen(false);
        }}
      />
    </>
  );
}

function ActivitySheet({
  visible,
  current,
  onSelect,
  onClear,
  onClose,
}: {
  visible: boolean;
  current: string | null;
  onSelect: (a: Activity) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useTokens();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)" }}
        />
        <Animated.View
          entering={SlideInDown.duration(260)}
          style={{
            backgroundColor: t.bgLift,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: 1,
            borderColor: t.border,
            padding: 20,
            paddingBottom: 34,
            gap: 16,
            borderCurve: "continuous",
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: rgba(t.text, 0.2),
            }}
          />
          <Text style={{ color: t.text, fontFamily: font.display, fontSize: 22 }}>
            What are you doing?
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {ACTIVITIES.map((a) => {
              const on = current === a;
              const c = ACTIVITY_COLORS[a];
              return (
                <Pressable
                  key={a}
                  onPress={() => onSelect(a)}
                  style={({ pressed }) => ({
                    width: "47.5%",
                    flexGrow: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderRadius: radius.md,
                    backgroundColor: on ? rgba(c, 0.22) : t.surface,
                    borderWidth: 1,
                    borderColor: on ? c : t.border,
                    opacity: pressed ? 0.8 : 1,
                    borderCurve: "continuous",
                  })}
                >
                  <Text style={{ fontSize: 20 }}>{ICONS[a]}</Text>
                  <Text
                    style={{
                      color: on ? c : t.text,
                      fontFamily: font.bodySemi,
                      fontSize: 14,
                      flexShrink: 1,
                    }}
                  >
                    {a}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {current ? (
            <Pressable
              onPress={onClear}
              style={({ pressed }) => ({
                alignItems: "center",
                paddingVertical: 13,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: t.border,
                opacity: pressed ? 0.7 : 1,
                borderCurve: "continuous",
              })}
            >
              <Text style={{ color: t.muted, fontFamily: font.bodySemi, fontSize: 14 }}>
                Stop session
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
