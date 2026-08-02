import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { GrowthStyle } from "@life-os/shared";

/**
 * Growth meter — daily XP progress toward the target.
 *
 * Renamed from the old "nurture" plant/water visual: `water` read as the
 * drinking-water habit, which it never was. Two styles:
 *   sprout — a plant that grows from seed to bloom
 *   orb    — a sphere that fills with light
 *
 * Both draw the 100% state as a ghost layer *behind* the live state, so the
 * gap between where you are and what a full day looks like is always visible.
 */

const SPRING = { type: "spring" as const, stiffness: 70, damping: 18, mass: 0.9 };

export function GrowthMeter({
  efficiencyPct,
  style = "sprout",
  dailyXp = 0,
  dailyXpTarget = 200,
}: {
  efficiencyPct: number;
  style?: GrowthStyle;
  dailyXp?: number;
  dailyXpTarget?: number;
}) {
  const pct = Math.min(100, Math.max(0, efficiencyPct));
  const full = pct >= 100;
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="relative flex w-full items-center justify-center">
        {style === "orb" ? (
          <OrbGrowth pct={pct} full={full} reduce={reduce} />
        ) : (
          <SproutGrowth pct={pct} full={full} reduce={reduce} />
        )}
      </div>

      <GrowthScale
        pct={pct}
        full={full}
        dailyXp={dailyXp}
        dailyXpTarget={dailyXpTarget}
        reduce={reduce}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ scale */

function GrowthScale({
  pct,
  full,
  dailyXp,
  dailyXpTarget,
  reduce,
}: {
  pct: number;
  full: boolean;
  dailyXp: number;
  dailyXpTarget: number;
  reduce: boolean;
}) {
  return (
    <div className="w-full max-w-[280px] space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
          {Math.round(pct)}
          <span className="text-sm text-[var(--faint)]">%</span>
        </span>
        <span
          className={
            full
              ? "font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]"
              : "font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]"
          }
        >
          {full ? "target met" : "of today's target"}
        </span>
      </div>

      {/* The track is the full day; the fill is what you've grown so far. */}
      <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: full
              ? "linear-gradient(90deg, oklch(72% 0.16 150), var(--accent))"
              : "linear-gradient(90deg, color-mix(in oklch, var(--accent) 55%, transparent), var(--accent))",
          }}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : SPRING}
        />
      </div>

      <div className="flex justify-between font-mono text-[11px] text-[var(--faint)]">
        <span>
          {dailyXp} / {dailyXpTarget} XP
        </span>
        <span>{Math.max(0, dailyXpTarget - dailyXp)} to go</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- sprout */

/** Stem spine. Leaf anchors below are points sampled along this same curve. */
const STEM_PATH = "M80 132 C80 110 72 92 80 74 C88 56 80 42 80 28";

const LEAVES = [
  { at: 0.16, x: 78, y: 110, side: -1, size: 1 },
  { at: 0.32, x: 76.5, y: 90, side: 1, size: 1.1 },
  { at: 0.46, x: 78, y: 79, side: -1, size: 1.15 },
  { at: 0.62, x: 83.5, y: 59, side: 1, size: 1.05 },
  { at: 0.78, x: 82, y: 45, side: -1, size: 0.95 },
  { at: 0.9, x: 80.5, y: 35, side: 1, size: 0.85 },
] as const;

