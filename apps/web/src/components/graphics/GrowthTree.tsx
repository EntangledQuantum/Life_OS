import { motion } from "motion/react";

/** Abstract growth tree keyed to level / consistency */
export function GrowthTree({
  level,
  consistency = 50,
}: {
  level: number;
  consistency?: number;
}) {
  const leafCount = Math.min(12, 3 + Math.floor(level / 2) + Math.floor(consistency / 25));
  const leaves = Array.from({ length: leafCount }, (_, i) => {
    const angle = -70 + (i * 140) / Math.max(1, leafCount - 1);
    const rad = (angle * Math.PI) / 180;
    const len = 28 + (i % 3) * 8 + Math.min(20, level);
    return {
      x2: 60 + Math.cos(rad) * len,
      y2: 95 - Math.sin(Math.abs(rad)) * len - i * 2,
      delay: 0.1 + i * 0.05,
      color:
        i % 3 === 0
          ? "var(--accent)"
          : i % 3 === 1
            ? "oklch(72% 0.14 150)"
            : "oklch(70% 0.12 200)",
    };
  });

  return (
    <div className="flex h-full min-h-[140px] items-end justify-center py-2">
      <svg viewBox="0 0 120 130" className="h-36 w-full max-w-[160px]">
        <defs>
          <linearGradient id="stemGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="oklch(40% 0.04 150)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <motion.line
          x1="60"
          y1="120"
          x2="60"
          y2="50"
          stroke="url(#stemGrad)"
          strokeWidth="4"
          strokeLinecap="round"
          style={{ transformOrigin: "60px 120px" }}
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
        {leaves.map((leaf, i) => (
          <motion.circle
            key={i}
            cx={leaf.x2}
            cy={leaf.y2}
            r={5 + (i % 3)}
            fill={leaf.color}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.9 }}
            transition={{ delay: leaf.delay, type: "spring", stiffness: 200 }}
            style={{ filter: "drop-shadow(0 0 6px var(--accent-glow))" }}
          />
        ))}
        <motion.circle
          cx="60"
          cy="48"
          r="7"
          fill="var(--accent)"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.4 }}
        />
      </svg>
    </div>
  );
}
