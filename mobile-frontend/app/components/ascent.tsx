import { useMemo } from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { useTokens } from "@/lib/theme-provider";
import { ascentGeometry } from "@/lib/journey";
import { font } from "@/lib/theme";
import type { AgendaItem } from "@/lib/types";

/**
 * A ridge, a trail up it, and how far along you are — the phone's copy.
 *
 * The sky moves with the **clock** and the marker moves with the **score**, and
 * keeping them apart is the whole idea. Late in the day with the marker low is
 * a different message from early in the day with the marker low, and one number
 * cannot say both.
 *
 * Waypoints are the day's scheduled things, sampled from the same curve as the
 * trail so nothing can drift off the path. The summit lights only when the day
 * is finished.
 *
 * Identical to `apps/web/src/components/graphics/Ascent.tsx` in everything but
 * the primitives. Filter-free, so the two draw the same picture.
 */
export function Ascent({
  efficiencyPct,
  agenda,
  dayProgress,
  size = 260,
}: {
  efficiencyPct: number;
  agenda: AgendaItem[];
  dayProgress: number;
  size?: number;
}) {
  const t = useTokens();

  const geo = useMemo(
    () =>
      ascentGeometry({
        efficiencyPct,
        items: agenda
          .filter((i) => i.startHour !== null)
          .map((i) => ({ done: i.done, color: i.themeColor || t.accent })),
        dayProgress,
      }),
    [efficiencyPct, agenda, dayProgress, t.accent],
  );

  const { feel, light } = geo;
  const box = geo.size;
  const lightColor = light.night ? "#CBD5F5" : t.accent;

  /*
   * The walked stretch is drawn as a dash pattern over the dashed plan. SVG
   * normalises `pathLength` to 1, so `1 - fill` offsets it correctly whatever
   * the curve's real length is — no measuring, and it matches the web exactly.
   */
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`}>
        <Defs>
          {/* The sky is the clock: cool at night, warmer through the middle. */}
          <LinearGradient id="as-sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={light.night ? "#0B1020" : "#132038"} stopOpacity={0.95} />
            <Stop offset="60%" stopColor={light.night ? "#141A33" : "#2A2547"} stopOpacity={0.75} />
            <Stop offset="100%" stopColor="#0B0D14" stopOpacity={0.9} />
          </LinearGradient>
          <RadialGradient id="as-sun" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={lightColor} stopOpacity={0.85} />
            <Stop offset="45%" stopColor={lightColor} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={t.accent} stopOpacity={0} />
          </RadialGradient>
          {/* Fades at both ends — a hard edge here read as a rendering fault. */}
          <LinearGradient id="as-glow" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0%" stopColor={t.accent} stopOpacity={0} />
            <Stop offset="45%" stopColor={t.accent} stopOpacity={0.04 + feel.glow * 0.22} />
            <Stop offset="100%" stopColor={t.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={box} height={box} rx={14} fill="url(#as-sky)" />

        <Circle cx={light.x} cy={light.y} r={34} fill="url(#as-sun)" />
        <Circle
          cx={light.x}
          cy={light.y}
          r={light.night ? 6 : 9}
          fill={light.night ? "#E2E8F8" : t.accent}
          opacity={0.95}
        />

        <Rect x={0} y={0} width={box} height={box} fill="url(#as-glow)" />

        {/* Two ridges is all it takes to read as depth. */}
        <Path d={geo.ridge} fill="#161B2E" opacity={0.92} />
        <Path d={geo.foreRidge} fill="#0D1120" opacity={0.96} />

        <Path
          d={geo.trail}
          fill="none"
          stroke={t.muted}
          strokeWidth={1.2}
          strokeDasharray="3 4"
          opacity={0.28}
        />
        <Path
          d={geo.trail}
          fill="none"
          stroke={t.accent}
          strokeWidth={2.2}
          strokeLinecap="round"
          {...{ pathLength: 1 }}
          strokeDasharray="1 1"
          strokeDashoffset={1 - feel.fill}
          opacity={0.9}
        />

        {geo.waypoints.map((w, i) => (
          <Circle
            key={i}
            cx={w.x}
            cy={w.y}
            r={w.done ? 4 : 2.8}
            fill={w.done ? w.color : "#0D1120"}
            stroke={w.color}
            strokeWidth={1.4}
            opacity={w.done ? 0.95 : 0.5}
          />
        ))}

        {/* The summit lights only on a finished day. */}
        <Circle
          cx={geo.summit.x}
          cy={geo.summit.y}
          r={feel.complete ? 26 : 12}
          fill="url(#as-sun)"
          opacity={feel.complete ? 0.9 : 0.18 + feel.glow * 0.4}
        />
        <Path
          d={`M ${geo.summit.x} ${geo.summit.y} L ${geo.summit.x} ${geo.summit.y - 16} L ${geo.summit.x + 11} ${geo.summit.y - 11.5} L ${geo.summit.x} ${geo.summit.y - 7}`}
          fill={feel.complete ? t.accent : "none"}
          stroke={t.accent}
          strokeWidth={1.4}
          strokeLinejoin="round"
          opacity={feel.complete ? 1 : 0.45}
        />

        <Circle
          cx={geo.marker.x}
          cy={geo.marker.y}
          r={5.5}
          fill={t.accent}
          stroke="#0B0D14"
          strokeWidth={2}
        />

        <SvgText
          x={16}
          y={box - 14}
          fill={t.text}
          fontSize={17}
          fontFamily={font.mono}
          fontWeight="600"
        >
          {`${Math.round(efficiencyPct)}%`}
        </SvgText>
        <SvgText
          x={box - 16}
          y={box - 14}
          textAnchor="end"
          fill={t.faint}
          fontSize={11}
          fontFamily={font.mono}
        >
          {feel.complete ? "summit" : `${Math.round(dayProgress * 100)}% of the day`}
        </SvgText>
      </Svg>
    </View>
  );
}
