import { useMemo } from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  Path,
  RadialGradient,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { useTokens } from "@/lib/theme-provider";
import { GrowthMeter } from "./growth-meter";
import type { AgendaItem, GrowthStyle, HabitWithToday } from "@/lib/types";

/**
 * The day, drawn — the phone's copy of the web graphic.
 *
 * What was here before was a stem that grew and a circle that filled, and
 * between them they encoded one number: the XP ratio. A bar carries that.
 * Neither showed *which* things were done, and neither changed as weeks of
 * consistency accumulated, so there was nothing to grow into.
 *
 * Three things at once now: the core is today against target, each petal is one
 * of your habits, and the rings behind are the weeks already kept. A filled
 * petal is longer as well as brighter, so the state survives with the colour
 * stripped out.
 *
 * The geometry is duplicated from `packages/shared/src/growth.ts` rather than
 * imported, because this app is deliberately isolated from the workspace — it
 * has its own lockfile and its own toolchain, and a cross-package import would
 * end that. Duplicated maths can drift, so the numbers below are the ones that
 * must stay identical to the web's; everything else here is React Native.
 */

const SIZE = 240;
const CENTRE = SIZE / 2;
const CORE_MIN = 26;
const CORE_MAX = 44;
const PETAL_INNER = 52;
const PETAL_OUTER = 104;
const MAX_RINGS = 8;

interface Petal {
  id: string;
  done: boolean;
  color: string;
  angle: number;
  reach: number;
  spread: number;
}

function geometry(
  efficiencyPct: number,
  habits: { id: string; done: boolean; color: string }[],
  history: number[],
) {
  const pct = Number.isFinite(efficiencyPct) ? efficiencyPct : 0;
  const fill = Math.max(0, Math.min(1, pct / 100));
  const total = habits.length;
  const step = total > 0 ? 360 / total : 0;
  const spread = total > 0 ? Math.min(26, Math.max(9, step * 0.34)) : 0;

  const petals: Petal[] = habits.map((h, i) => ({
    id: h.id,
    done: h.done,
    color: h.color,
    angle: i * step,
    reach: h.done ? PETAL_OUTER : PETAL_INNER + (PETAL_OUTER - PETAL_INNER) * 0.5,
    spread,
  }));

  const clean = history.filter((n) => Number.isFinite(n));
  const weeks: number[] = [];
  for (let end = clean.length; end > 0 && weeks.length < MAX_RINGS; end -= 7) {
    const slice = clean.slice(Math.max(0, end - 7), end);
    if (slice.length === 0) break;
    weeks.push(slice.reduce((a, b) => a + b, 0) / slice.length / 100);
  }

  return {
    fill,
    complete: pct >= 100,
    coreRadius: CORE_MIN + (CORE_MAX - CORE_MIN) * fill,
    petals,
    rings: weeks.map((strength, i) => ({
      r: PETAL_OUTER + 8 + i * 9,
      strength: Math.max(0, Math.min(1, strength)),
    })),
    done: habits.filter((h) => h.done).length,
    total,
  };
}

function petalPath(petal: Petal): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const at = (deg: number, r: number) => ({
    x: CENTRE + Math.cos(rad(deg)) * r,
    y: CENTRE + Math.sin(rad(deg)) * r,
  });

  const base = PETAL_INNER * 0.62;
  const start = at(petal.angle - petal.spread * 0.3, base);
  const end = at(petal.angle + petal.spread * 0.3, base);
  const tip = at(petal.angle, petal.reach);
  const left = at(petal.angle - petal.spread, (base + petal.reach) / 2);
  const right = at(petal.angle + petal.spread, (base + petal.reach) / 2);

  const n = (v: number) => Math.round(v * 100) / 100;
  return `M ${n(start.x)} ${n(start.y)} Q ${n(left.x)} ${n(left.y)} ${n(tip.x)} ${n(tip.y)} Q ${n(right.x)} ${n(right.y)} ${n(end.x)} ${n(end.y)} Z`;
}

function arcPath(radius: number, fraction: number): string {
  const f = Math.max(0, Math.min(0.9999, fraction));
  if (f <= 0) return "";
  const end = f * 360;
  const rad = ((end - 90) * Math.PI) / 180;
  const x = CENTRE + Math.cos(rad) * radius;
  const y = CENTRE + Math.sin(rad) * radius;
  const n = (v: number) => Math.round(v * 100) / 100;
  return `M ${n(CENTRE)} ${n(CENTRE - radius)} A ${n(radius)} ${n(radius)} 0 ${end > 180 ? 1 : 0} 1 ${n(x)} ${n(y)}`;
}

function dayArcPoint(fraction: number, radius: number) {
  const f = Math.max(0, Math.min(1, fraction));
  const angle = Math.PI * (1 - f);
  return { x: CENTRE + Math.cos(angle) * radius, y: CENTRE - Math.sin(angle) * radius };
}