function SproutGrowth({
  pct,
  full,
  reduce,
}: {
  pct: number;
  full: boolean;
  reduce: boolean;
}) {
  const t = pct / 100;

  return (
    <svg
      viewBox="0 0 160 180"
      className="h-[220px] w-full max-w-[280px]"
      role="img"
      aria-label={`Growth: ${Math.round(pct)} percent of today's XP target`}
    >
      <defs>
        <linearGradient id="gm-stem" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="oklch(45% 0.09 150)" />
          <stop offset="100%" stopColor="oklch(72% 0.16 152)" />
        </linearGradient>
        <linearGradient id="gm-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(76% 0.17 148)" />
          <stop offset="100%" stopColor="oklch(58% 0.14 165)" />
        </linearGradient>
        <linearGradient id="gm-bloom" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="oklch(80% 0.16 330)" />
        </linearGradient>
        <radialGradient id="gm-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gm-pot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(34% 0.035 55)" />
          <stop offset="100%" stopColor="oklch(22% 0.03 50)" />
        </linearGradient>
      </defs>

      {/* ---- ghost layer: exactly what 100% looks like, always visible ---- */}
      <g opacity={full ? 0 : 0.16} style={{ transition: "opacity .5s ease" }}>
        <path
          d={STEM_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          className="text-white"
        />
        {LEAVES.map((leaf, i) => (
          <Leaf key={`ghost-${i}`} leaf={leaf} fill="rgba(255,255,255,0.9)" />
        ))}
        <circle cx="80" cy="26" r="13" fill="rgba(255,255,255,0.9)" />
      </g>

      {/* dashed outline of the full silhouette so the gap reads as a goal */}
      {!full && (
        <path
          d={STEM_PATH}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1"
          strokeLinecap="round"
          strokeDasharray="2 6"
        />
      )}

      {/* ------------------------------ full-day marker ------------------ */}
      <g>
        <line
          x1="98"
          y1="26"
          x2="126"
          y2="26"
          stroke={full ? "var(--accent)" : "rgba(255,255,255,0.16)"}
          strokeWidth="1"
        />
        <text
          x="130"
          y="29"
          fill={full ? "var(--accent)" : "rgba(255,255,255,0.3)"}
          fontSize="8"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing="0.5"
        >
          100%
        </text>
      </g>

      {/* ----------------------------------- glow when the day is complete */}
      {full && (
        <motion.circle
          cx="80"
          cy="26"
          r="42"
          fill="url(#gm-glow)"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={
            reduce
              ? { opacity: 0.8, scale: 1 }
              : { opacity: [0.55, 0.9, 0.55], scale: 1 }
          }
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 3.5, repeat: Infinity, ease: "easeInOut" }
          }
          style={{ transformOrigin: "80px 26px" }}
        />
      )}

      {/* ------------------------------------------------- the living plant */}
      <motion.path
        d={STEM_PATH}
        fill="none"
        stroke="url(#gm-stem)"
        strokeWidth="5"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: Math.max(0.02, t) }}
        transition={reduce ? { duration: 0 } : SPRING}
      />

      {LEAVES.map((leaf, i) => {
        const grown = t >= leaf.at;
        return (
          <motion.g
            key={i}
            initial={false}
            animate={{
              scale: grown ? 1 : 0,
              opacity: grown ? 1 : 0,
            }}
            transition={
              reduce ? { duration: 0 } : { ...SPRING, delay: grown ? i * 0.05 : 0 }
            }
            style={{ transformOrigin: `${leaf.x}px ${leaf.y}px` }}
          >
            <Leaf leaf={leaf} fill="url(#gm-leaf)" />
          </motion.g>
        );
      })}

      {/* bloom only when the target is actually met */}
      <motion.g
        initial={false}
        animate={{ scale: full ? 1 : 0, opacity: full ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { ...SPRING, stiffness: 120 }}
        style={{ transformOrigin: "80px 26px" }}
      >
        <circle cx="80" cy="26" r="13" fill="url(#gm-bloom)" />
        <circle cx="80" cy="26" r="5" fill="oklch(96% 0.06 90)" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <ellipse
            key={deg}
            cx="80"
            cy="12"
            rx="4"
            ry="7"
            fill="url(#gm-bloom)"
            opacity="0.85"
            transform={`rotate(${deg} 80 26)`}
          />
        ))}
      </motion.g>

      {/* --------------------------------------------------- pot and soil */}
      <path d="M52 130 L58 166 Q80 174 102 166 L108 130 Z" fill="url(#gm-pot)" />
      <path
        d="M52 130 L58 166 Q80 174 102 166 L108 130 Z"
        fill="none"
        stroke="rgba(255,255,255,0.09)"
      />
      <ellipse cx="80" cy="130" rx="28" ry="6" fill="oklch(38% 0.04 55)" />
      <ellipse cx="80" cy="129" rx="21" ry="4" fill="oklch(24% 0.03 60)" />

      {/* seed hint before anything has grown */}
      {pct < 4 && (
        <text
          x="80"
          y="120"
          textAnchor="middle"
          fill="rgba(255,255,255,0.3)"
          fontSize="9"
          fontFamily="Figtree, sans-serif"
        >
          seed
        </text>
      )}
    </svg>
  );
}

function Leaf({
  leaf,
  fill,
}: {
  leaf: (typeof LEAVES)[number];
  fill: string;
}) {
  const w = 15 * leaf.size;
  const h = 7 * leaf.size;
  const tip = leaf.x + leaf.side * w;
  return (
    <path
      d={`M${leaf.x} ${leaf.y}
          C${leaf.x + leaf.side * w * 0.4} ${leaf.y - h}
           ${tip - leaf.side * w * 0.15} ${leaf.y - h * 0.6}
           ${tip} ${leaf.y - h * 0.2}
          C${tip - leaf.side * w * 0.2} ${leaf.y + h * 0.5}
           ${leaf.x + leaf.side * w * 0.4} ${leaf.y + h * 0.5}
           ${leaf.x} ${leaf.y} Z`}
      fill={fill}
    />
  );
}

