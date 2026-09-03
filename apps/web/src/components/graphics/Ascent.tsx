import { useMemo } from "react";
import { motion } from "motion/react";
import { ascentGeometry, type AgendaItem } from "@life-os/shared";

/**
 * A ridge, a trail up it, and how far along you are.
 *
 * `arc` was a day read left to right with dots on it, which said where the
 * clock was and nothing about where *you* were. Here the two are separated on
 * purpose and it is the whole idea:
 *
 * - the **sky** moves with the clock — sun on its arc, dusk, and the moon after
 *   it sets, because a graphic at 2am should not look like one at noon;
 * - the **marker** moves with the score, up a trail toward the summit.
 *
 * Seeing them apart is the point. Late in the day with the marker low is a
 * different message from early in the day with the marker low, and one number
 * cannot say both.
 *
 * Waypoints are the day's scheduled things, sampled from the same curve as the
 * trail so nothing can drift off the path. The summit lights when the day is
 * finished — an arrival, not a brighter version of nearly.
 *
 * Filter-free, so the phone draws the same picture.
 */
export function Ascent({
  efficiencyPct,
  agenda,
  dayProgress,
  reduce,
  className,
}: {
  efficiencyPct: number;
  agenda: AgendaItem[];
  dayProgress: number;
  reduce: boolean;
  className?: string;
}) {
  const geo = useMemo(
    () =>
      ascentGeometry({
        efficiencyPct,
        items: agenda
          .filter((i) => i.at !== null)
          .map((i) => ({ done: i.done, color: i.themeColor || "var(--accent)" })),
        dayProgress,
      }),
    [efficiencyPct, agenda, dayProgress],
  );

  const { feel, light } = geo;
  const size = geo.size;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`${Math.round(efficiencyPct)}% of today's target, ${Math.round(dayProgress * 100)}% through the day`}
    >
      <defs>
        {/*
          The sky is the clock. It runs cool and dark at night, warms through
          the middle of the day, and cools again — so the same score reads
          differently at 08:00 and at 23:00, which it should.
        */}
        <linearGradient id="as-sky" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={light.night ? "#0B1020" : "#132038"}
            stopOpacity={0.95}
          />
          <stop
            offset="60%"
            stopColor={light.night ? "#141A33" : "#2A2547"}
            stopOpacity={0.75}
          />
          <stop offset="100%" stopColor="#0B0D14" stopOpacity={0.9} />
        </linearGradient>
        <radialGradient id="as-sun" cx="50%" cy="50%" r="50%">
          <stop
            offset="0%"
            stopColor={light.night ? "#CBD5F5" : "var(--accent)"}
            stopOpacity={0.85}
          />
          <stop
            offset="45%"
            stopColor={light.night ? "#CBD5F5" : "var(--accent)"}
            stopOpacity={0.22}
          />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </radialGradient>
        {/*
          Lifts as the day fills, so the summit is visibly closer at the end.
          It spans the whole square and fades at *both* ends — drawn over part
          of the sky it left a hard horizontal seam where the rect began, which
          read as a rendering fault rather than as light.
        */}
        <linearGradient id="as-glow" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0} />
          <stop offset="45%" stopColor="var(--accent)" stopOpacity={0.04 + feel.glow * 0.22} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width={size} height={size} rx="14" fill="url(#as-sky)" />

      <circle cx={light.x} cy={light.y} r={34} fill="url(#as-sun)" />
      <circle
        cx={light.x}
        cy={light.y}
        r={light.night ? 6 : 9}
        fill={light.night ? "#E2E8F8" : "var(--accent)"}
        opacity={0.95}
      />

      <rect x="0" y="0" width={size} height={size} fill="url(#as-glow)" />

      {/* Far ridge, then near ridge: two layers is all it takes to read as depth. */}
      <path d={geo.ridge} fill="#161B2E" opacity={0.92} />
      <path d={geo.foreRidge} fill="#0D1120" opacity={0.96} />

      <path
        d={geo.trail}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeDasharray="3 4"
        opacity={0.28}
      />
      {/*
        The stretch already walked, drawn over the dashed plan. `pathLength` is
        normalised to 1 by SVG, so the dash trick works whatever the curve's
        real length is.
      */}
      <motion.path
        d={geo.trail}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.2}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        initial={reduce ? false : { strokeDashoffset: 1 }}
        animate={{ strokeDashoffset: 1 - feel.fill }}
        transition={reduce ? { duration: 0 } : { duration: 1, ease: "easeOut" }}
        opacity={0.9}
      />

      {geo.waypoints.map((w, i) => (
        <circle
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

      {/* The summit only lights when the day is actually finished. */}
      <g>
        <circle
          cx={geo.summit.x}
          cy={geo.summit.y}
          r={feel.complete ? 26 : 12}
          fill="url(#as-sun)"
          opacity={feel.complete ? 0.9 : 0.18 + feel.glow * 0.4}
        />
        <path
          d={`M ${geo.summit.x} ${geo.summit.y} L ${geo.summit.x} ${geo.summit.y - 16} L ${geo.summit.x + 11} ${geo.summit.y - 11.5} L ${geo.summit.x} ${geo.summit.y - 7}`}
          fill={feel.complete ? "var(--accent)" : "none"}
          stroke="var(--accent)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          opacity={feel.complete ? 1 : 0.45}
        />
      </g>

      <motion.circle
        cx={geo.marker.x}
        cy={geo.marker.y}
        r={5.5}
        fill="var(--accent)"
        stroke="#0B0D14"
        strokeWidth={2}
        initial={reduce ? false : { scale: 0.5 }}
        animate={{ scale: 1 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 14 }}
      />

      <text
        x={16}
        y={size - 16}
        className="fill-[var(--text)] font-mono"
        style={{ fontSize: 17, fontWeight: 600 }}
      >
        {Math.round(efficiencyPct)}%
      </text>
      <text
        x={size - 16}
        y={size - 16}
        textAnchor="end"
        className="fill-[var(--faint)] font-mono"
        style={{ fontSize: 11 }}
      >
        {feel.complete ? "summit" : `${Math.round(dayProgress * 100)}% of the day`}
      </text>
    </svg>
  );
}
