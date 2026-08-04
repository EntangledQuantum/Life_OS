import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import type { TimelineBlock } from "@/lib/types";
import { activityColor, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { hourLabel } from "@/lib/format";

export function DayTimeline({ segments }: { segments: TimelineBlock[] }) {
  const t = useTokens();
  const [nowFrac, setNowFrac] = useState(nowFraction);

  useEffect(() => {
    const id = setInterval(() => setNowFrac(nowFraction()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!segments?.length) {
    return (
      <View
        style={{
          height: 30,
          borderRadius: radius.sm,
          backgroundColor: t.surface2,
          opacity: 0.6,
        }}
      />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          height: 30,
          borderRadius: radius.sm,
          overflow: "hidden",
          backgroundColor: t.surface2,
          borderCurve: "continuous",
        }}
      >
        {segments.map((seg) => {
          const left = (seg.startHour / 24) * 100;
          const width = Math.max(0.4, ((seg.endHour - seg.startHour) / 24) * 100);
          const done = seg.status === "done";
          return (
            <View
              key={seg.id}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                marginLeft: -0.2, // overdraw to hide subpixel seams
                height: "100%",
                backgroundColor:
                  seg.color || activityColor(seg.category, t.accent),
                opacity: done ? 0.5 : 1,
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
            backgroundColor: t.text,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: `${nowFrac * 100}%`,
            top: 0,
            bottom: 0,
            width: 10,
            marginLeft: -5,
            backgroundColor: rgba(t.text, 0.18),
          }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {[0, 6, 12, 18, 24].map((h) => (
          <Text
            key={h}
            style={{ color: t.faint, fontFamily: font.mono, fontSize: 10 }}
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
