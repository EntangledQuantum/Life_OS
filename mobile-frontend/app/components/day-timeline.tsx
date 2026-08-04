import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import type { TimelineBlock } from "@/lib/types";
import { colors } from "@/lib/theme";
import { hourLabel } from "@/lib/format";

export function DayTimeline({ segments }: { segments: TimelineBlock[] }) {
  const [nowFrac, setNowFrac] = useState(nowFraction);

  useEffect(() => {
    const t = setInterval(() => setNowFrac(nowFraction()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!segments?.length) {
    return (
      <View
        style={{
          height: 28,
          borderRadius: 8,
          backgroundColor: colors.surface2,
          opacity: 0.6,
        }}
      />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          height: 28,
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: colors.surface2,
          position: "relative",
          borderCurve: "continuous",
        }}
      >
        {segments.map((seg) => {
          const left = (seg.startHour / 24) * 100;
          const width = Math.max(
            0.4,
            ((seg.endHour - seg.startHour) / 24) * 100,
          );
          const done = seg.status === "done";
          return (
            <View
              key={seg.id}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                // overdraw to hide subpixel seams
                marginLeft: -0.2,
                height: "100%",
                backgroundColor: seg.color || colors.muted,
                opacity: done ? 0.55 : 1,
              }}
            />
          );
        })}
        {/* now marker */}
        <View
          style={{
            position: "absolute",
            left: `${nowFrac * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            backgroundColor: colors.text,
            opacity: 0.9,
          }}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        {[0, 6, 12, 18, 24].map((h) => (
          <Text
            key={h}
            style={{
              color: colors.faint,
              fontFamily: "JetBrainsMono_500Medium",
              fontSize: 10,
            }}
          >
            {h === 24 ? "12am" : hourLabel(h)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function nowFraction(): number {
  const n = new Date();
  return (n.getHours() + n.getMinutes() / 60) / 24;
}
