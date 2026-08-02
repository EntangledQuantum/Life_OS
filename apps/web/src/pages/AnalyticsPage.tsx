import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { NurtureVisual } from "@/components/graphics/NurtureVisual";
import { motion } from "motion/react";
import { formatDelta } from "@/lib/utils";

export function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: api.analytics,
  });

  if (isLoading || !data) {
    return <div className="text-[var(--muted)]">Loading analytics…</div>;
  }

  const p = data.progress;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-[var(--muted)]">
          Efficiency & improvement — no levels, no social comparison.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card flex flex-col items-center p-5">
          <NurtureVisual
            efficiencyPct={p.efficiencyPct}
            style={p.nurtureStyle === "water" ? "water" : "plant"}
            dailyXp={p.dailyXp}
            dailyXpTarget={p.dailyXpTarget}
          />
          <div className="mt-2 grid w-full grid-cols-2 gap-2 text-center">
            <div>
              <div className="font-mono text-2xl font-bold text-[var(--accent)]">
                {Math.round(p.efficiencyPct)}%
              </div>
              <div className="text-xs text-[var(--muted)]">efficiency</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold">
                {formatDelta(p.improvementPct)}%
              </div>
              <div className="text-xs text-[var(--muted)]">improvement</div>
            </div>
          </div>
          <div className="mt-2 font-mono text-xs text-[var(--muted)]">
            {p.dailyXp}/{p.dailyXpTarget} XP · pulse {data.pulse}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">
            XP target vs current (7 days)
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.xpSeries7}>
                <defs>
                  <linearGradient id="aXp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => d.slice(5)}
                  stroke="var(--faint)"
                  fontSize={10}
                />
                <YAxis stroke="var(--faint)" fontSize={10} width={32} />
                <Tooltip
                  contentStyle={{
                    background: "oklch(14% 0.014 260)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="current"
                  name="Current XP"
                  stroke="var(--accent)"
                  fill="url(#aXp)"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="target"
                  name="Target"
                  stroke="oklch(70% 0.06 260)"
                  strokeDasharray="5 5"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">
            Consistency by category
          </div>
          <div className="space-y-3">
            {data.byCategory.map((c: { category: string; pct: number }) => (
              <div key={c.category}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{c.category}</span>
                  <span className="font-mono text-[var(--muted)]">{c.pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${c.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 text-xs uppercase tracking-wider text-[var(--muted)]">
            Achievements
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.achievements.map(
              (a: {
                id: string;
                emoji: string;
                title: string;
                description: string;
                unlockedAt: string | null;
              }) => (
                <div
                  key={a.id}
                  className="rounded-2xl border border-[var(--border)] p-3"
                  style={{
                    opacity: a.unlockedAt ? 1 : 0.4,
                    background: a.unlockedAt ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <div className="text-xl">{a.emoji}</div>
                  <div className="mt-1 font-medium">{a.title}</div>
                  <div className="text-xs text-[var(--muted)]">{a.description}</div>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
