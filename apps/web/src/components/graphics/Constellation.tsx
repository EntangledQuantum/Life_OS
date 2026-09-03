import { useMemo } from "react";
import { motion } from "motion/react";
import {
  constellationGeometry,
  seedFrom,
  type HabitWithToday,
} from "@life-os/shared";

/**
 * Your habits as a sky, assembling itself over the day.
 *
 * A star per habit, on a golden-angle spiral rather than a ring — a ring of
 * eight reads as a clock face, and this should read as a sky. Closing a habit
 * lights its star and extends a line from the last one lit, so the figure is
 * literally drawn by the day rather than revealed at the end of it.
 *
 * The dust behind is the weeks already kept: nine specks per week, dimmer for a
 * weaker week. It is the only part of the picture that rewards months rather
 * than hours, and it is why an instance that has been running since spring
 * looks different from one opened this morning.
 *
 * Finish the day and the line **closes** back to the first star. That is the
 * arrival — a completed figure, not a brighter one. 99% and 100% used to look
 * identical, which is the least interesting way to end anything.
 *
 * No SVG filters anywhere. Every glow is a gradient or a layered stroke, so the
 * phone draws this exactly as the desktop does — react-native-svg's filter
 * support varies by version and a missing one renders a black rectangle rather
 * than degrading.
 */
export function Constellation({
  efficiencyPct,
  habits,
  history,
  reduce,
  className,
}: {
  efficiencyPct: number;
  habits: HabitWithToday[];
  history: number[];
  reduce: boolean;
  className?: string;
}) {
  const geo = useMemo(
    () =>
      constellationGeometry({
        efficiencyPct,
        habits: habits.map((h) => ({
          id: h.id,
          done: h.completedToday,
          color: h.themeColor || "var(--accent)",
          weight: h.xpWeight,
        })),
        history,
        seed: seedFrom(habits.map((h) => h.id).join("")),
      }),
    [efficiencyPct, habits, history],
  );

  const { feel } = geo;
  const line = geo.trail.map((p) => `${p.x},${p.y}`).join(" ");
  const closing =
    geo.closes && geo.trail.length > 1
      ? `${geo.trail[geo.trail.length - 1]!.x},${geo.trail[geo.trail.length - 1]!.y} ${geo.trail[0]!.x},${geo.trail[0]!.y}`
      : null;

  return (
    <svg
      viewBox={`0 0 ${geo.size} ${geo.size}`}
      className={className}
      role="img"
      aria-label={`${geo.done} of ${geo.total} habits done, ${Math.round(efficiencyPct)}% of today's target`}
    >
      <defs>
        {/*
          The wash brightens on a curve, not a line: flat through the middle of
          the day and running away with itself over the last stretch, so the
          final push looks like one.
        */}
        <radialGradient id="cn-wash" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.05 + feel.glow * 0.3} />
          <stop offset="55%" stopColor="var(--accent)" stopOpacity={0.03 + feel.glow * 0.1} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="cn-star" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="40%" stopColor="#fff" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>

      <circle cx={geo.centre} cy={geo.centre} r={geo.size * 0.5} fill="url(#cn-wash)" />

      {/* Weeks kept. Behind everything, and never the subject. */}
      {geo.field.map((d, i) => (
        <circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill="currentColor" opacity={d.o} />
      ))}

      {/*
        The figure so far. Drawn under the stars so the joints sit behind the
        points rather than crossing them.
      */}
      {geo.trail.length > 1 && (
        <motion.polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.35 + feel.glow * 0.45}
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: "easeOut" }}
        />
      )}

      {closing && (
        <motion.polyline
          points={closing}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.6}
          strokeLinecap="round"
          opacity={0.85}
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.9 }}
        />
      )}

      {geo.stars.map((star, i) => (
        <g key={star.id}>
          {star.lit && (
            <>
              {/* Halo, as a gradient rather than a blur — see the note above. */}
              <circle
                cx={star.x}
                cy={star.y}
                r={star.r * 4.5}
                fill="url(#cn-star)"
                opacity={0.35 + feel.glow * 0.4}
              />
              {/* Four-point flare. Only on lit stars, so the sky has a hierarchy. */}
              <path
                d={`M ${star.x} ${star.y - star.r * 3.2} L ${star.x + star.r * 0.7} ${star.y} L ${star.x} ${star.y + star.r * 3.2} L ${star.x - star.r * 0.7} ${star.y} Z`}
                fill={star.color}
                opacity={0.5 + feel.glow * 0.3}
              />
              <path
                d={`M ${star.x - star.r * 3.2} ${star.y} L ${star.x} ${star.y - star.r * 0.7} L ${star.x + star.r * 3.2} ${star.y} L ${star.x} ${star.y + star.r * 0.7} Z`}
                fill={star.color}
                opacity={0.5 + feel.glow * 0.3}
              />
            </>
          )}
          {/*
            An unlit habit is a dim star, not an outlined circle. Rings read as
            planets — a different kind of object — and the whole idea is that
            every habit is already up there and closing one lights it.
          */}
          <motion.circle
            cx={star.x}
            cy={star.y}
            r={star.lit ? star.r : star.r * 0.62}
            fill={star.color}
            opacity={star.lit ? 1 : 0.3}
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: star.lit ? 1 : 0.34 }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 180, damping: 14, delay: i * 0.04 }
            }
            style={{ transformOrigin: `${star.x}px ${star.y}px` }}
          />
        </g>
      ))}

      {/*
        The count sits at the bottom rather than the middle: the middle of a sky
        is where the figure is, and a number parked on top of it makes the whole
        thing read as a chart with decoration.
      */}
      <text
        x={geo.centre}
        y={geo.size - 16}
        textAnchor="middle"
        className="fill-[var(--text)] font-mono"
        style={{ fontSize: 17, fontWeight: 600 }}
      >
        {geo.done}
        <tspan className="fill-[var(--faint)]" style={{ fontSize: 12 }}>
          {" "}
          / {geo.total}
        </tspan>
      </text>

      {feel.complete && (
        <motion.circle
          cx={geo.centre}
          cy={geo.centre}
          r={geo.size * 0.44}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          initial={reduce ? false : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.4 }}
          transition={reduce ? { duration: 0 } : { duration: 1.2, delay: 1.4 }}
          style={{ transformOrigin: `${geo.centre}px ${geo.centre}px` }}
        />
      )}
    </svg>
  );
}
