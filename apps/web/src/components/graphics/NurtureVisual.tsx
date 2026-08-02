import { motion } from "motion/react";

/**
 * Daily XP efficiency as water fill or plant growth.
 * 0% = empty pot / empty bottle; 100% = clearly FULL with label.
 */
export function NurtureVisual({
  efficiencyPct,
  style = "plant",
  dailyXp = 0,
  dailyXpTarget = 200,
}: {
  efficiencyPct: number;
  style?: "plant" | "water" | "both";
  dailyXp?: number;
  dailyXpTarget?: number;
}) {
  const pct = Math.min(100, Math.max(0, efficiencyPct));
  const full = pct >= 100;
  const mode = style === "both" ? "plant" : style;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="relative flex w-full max-w-[220px] items-center justify-center py-2">
        {mode === "plant" ? (
          <PlantMeter pct={pct} full={full} />
        ) : (
          <WaterMeter pct={pct} full={full} />
        )}
      </div>
      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between font-mono text-xs text-[var(--muted)]">
          <span>0</span>
          <span className={full ? "font-semibold text-[var(--accent)]" : ""}>
            {full ? "FULL · target met" : `${Math.round(pct)}% of target`}
          </span>
          <span>100</span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-black/40">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: full
                ? "linear-gradient(90deg, oklch(70% 0.16 150), var(--accent))"
                : "var(--accent)",
            }}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
          {/* full marker */}
          <div className="absolute bottom-0 right-0 top-0 w-px bg-white/40" />
        </div>
        <div className="text-center font-mono text-[11px] text-[var(--faint)]">
          {dailyXp} / {dailyXpTarget} XP
        </div>
      </div>
    </div>
  );
}

