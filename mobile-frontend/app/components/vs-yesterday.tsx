import { Text, View } from "react-native";
import type { VsYesterday } from "@/lib/types";
import { colors, deltaColor } from "@/lib/theme";
import { formatDelta } from "@/lib/format";

export function VsYesterdayRow({ vs }: { vs: VsYesterday }) {
  const items = [
    { label: "Habits", today: vs.habitsCompleted.today, delta: vs.habitsCompleted.delta },
    { label: "XP", today: vs.xpEarned.today, delta: vs.xpEarned.delta },
    {
      label: "Eff %",
      today: Math.round(vs.efficiency.today),
      delta: Math.round(vs.efficiency.delta),
    },
    { label: "Study", today: vs.studyMinutes.today, delta: vs.studyMinutes.delta },
    {
      label: "Sleep",
      today: vs.sleepScore.today ?? "—",
      delta: vs.sleepScore.delta,
    },
  ];

  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {items.map((it) => (
        <View
          key={it.label}
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 10,
            borderCurve: "continuous",
          }}
        >
          <Text
            style={{
              color: colors.faint,
              fontFamily: "Figtree_500Medium",
              fontSize: 10,
            }}
          >
            {it.label}
          </Text>
          <Text
            style={{
              color: colors.text,
              fontFamily: "JetBrainsMono_600SemiBold",
              fontSize: 16,
              marginTop: 2,
              fontVariant: ["tabular-nums"],
            }}
          >
            {it.today}
          </Text>
          {typeof it.delta === "number" ? (
            <Text
              style={{
                color: deltaColor(it.delta),
                fontFamily: "JetBrainsMono_500Medium",
                fontSize: 11,
                marginTop: 2,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatDelta(it.delta)}
            </Text>
          ) : (
            <Text style={{ color: colors.faint, fontSize: 11, marginTop: 2 }}>—</Text>
          )}
        </View>
      ))}
    </View>
  );
}
