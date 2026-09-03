import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Path,
  Polyline,
  RadialGradient,
  Stop,
  Text as SvgText,
  TSpan,
} from "react-native-svg";
import { useTokens } from "@/lib/theme-provider";
import { constellationGeometry, seedFrom } from "@/lib/journey";
import { font } from "@/lib/theme";
import type { HabitWithToday } from "@/lib/types";

/**
 * Your habits as a sky, assembling itself over the day — the phone's copy.
 *
 * A star per habit on a golden-angle spiral, because a ring of eight reads as a
 * clock face and this should read as a sky. Closing a habit lights its star and
 * extends the line from the last one lit, so the figure is drawn by the day
 * rather than revealed at the end of it. The dust behind is the weeks already
 * kept — the only part of the picture that rewards months rather than hours.
 *
 * Finish and the line **closes** back to the first star. That is the arrival.
 *
 * Identical to `apps/web/src/components/graphics/Constellation.tsx` in
 * everything but the primitives; the numbers come from `lib/journey.ts`, which
 * is the same maths. No filters — see the note in that file.
 */
export function Constellation({
  efficiencyPct,
  habits,
  history,
  size = 260,
}: {
  efficiencyPct: number;
  habits: HabitWithToday[];
  history: number[];
  size?: number;
}) {
  const t = useTokens();

  const geo = useMemo(
    () =>
      constellationGeometry({
        efficiencyPct,
        habits: habits.map((h) => ({
          id: h.id,
          done: h.completedToday,
          color: h.themeColor || t.accent,
          weight: h.xpWeight,
        })),
        history,
        seed: seedFrom(habits.map((h) => h.id).join("")),
      }),
    [efficiencyPct, habits, history, t.accent],
  );

  const { feel } = geo;
  const line = geo.trail.map((p) => `${p.x},${p.y}`).join(" ");
  const last = geo.trail[geo.trail.length - 1];
  const first = geo.trail[0];
  const closing =
    geo.closes && last && first ? `${last.x},${last.y} ${first.x},${first.y}` : null;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${geo.size} ${geo.size}`}>
        <Defs>
          <RadialGradient id="cn-wash" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={t.accent} stopOpacity={0.05 + feel.glow * 0.3} />
            <Stop offset="55%" stopColor={t.accent} stopOpacity={0.03 + feel.glow * 0.1} />
            <Stop offset="100%" stopColor={t.accent} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="cn-star" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
            <Stop offset="40%" stopColor="#ffffff" stopOpacity={0.25} />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Circle cx={geo.centre} cy={geo.centre} r={geo.size * 0.5} fill="url(#cn-wash)" />

        {geo.field.map((d, i) => (
          <Circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill={t.muted} opacity={d.o} />
        ))}

        {geo.trail.length > 1 ? (
          <Polyline
            points={line}
            fill="none"
            stroke={t.accent}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.35 + feel.glow * 0.45}
          />
        ) : null}

        {closing ? (
          <Polyline
            points={closing}
            fill="none"
            stroke={t.accent}
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.85}
          />
        ) : null}

        {geo.stars.map((star) => (
          <React.Fragment key={star.id}>
            {star.lit ? (
              <>
                <Circle
                  cx={star.x}
                  cy={star.y}
                  r={star.r * 4.5}
                  fill="url(#cn-star)"
                  opacity={0.35 + feel.glow * 0.4}
                />
                <Path
                  d={`M ${star.x} ${star.y - star.r * 3.2} L ${star.x + star.r * 0.7} ${star.y} L ${star.x} ${star.y + star.r * 3.2} L ${star.x - star.r * 0.7} ${star.y} Z`}
                  fill={star.color}
                  opacity={0.5 + feel.glow * 0.3}
                />
                <Path
                  d={`M ${star.x - star.r * 3.2} ${star.y} L ${star.x} ${star.y - star.r * 0.7} L ${star.x + star.r * 3.2} ${star.y} L ${star.x} ${star.y + star.r * 0.7} Z`}
                  fill={star.color}
                  opacity={0.5 + feel.glow * 0.3}
                />
              </>
            ) : null}
            {/* An unlit habit is a dim star, not a ring — rings read as planets. */}
            <Circle
              cx={star.x}
              cy={star.y}
              r={star.lit ? star.r : star.r * 0.62}
              fill={star.color}
              opacity={star.lit ? 1 : 0.3}
            />
          </React.Fragment>
        ))}

        {/*
          The count sits at the bottom. The middle of a sky is where the figure
          is, and a number parked on top of it turns the whole thing into a
          chart with decoration.
        */}
        <SvgText
          x={geo.centre}
          y={geo.size - 14}
          textAnchor="middle"
          fill={t.text}
          fontSize={17}
          fontFamily={font.mono}
          fontWeight="600"
        >
          {String(geo.done)}
          <TSpan fill={t.faint} fontSize={12}>
            {` / ${geo.total}`}
          </TSpan>
        </SvgText>

        {feel.complete ? (
          <Circle
            cx={geo.centre}
            cy={geo.centre}
            r={geo.size * 0.44}
            fill="none"
            stroke={t.accent}
            strokeWidth={1}
            opacity={0.4}
          />
        ) : null}
      </Svg>
    </View>
  );
}