function WaterMeter({ pct, full }: { pct: number; full: boolean }) {
  // fill from bottom of bottle body (y=22 top of body interior → y=90 bottom)
  const bodyTop = 22;
  const bodyBottom = 90;
  const bodyH = bodyBottom - bodyTop;
  const fillH = (pct / 100) * bodyH;
  const fillY = bodyBottom - fillH;

  return (
    <div className="relative">
      <svg viewBox="0 0 80 110" width="160" height="200" className="drop-shadow-none">
        <defs>
          <clipPath id="bottleInner">
            <path d="M26 22 L26 18 Q26 12 32 12 L48 12 Q54 12 54 18 L54 22 L58 30 L58 88 Q58 96 40 96 Q22 96 22 88 L22 30 Z" />
          </clipPath>
          <linearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(78% 0.12 210)" />
            <stop offset="100%" stopColor="oklch(55% 0.14 240)" />
          </linearGradient>
          <linearGradient id="waterFull" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(80% 0.14 160)" />
            <stop offset="100%" stopColor="oklch(60% 0.16 220)" />
          </linearGradient>
        </defs>

        {/* ghost full level */}
        <path
          d="M26 22 L26 18 Q26 12 32 12 L48 12 Q54 12 54 18 L54 22 L58 30 L58 88 Q58 96 40 96 Q22 96 22 88 L22 30 Z"
          fill="rgba(255,255,255,0.03)"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="2"
        />
        {/* FULL dashed outline ring when not full */}
        {!full && (
          <path
            d="M26 22 L26 18 Q26 12 32 12 L48 12 Q54 12 54 18 L54 22 L58 30 L58 88 Q58 96 40 96 Q22 96 22 88 L22 30 Z"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        <g clipPath="url(#bottleInner)">
          <rect
            x="20"
            y={fillY}
            width="40"
            height={fillH + 2}
            fill={full ? "url(#waterFull)" : "url(#waterFill)"}
          />
          {/* wave */}
          <ellipse
            cx="40"
            cy={fillY}
            rx="20"
            ry="3.5"
            fill={full ? "oklch(85% 0.1 160 / 0.55)" : "oklch(85% 0.08 210 / 0.45)"}
          />
        </g>

        {/* bottle rim stroke on top */}
        <path
          d="M26 22 L26 18 Q26 12 32 12 L48 12 Q54 12 54 18 L54 22 L58 30 L58 88 Q58 96 40 96 Q22 96 22 88 L22 30 Z"
          fill="none"
          stroke={full ? "var(--accent)" : "rgba(255,255,255,0.22)"}
          strokeWidth="2.2"
        />

        {/* FULL badge */}
        {full && (
          <g>
            <rect x="22" y="48" width="36" height="16" rx="4" fill="oklch(15% 0.02 260 / 0.75)" />
            <text
              x="40"
              y="59"
              textAnchor="middle"
              fill="var(--accent)"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="700"
            >
              FULL
            </text>
          </g>
        )}

        {/* empty state hint */}
        {pct < 8 && (
          <text
            x="40"
            y="58"
            textAnchor="middle"
            fill="rgba(255,255,255,0.25)"
            fontSize="8"
            fontFamily="Figtree, sans-serif"
          >
            empty
          </text>
        )}
      </svg>
    </div>
  );
}

function PlantMeter({ pct, full }: { pct: number; full: boolean }) {
  const stemH = 8 + (pct / 100) * 48;
  const stemTop = 88 - stemH;
  const leaves = Math.min(6, Math.floor(pct / 16));

  return (
    <svg viewBox="0 0 120 140" width="180" height="210">
      <defs>
        <linearGradient id="stemGrad2" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="oklch(38% 0.06 145)" />
          <stop offset="100%" stopColor="oklch(62% 0.14 150)" />
        </linearGradient>
        <linearGradient id="leafGrad2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(70% 0.16 145)" />
          <stop offset="100%" stopColor="oklch(62% 0.14 160)" />
        </linearGradient>
        <linearGradient id="bloomGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="oklch(75% 0.14 320)" />
        </linearGradient>
      </defs>

      {/* full-height guide (what 100% looks like) */}
      <line
        x1="60"
        y1="88"
        x2="60"
        y2="32"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <text
        x="96"
        y="36"
        fill="rgba(255,255,255,0.2)"
        fontSize="7"
        fontFamily="JetBrains Mono, monospace"
      >
        FULL
      </text>
      <line x1="78" y1="32" x2="92" y2="32" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />

      {/* pot */}
      <path
        d="M38 90 L42 118 Q60 124 78 118 L82 90 Z"
        fill="oklch(26% 0.025 50)"
        stroke="rgba(255,255,255,0.1)"
      />
      <ellipse cx="60" cy="90" rx="24" ry="5" fill="oklch(30% 0.03 50)" />
      <ellipse cx="60" cy="89" rx="18" ry="3.5" fill="oklch(20% 0.025 60)" />

      {/* growing stem */}
      <line
        x1="60"
        y1="88"
        x2="60"
        y2={stemTop}
        stroke="url(#stemGrad2)"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* leaves along stem */}
      {Array.from({ length: leaves }).map((_, i) => {
        const t = (i + 1) / Math.max(leaves, 1);
        const y = 88 - stemH * (0.25 + t * 0.55);
        const side = i % 2 === 0 ? -1 : 1;
        const lx = 60 + side * (14 + (i % 3) * 3);
        return (
          <ellipse
            key={i}
            cx={lx}
            cy={y}
            rx={11}
            ry={5.5}
            fill="url(#leafGrad2)"
            transform={`rotate(${side * 40} ${lx} ${y})`}
            opacity={0.85 + t * 0.15}
          />
        );
      })}

      {/* bloom at full */}
      {full ? (
        <g>
          <circle cx="60" cy={stemTop - 2} r="11" fill="url(#bloomGrad)" />
          <circle cx="60" cy={stemTop - 2} r="4" fill="oklch(95% 0.05 90)" />
          <rect
            x="42"
            y={stemTop + 12}
            width="36"
            height="14"
            rx="4"
            fill="oklch(12% 0.02 260 / 0.8)"
          />
          <text
            x="60"
            y={stemTop + 22}
            textAnchor="middle"
            fill="var(--accent)"
            fontSize="8"
            fontFamily="JetBrains Mono, monospace"
            fontWeight="700"
          >
            FULL
          </text>
        </g>
      ) : pct < 8 ? (
        <text
          x="60"
          y="70"
          textAnchor="middle"
          fill="rgba(255,255,255,0.22)"
          fontSize="8"
          fontFamily="Figtree, sans-serif"
        >
          seed
        </text>
      ) : null}
    </svg>
  );
}
