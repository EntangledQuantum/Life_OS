import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { HabitWithToday } from "@/lib/types";
import { colors } from "@/lib/theme";

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
  const done = habit.completedToday;

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle();
      }}
      disabled={busy}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed || busy ? 0.75 : 1,
        borderCurve: "continuous",
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: done
            ? "rgba(52,211,153,0.18)"
            : "rgba(255,255,255,0.04)",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: done ? colors.positive : colors.border,
        }}
      >
        <Text style={{ fontSize: 16 }}>{done ? "✓" : habit.emoji}</Text>
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            color: colors.text,
            fontFamily: "Figtree_600SemiBold",
            fontSize: 15,
            textDecorationLine: done ? "line-through" : "none",
            opacity: done ? 0.7 : 1,
          }}
        >
          {habit.name}
        </Text>
        {habit.anchor ? (
          <Text
            style={{
              color: colors.faint,
              fontFamily: "Figtree_400Regular",
              fontSize: 12,
            }}
            numberOfLines={1}
          >
            {habit.anchor}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 3, marginTop: 4 }}>
          {(habit.history7 ?? []).map((v, i) => (
            <View
              key={i}
              style={{
                width: 8,
                height: 12,
                borderRadius: 2,
                backgroundColor: v
                  ? habit.themeColor || colors.positive
                  : "rgba(255,255,255,0.08)",
              }}
            />
          ))}
        </View>
      </View>

      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text
          style={{
            color: colors.positive,
            fontFamily: "JetBrainsMono_500Medium",
            fontSize: 12,
          }}
        >
          +{habit.baseXp + (habit.extraXp || 0)}
        </Text>
        {streaksEnabled && habit.currentStreak > 0 ? (
          <Text
            style={{
              color: colors.muted,
              fontFamily: "JetBrainsMono_500Medium",
              fontSize: 11,
            }}
          >
            🔥 {habit.currentStreak}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
