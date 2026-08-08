import { useState } from "react";
import { Text, View } from "react-native";
import type { UserProgress, VsYesterday } from "@/lib/types";
import { deltaColor, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import { formatDelta } from "@/lib/format";
import { GrowthMeter, type CelebrationIntensity } from "./growth-meter";

/** How big the meter is allowed to get, per window size class. */
const METER_CAP = { compact: 248, medium: 300, expanded: 360 } as const;

/**
 * The whole point of the phone screen: the meter is big and central, and the
 * day's four numbers sit in the corners around it. A circle leaves its corners
 * empty — this is what they are for.
 */
export function GrowthHero({
  progress,
  vs,
  reducedMotion = false,
  celebrationIntensity = "full",
}: {
  progress: UserProgress;
  vs: VsYesterday;
  reducedMotion?: boolean;
  celebrationIntensity?: CelebrationIntensity;
}) {
  const t = useTokens();
  const { width, sizeClass } = useLayout();
  /**
   * Measured, not derived from the window: on a tablet this component sits in
   * one pane of a two-pane layout and the window width says nothing about how
   * much room it actually has.
   */
  const [measured, setMeasured] = useState(0);
  const avail = measured || width - 36;

  // Leave room for a stat block on each side, but never go tiny.
  const meter = Math.max(176, Math.min(METER_CAP[sizeClass], avail - 150));
  const box = meter + (sizeClass === "compact" ? 62 : 84);
  const remainder = Math.max(0, progress.dailyXpTarget - progress.dailyXp);
  const full = progress.efficiencyPct >= 100;

  return (
    <View
      style={{ alignItems: "center", gap: 14 }}
      onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
    >
      {/*
       * Capped, not full-width. The four stats are pinned to the left and right
       * edges of this box; without a cap they fly to the far edges of a tablet
       * window and stop reading as belonging to the meter at all.
       */}
      <View
        style={{
          width: "100%",
          maxWidth: meter + 260,
          height: box,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <GrowthMeter
          efficiencyPct={progress.efficiencyPct}
          style={progress.growthStyle ?? "sprout"}
          size={meter}
          reducedMotion={reducedMotion}
          celebrationIntensity={celebrationIntensity}
        />

        <Corner pos="tl" label="XP" value={vs.xpEarned.today} delta={vs.xpEarned.delta} />
        <Corner
          pos="tr"
          label="Habits"
          value={vs.habitsCompleted.today}
          delta={vs.habitsCompleted.delta}
        />
        <Corner
          pos="bl"
          label="Study"
          value={`${vs.studyMinutes.today}m`}
          delta={vs.studyMinutes.delta}
        />
        <Corner
          pos="br"
          label="Sleep"
          value={vs.sleepScore.today ?? "—"}
          delta={vs.sleepScore.delta}
        />
      </View>

      {/* the XP line the meter is actually filling with */}
      <View style={{ width: "100%", maxWidth: meter + 260, gap: 7 }}>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: rgba(t.text, 0.07),
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.min(100, progress.efficiencyPct)}%`,
              height: "100%",
              borderRadius: 3,
              backgroundColor: t.accent,
            }}
          />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text
            style={{
              color: t.muted,
              fontFamily: font.mono,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
            }}
          >
            {progress.dailyXp} / {progress.dailyXpTarget} XP
          </Text>
          <Text
            style={{
              color: full ? t.accent : t.faint,
              fontFamily: font.mono,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
            }}
          >
            {full ? "bonus XP still counts" : `${remainder} to go`}
          </Text>
        </View>
      </View>
    </View>
  );
}

type Pos = "tl" | "tr" | "bl" | "br";

function Corner({
  pos,
  label,
  value,
  delta,
}: {
  pos: Pos;
  label: string;
  value: string | number;
  delta: number | null;
}) {
  const t = useTokens();
  const right = pos === "tr" || pos === "br";
  const bottom = pos === "bl" || pos === "br";
  const dc = typeof delta === "number" ? deltaColor(delta, t) : t.faint;

  return (
    <View
      style={{
        position: "absolute",
        [right ? "right" : "left"]: 0,
        [bottom ? "bottom" : "top"]: 0,
        alignItems: right ? "flex-end" : "flex-start",
        gap: 2,
        minWidth: 62,
      }}
    >
      <Text style={{ color: t.faint, fontFamily: font.bodySemi, fontSize: 10, letterSpacing: 0.9 }}>
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          color: t.text,
          fontFamily: font.monoBold,
          fontSize: 19,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      {typeof delta === "number" ? (
        <View
          style={{
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
            {formatDelta(delta)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
