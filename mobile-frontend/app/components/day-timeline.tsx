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

  /**
   * One swatch per distinct category, in the order they first appear. Without
   * this the ribbon is a row of unexplained colours — the web client has always
   * had a key and the phone never did.
   */
  const legend = [
    ...new Map(
      segments.map((s) => [
        s.category,
        s.color || activityColor(s.category, t.accent),
      ]),
    ).entries(),
  ];

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
          const color = seg.color || activityColor(seg.category, t.accent);
          const done = seg.status === "done";
          /*
           * Behind the now-marker the ribbon is what you actually did, painted
           * solid. Ahead of it it is only the plan, so it is drawn as a faint
           * tint with an outline — the two must never look alike, or the day
           * reads as already lived.
           */
          return (
            <View
              key={seg.id}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                marginLeft: -0.2, // overdraw to hide subpixel seams
                height: "100%",
                backgroundColor: seg.actual ? color : rgba(color, 0.18),
                borderTopWidth: seg.actual ? 0 : 1,
                borderBottomWidth: seg.actual ? 0 : 1,
                borderColor: rgba(color, 0.5),
                opacity: seg.actual && done ? 0.6 : 1,
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

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
        {legend.map(([category, color]) => (
          <View
            key={category}
            style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: color,
              }}
            />
            <Text
              style={{ color: t.muted, fontFamily: font.bodyMedium, fontSize: 11 }}
            >
              {category}
            </Text>
          </View>
        ))}
      </View>

      <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 10 }}>
        Solid is what you did · outlined is planned
      </Text>
    </View>
  );
}

function nowFraction(): number {
  const n = new Date();
  return (n.getHours() + n.getMinutes() / 60) / 24;
}
