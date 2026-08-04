import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { HabitWithToday } from "@/lib/types";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

export function HabitRow({
  habit,
  streaksEnabled = true,
  onToggle,
  busy,
}: {
  habit: HabitWithToday;
  streaksEnabled?: boolean;
  onToggle: () => void;
  busy?: boolean;
}) {
  const t = useTokens();
  const done = habit.completedToday;
  const tint = habit.themeColor || t.accent;

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(
          done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
        );
        onToggle();
      }}
      disabled={busy}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        backgroundColor: done ? rgba(t.positive, 0.07) : t.surface,
        borderWidth: 1,
        borderColor: done ? rgba(t.positive, 0.28) : t.border,
        opacity: busy ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        borderCurve: "continuous",
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: radius.sm + 2,
          backgroundColor: done ? rgba(t.positive, 0.18) : rgba(tint, 0.1),
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: done ? t.positive : t.border,
          borderCurve: "continuous",
        }}
      >
        <Text style={{ fontSize: 17, color: t.positive }}>
          {done ? "✓" : habit.emoji}
        </Text>
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            color: done ? t.muted : t.text,
            fontFamily: font.bodySemi,
            fontSize: 15,
            textDecorationLine: done ? "line-through" : "none",
          }}
          numberOfLines={1}
        >
          {habit.name}
        </Text>
        {habit.anchor ? (
          <Text
            style={{ color: t.faint, fontFamily: font.body, fontSize: 12 }}
            numberOfLines={1}
          >
            {habit.anchor}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 3, marginTop: 3 }}>
          {(habit.history7 ?? []).map((v, i) => (
            <View
              key={i}
              style={{
                width: 9,
                height: 4,
                borderRadius: 2,
                backgroundColor: v ? tint : rgba(t.text, 0.08),
              }}
            />
          ))}
        </View>
      </View>

      <View style={{ alignItems: "flex-end", gap: 3 }}>
        <Text style={{ color: t.positive, fontFamily: font.mono, fontSize: 12 }}>
          +{habit.baseXp + (habit.extraXp || 0)}
        </Text>
        {streaksEnabled && habit.currentStreak > 0 ? (
          <Text style={{ color: t.muted, fontFamily: font.mono, fontSize: 11 }}>
            🔥 {habit.currentStreak}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
