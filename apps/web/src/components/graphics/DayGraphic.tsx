import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  arcPath,
  dayArcPoint,
  growthGeometry,
  petalPath,
  type AgendaItem,
  type GrowthStyle,
  type HabitWithToday,
} from "@life-os/shared";

/**
 * The day, drawn.
 *
 * What was here before was a stem that grew and a circle that filled, and
 * between them they encoded one number — the XP ratio. A progress bar carries
 * that. Neither showed *which* things were done, and neither changed as weeks
 * of consistency accumulated, so there was nothing to grow into and no reason
 * to look at it twice.
 *
 * This carries three things at once:
 *
 * - the **core** is today against today's target;
 * - each **petal** is one of your habits, open until you close it, so the
 *   figure is a picture of your actual day rather than a generic meter;
 * - the **rings** behind it are the weeks you have already kept, which is the
 *   part that accumulates.
 *
 * A petal filled reads as filled with the colour removed — done petals are
 * longer, not just brighter — because a graphic that only works in colour does
 * not work for everyone.
 *
 * Geometry comes from `@life-os/shared` so the phone draws the same picture
 * from the same numbers. Two hand-tuned copies would drift, and a graphic that
 * means something slightly different on each device is worse than none.
 */
export function DayGraphic({
  style = "bloom",
  efficiencyPct,
  habits,
  agenda,
  history,
  dayProgress,
  className,
}: {
  style?: GrowthStyle;
  efficiencyPct: number;
  habits: HabitWithToday[];
  agenda: AgendaItem[];
  /** Consistency per day, oldest first, 0–100. */
  history: number[];
  /** How far through the life-day it is, 0–1. */
  dayProgress: number;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;

  const geo = useMemo(
    () =>
      growthGeometry({
        efficiencyPct,
        petals: habits.map((h) => ({
          id: h.id,
          done: h.completedToday,
          color: h.themeColor || "var(--accent)",
        })),
        history,
      }),
    [efficiencyPct, habits, history],
  );

  if (style === "arc") {
    return (
      <ArcGraphic
        agenda={agenda}
        dayProgress={dayProgress}
        efficiencyPct={efficiencyPct}
        reduce={reduce}
        className={className}
      />
    );
  }

  return (
    <svg
      viewBox={`0 0 ${geo.size} ${geo.size}`}
      className={className}
      role="img"
      aria-label={`${geo.done} of ${geo.total} habits done, ${Math.round(efficiencyPct)}% of today's target`}
    >
      {/* The weeks already kept. Faint on purpose — history is context, not the subject. */}
      {geo.rings.map((ring, i) => (
        <circle
          key={`ring-${i}`}
          cx={geo.centre}
          cy={geo.centre}
          r={ring.r}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.6 + ring.strength * 1.6}
          opacity={0.06 + ring.strength * 0.16}
        />
      ))}

      {/*
        Only drawn for `rings`, where the stack is the whole graphic rather than
        the backdrop — so the two styles are genuinely different readings of the
        same data, not the same picture twice.
      */}
      {style === "rings" && (
        <circle
          cx={geo.centre}
          cy={geo.centre}
          r={geo.coreRadius + 14}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          opacity={0.25}
        />
      )}

      {style === "bloom" &&
        geo.petals.map((petal, i) => (
          <motion.path
            key={petal.id}
            d={petalPath(petal, geo.centre)}
            fill={petal.done ? petal.color : "none"}
            stroke={petal.color}
            strokeWidth={1.4}
            strokeLinejoin="round"
            opacity={petal.done ? 0.92 : 0.42}
            initial={reduce ? false : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: petal.done ? 0.92 : 0.42 }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 120, damping: 16, delay: i * 0.035 }
            }
            style={{ transformOrigin: `${geo.centre}px ${geo.centre}px` }}
          />
        ))}

      {/* The core: today against target. */}
      <circle
        cx={geo.centre}
        cy={geo.centre}
        r={geo.coreRadius}
        fill="var(--surface-2)"
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.9}
      />
      <motion.path
        d={arcPath(geo.centre, geo.coreRadius, geo.fill)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={5}
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
      />

      {/*
        The count, not the percentage. "3 of 6" is a thing you can act on; "48%"
        is a number you have to translate first.
      */}
      <text
        x={geo.centre}
        y={geo.centre + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-[var(--text)] font-mono"
        style={{ fontSize: 19, fontWeight: 600 }}
      >
        {geo.done}
      </text>
      <text
        x={geo.centre}
        y={geo.centre + 17}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-[var(--faint)] font-mono"
        style={{ fontSize: 10 }}
      >
        of {geo.total}
      </text>

      {geo.complete && (
        <circle
          cx={geo.centre}
          cy={geo.centre}
          r={geo.coreRadius + 7}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          opacity={0.5}
        />
      )}
    </svg>
  );
}

/**
 * The day as a horizon: sunrise on the left, now where the clock is, each
 * scheduled thing a mark along the path.
 *
 * For people who think in shape-of-day rather than in counts — it answers "how
 * much of today is left, and what is still on it" in one look.
 */
function ArcGraphic({
  agenda,
  dayProgress,
  efficiencyPct,
  reduce,
  className,
}: {
  agenda: AgendaItem[];
  dayProgress: number;
  efficiencyPct: number;
  reduce: boolean;
  className?: string;
}) {
  const size = 240;
  const centre = size / 2;
  const radius = 88;
  const baseline = centre + 34;

  const timed = agenda.filter((i) => i.startHour !== null);
  const sun = dayArcPoint(dayProgress, centre, radius);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`${Math.round(dayProgress * 100)}% through the day, ${Math.round(efficiencyPct)}% of target`}
    >
      <path
        d={`M ${centre - radius} ${baseline - 0} A ${radius} ${radius} 0 0 1 ${centre + radius} ${baseline}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.18}
        transform={`translate(0 ${centre - baseline + 34})`}
      />

      <g transform={`translate(0 ${34})`}>
        {/* Where the day has already gone. */}
        <path
          d={`M ${centre - radius} ${centre} A ${radius} ${radius} 0 0 1 ${sun.x} ${sun.y}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          opacity={0.5}
          strokeLinecap="round"
        />

        {timed.map((item) => {
          const f = Math.max(0, Math.min(1, (item.startHour ?? 0) / 24));
          const p = dayArcPoint(f, centre, radius);
          return (
            <circle
              key={item.id}
              cx={p.x}
              cy={p.y}
              r={item.done ? 5 : 3.5}
              fill={item.done ? item.themeColor || "var(--accent)" : "none"}
              stroke={item.themeColor || "var(--accent)"}
              strokeWidth={1.5}
              opacity={item.done ? 0.95 : 0.55}
            />
          );
        })}

        <motion.circle
          cx={sun.x}
          cy={sun.y}
          r={9}
          fill="var(--accent)"
          initial={reduce ? false : { scale: 0.6 }}
          animate={{ scale: 1 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160 }}
        />

        <line
          x1={centre - radius - 10}
          y1={centre}
          x2={centre + radius + 10}
          y2={centre}
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.22}
        />

        <text
          x={centre}
          y={centre + 30}
          textAnchor="middle"
          className="fill-[var(--text)] font-mono"
          style={{ fontSize: 21, fontWeight: 600 }}
        >
          {Math.round(efficiencyPct)}%
        </text>
        <text
          x={centre}
          y={centre + 46}
          textAnchor="middle"
          className="fill-[var(--faint)]"
          style={{ fontSize: 10 }}
        >
          of today's target
        </text>
      </g>
    </svg>
  );
}
