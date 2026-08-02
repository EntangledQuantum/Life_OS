/** Liquid / water fill progress for volume-style habits */
export function LiquidFill({
  pct,
  color = "#22D3EE",
  label,
}: {
  pct: number;
  color?: string;
  label?: string;
}) {
  const fill = Math.min(100, Math.max(0, pct));
  const y = 100 - fill;

  return (
    <div className="relative h-14 w-full overflow-hidden rounded-xl border border-white/5 bg-black/30">
      <div
        className="absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out"
        style={{
          height: `${fill}%`,
          background: `linear-gradient(180deg, ${color}99, ${color})`,
          boxShadow: `0 0 24px ${color}55`,
        }}
      >
        <div
          className="absolute -top-2 left-0 right-0 h-4 opacity-70"
          style={{
            background: `repeating-linear-gradient(
              90deg,
              transparent,
              transparent 10px,
              ${color} 10px,
              ${color} 20px
            )`,
            animation: "wave 1.2s linear infinite",
            maskImage: "linear-gradient(to bottom, black, transparent)",
          }}
        />
      </div>
      <div className="relative z-10 flex h-full items-center justify-center font-mono text-xs font-semibold">
        {label ?? `${Math.round(fill)}%`}
      </div>
      {/* decorative glass rim */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
      />
      <span className="sr-only">{y}</span>
    </div>
  );
}
