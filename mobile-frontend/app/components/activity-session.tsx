import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ACTIVITIES, type Activity } from "@/lib/types";
import { colors, accentColor } from "@/lib/theme";
import { formatElapsed } from "@/lib/format";
import type { AccentThemeId } from "@/lib/types";

export function ActivitySession({
  active,
  theme = "nebula",
  onSelect,
  onClear,
}: {
  active: { activity: string; startedAt: string } | null;
  theme?: AccentThemeId;
  onSelect: (a: Activity) => void;
  onClear: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const accent = accentColor(theme);

  useEffect(() => {
    if (!active?.startedAt) {
      setElapsed(0);
      return;
    }
    const start = new Date(active.startedAt).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [active?.startedAt, active?.activity]);

  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
          borderCurve: "continuous",
        }}
      >
        <Text
          style={{
            color: colors.faint,
            fontFamily: "Figtree_600SemiBold",
            fontSize: 11,
            letterSpacing: 0.8,
          }}
        >
          RIGHT NOW
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: "Figtree_700Bold",
              fontSize: 20,
            }}
          >
            {active?.activity ?? "Nothing running"}
          </Text>
          {active ? (
            <Text
              style={{
                color: accent,
                fontFamily: "JetBrainsMono_600SemiBold",
                fontSize: 18,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatElapsed(elapsed)}
            </Text>
          ) : null}
        </View>
        {active ? (
          <Pressable onPress={onClear} style={{ marginTop: 10 }}>
            <Text
              style={{
                color: colors.muted,
                fontFamily: "Figtree_500Medium",
                fontSize: 13,
              }}
            >
              Stop session
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {ACTIVITIES.map((a) => {
          const on = active?.activity === a;
          return (
            <Pressable
              key={a}
              onPress={() => onSelect(a)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: on ? accent : colors.surface2,
                borderCurve: "continuous",
              }}
            >
              <Text
                style={{
                  color: on ? colors.background : colors.muted,
                  fontFamily: "Figtree_600SemiBold",
                  fontSize: 12,
                }}
              >
                {a}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