export function DayGraphic({
  style = "bloom",
  efficiencyPct,
  habits,
  agenda,
  history,
  dayProgress,
  size = 220,
}: {
  style?: GrowthStyle;
  efficiencyPct: number;
  habits: HabitWithToday[];
  agenda: AgendaItem[];
  history: number[];
  dayProgress: number;
  size?: number;
}) {
  const t = useTokens();

  const geo = useMemo(
    () =>
      geometry(
        efficiencyPct,
        habits.map((h) => ({
          id: h.id,
          done: h.completedToday,
          color: h.themeColor || t.accent,
        })),
        history,
      ),
    [efficiencyPct, habits, history, t.accent],
  );

  /*
   * The two originals, kept because people liked them. They encode one number
   * where the rest encode three — a reason not to make them the default, not a
   * reason to delete them.
   */
  if (style === "sprout" || style === "orb") {
    return (
      <GrowthMeter
        efficiencyPct={efficiencyPct}
        style={style}
        size={size}
        showReadout={false}
        celebrationIntensity="minimal"
      />
    );
  }

  if (style === "arc") {
    const radius = 88;
    const sun = dayArcPoint(dayProgress, radius);
    const timed = agenda.filter((i) => i.startHour !== null);
    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <Path
            d={`M ${CENTRE - radius} ${CENTRE} A ${radius} ${radius} 0 0 1 ${CENTRE + radius} ${CENTRE}`}
            fill="none"
            stroke={t.muted}
            strokeWidth={1}
            opacity={0.2}
          />
          <Path
            d={`M ${CENTRE - radius} ${CENTRE} A ${radius} ${radius} 0 0 1 ${sun.x} ${sun.y}`}
            fill="none"
            stroke={t.accent}
            strokeWidth={2}
            opacity={0.55}
            strokeLinecap="round"
          />
          {timed.map((item) => {
            const p = dayArcPoint(
              Math.max(0, Math.min(1, (item.startHour ?? 0) / 24)),
              radius,
            );
            return (
              <Circle
                key={item.id}
                cx={p.x}
                cy={p.y}
                r={item.done ? 5 : 3.5}
                fill={item.done ? item.themeColor || t.accent : "none"}
                stroke={item.themeColor || t.accent}
                strokeWidth={1.5}
                opacity={item.done ? 0.95 : 0.55}
              />
            );
          })}
          <Circle cx={sun.x} cy={sun.y} r={9} fill={t.accent} />
          <Line
            x1={CENTRE - radius - 10}
            y1={CENTRE}
            x2={CENTRE + radius + 10}
            y2={CENTRE}
            stroke={t.muted}
            strokeWidth={1}
            opacity={0.25}
          />
          <SvgText
            x={CENTRE}
            y={CENTRE + 34}
            textAnchor="middle"
            fill={t.text}
            fontSize={22}
            fontWeight="600"
          >
            {`${Math.round(efficiencyPct)}%`}
          </SvgText>
          <SvgText
            x={CENTRE}
            y={CENTRE + 50}
            textAnchor="middle"
            fill={t.faint}
            fontSize={10}
          >
            of today&apos;s target
          </SvgText>
        </Svg>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/*
          A halo that brightens as the day fills, so the light *is* the
          progress rather than decoration laid over it. No blur filter here —
          react-native-svg's filter support is patchy across versions, and a
          graphic that silently renders as a black square on one Android build
          is worse than one without a bloom.
        */}
        <Defs>
          <RadialGradient id="dg-halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={t.accent} stopOpacity={0.16 + geo.fill * 0.2} />
            <Stop offset="65%" stopColor={t.accent} stopOpacity={0.05} />
            <Stop offset="100%" stopColor={t.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={CENTRE} cy={CENTRE} r={SIZE * 0.46} fill="url(#dg-halo)" />

        {geo.rings.map((ring, i) => (
          <Circle
            key={`ring-${i}`}
            cx={CENTRE}
            cy={CENTRE}
            r={ring.r}
            fill="none"
            stroke={t.muted}
            strokeWidth={0.6 + ring.strength * 1.6}
            opacity={0.06 + ring.strength * 0.16}
          />
        ))}

        {style === "rings" && (
          <Circle
            cx={CENTRE}
            cy={CENTRE}
            r={geo.coreRadius + 14}
            fill="none"
            stroke={t.accent}
            strokeWidth={2}
            opacity={0.25}
          />
        )}

        {style === "bloom" &&
          geo.petals.map((petal) => (
            <Path
              key={petal.id}
              d={petalPath(petal)}
              fill={petal.done ? petal.color : "none"}
              stroke={petal.color}
              strokeWidth={1.4}
              strokeLinejoin="round"
              opacity={petal.done ? 0.92 : 0.42}
            />
          ))}

        <Circle
          cx={CENTRE}
          cy={CENTRE}
          r={geo.coreRadius}
          fill={t.surface2}
          stroke={t.muted}
          strokeWidth={1}
          opacity={0.9}
        />
        <Path
          d={arcPath(geo.coreRadius, geo.fill)}
          fill="none"
          stroke={t.accent}
          strokeWidth={5}
          strokeLinecap="round"
        />

        {/*
          The count, not the percentage. "3 of 6" is something you can act on;
          "48%" has to be translated first.
        */}
        <SvgText
          x={CENTRE}
          y={CENTRE + 6}
          textAnchor="middle"
          fill={t.text}
          fontSize={20}
          fontWeight="600"
        >
          {String(geo.done)}
        </SvgText>
        <SvgText
          x={CENTRE}
          y={CENTRE + 21}
          textAnchor="middle"
          fill={t.faint}
          fontSize={10}
        >
          {`of ${geo.total}`}
        </SvgText>

        {geo.complete && (
          <Circle
            cx={CENTRE}
            cy={CENTRE}
            r={geo.coreRadius + 7}
            fill="none"
            stroke={t.accent}
            strokeWidth={1.5}
            opacity={0.5}
          />
        )}
      </Svg>
    </View>
  );
}
