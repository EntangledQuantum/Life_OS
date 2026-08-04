import { ScrollView, Text, View } from "react-native";
import type { VsYesterday } from "@/lib/types";
import { deltaColor, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { formatDelta } from "@/lib/format";

/**
 * Five columns squeezed across a phone is unreadable. A scrolling strip of
 * pills keeps each number legible and lets the row breathe.
 */
export function VsYesterdayRow({ vs }: { vs: VsYesterday }) {
  const t = useTokens();

  const items = [
    { label: "Habits", today: vs.habitsCompleted.today, delta: vs.habitsCompleted.delta },
    { label: "XP", today: vs.xpEarned.today, delta: vs.xpEarned.delta },
    {
      label: "Eff %",
      today: Math.round(vs.efficiency.today),
      delta: Math.round(vs.efficiency.delta),
    },
    { label: "Study", today: vs.studyMinutes.today, delta: vs.studyMinutes.delta },
    { label: "Sleep", today: vs.sleepScore.today ?? "—", delta: vs.sleepScore.delta },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
    >
      {items.map((it) => {
        const dc =
          typeof it.delta === "number" ? deltaColor(it.delta, t) : t.faint;
        return (
          <View
            key={it.label}
            style={{
              minWidth: 84,
              backgroundColor: t.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: t.border,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderCurve: "continuous",
            }}
          >
            <Text style={{ color: t.faint, fontFamily: font.bodyMedium, fontSize: 11 }}>
              {it.label}
            </Text>
            <Text
              style={{
                color: t.text,
                fontFamily: font.monoBold,
                fontSize: 19,
                marginTop: 3,
                fontVariant: ["tabular-nums"],
              }}
            >
              {it.today}
            </Text>
            <View
              style={{
                alignSelf: "flex-start",
                marginTop: 5,
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: radius.pill,
                backgroundColor: rgba(dc, 0.14),
              }}
            >
              <Text
                style={{
                  color: dc,
                  fontFamily: font.mono,
                  fontSize: 10,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {typeof it.delta === "number" ? formatDelta(it.delta) : "—"}
              </Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