/* -------------------------------------------------------------------- orb */

function OrbGrowth({
  pct,
  full,
  reduce,
}: {
  pct: number;
  full: boolean;
  reduce: boolean;
}) {
  const cx = 80;
  const cy = 90;
  const r = 54;
  const top = cy - r;
  const level = cy + r - (pct / 100) * (r * 2);

  // Crest offset drives the wave; parked when the user prefers reduced motion.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const tick = () => {
      setPhase((p) => (p + 0.6) % 40);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce]);

  return (
    <svg
      viewBox="0 0 160 180"
      className="h-[220px] w-full max-w-[280px]"
      role="img"
      aria-label={`Growth: ${Math.round(pct)} percent of today's XP target`}
    >
      <defs>
        <clipPath id="gm-orb-clip">
          <circle cx={cx} cy={cy} r={r - 3} />
        </clipPath>
        <linearGradient id="gm-orb-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--accent) 85%, white)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
        <linearGradient id="gm-orb-fill-full" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(82% 0.15 155)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
        <radialGradient id="gm-orb-glow" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.35" />
        </radialGradient>
      </defs>

      {/* ghost: the whole sphere is what 100% looks like */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="rgba(255,255,255,0.03)"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="2"
      />
      {!full && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
          strokeDasharray="2 6"
        />
      )}

      {full && (
        <motion.circle
          cx={cx}
          cy={cy}
          r={r + 14}
          fill="url(#gm-orb-glow)"
          initial={{ opacity: 0 }}
          animate={reduce ? { opacity: 0.9 } : { opacity: [0.5, 1, 0.5] }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 3.5, repeat: Infinity, ease: "easeInOut" }
          }
        />
      )}

      <g clipPath="url(#gm-orb-clip)">
        {/* body of the fill */}
        <motion.rect
          x={cx - r}
          width={r * 2}
          fill={full ? "url(#gm-orb-fill-full)" : "url(#gm-orb-fill)"}
          initial={false}
          animate={{ y: level, height: cy + r - level + 4 }}
          transition={reduce ? { duration: 0 } : SPRING}
        />
        {/* two offset crests give the surface depth */}
        <motion.path
          d={wave(cx - r - 40, r * 2 + 80, 5)}
          fill={full ? "oklch(82% 0.15 155)" : "var(--accent)"}
          opacity={0.85}
          initial={false}
          animate={{ y: level, x: -phase }}
          transition={reduce ? { duration: 0 } : SPRING}
        />
        <motion.path
          d={wave(cx - r - 40, r * 2 + 80, 3.5)}
          fill="rgba(255,255,255,0.28)"
          initial={false}
          animate={{ y: level, x: phase - 20 }}
          transition={reduce ? { duration: 0 } : SPRING}
        />
      </g>

      {/* rim sits above the liquid */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={full ? "var(--accent)" : "rgba(255,255,255,0.24)"}
        strokeWidth="2.5"
      />
      {/* specular highlight */}
      <ellipse
        cx={cx - 20}
        cy={cy - 26}
        rx="12"
        ry="18"
        fill="rgba(255,255,255,0.1)"
        transform={`rotate(-25 ${cx - 20} ${cy - 26})`}
      />

      {/* 100% line, so the remaining distance is literally drawn */}
      <line
        x1={cx + r + 4}
        y1={top}
        x2={cx + r + 26}
        y2={top}
        stroke={full ? "var(--accent)" : "rgba(255,255,255,0.16)"}
        strokeWidth="1"
      />
      <text
        x={cx + r + 30}
        y={top + 3}
        fill={full ? "var(--accent)" : "rgba(255,255,255,0.3)"}
        fontSize="8"
        fontFamily="JetBrains Mono, monospace"
      >
        100%
      </text>

      {pct < 4 && (
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fill="rgba(255,255,255,0.28)"
          fontSize="9"
          fontFamily="Figtree, sans-serif"
        >
          empty
        </text>
      )}
    </svg>
  );
}

/** Sine-ish crest built from cubic segments, wide enough to scroll seamlessly. */
function wave(x: number, width: number, amp: number): string {
  const seg = 40;
  const count = Math.ceil(width / seg);
  let d = `M${x} 0`;
  for (let i = 0; i < count; i++) {
    const x0 = x + i * seg;
    d += ` C${x0 + seg * 0.25} ${-amp} ${x0 + seg * 0.75} ${amp} ${x0 + seg} 0`;
  }
  d += ` L${x + count * seg} 260 L${x} 260 Z`;
  return d;
}
