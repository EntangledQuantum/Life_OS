import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Same four words the front-page chip uses, so they cannot drift apart. */
function pulseColor(pulse: string): string {
  if (pulse === "Improving") return "#34D399";
  if (pulse === "Recovering") return "#FBBF24";
  if (pulse === "Drifting") return "#94A3B8";
  return "var(--accent)";
}

const RANGES = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All" },
] as const;

/**
 * Analytics.
 *
 * The question this page exists to answer is "is this getting better or worse",
 * and the old one could not: an XP chart, a list of category percentages and a
 * wall of achievements are three snapshots of *now*. Everything here is a
 * series, and everything with a target draws the target on the same axis — a
 * number without its target is not a measurement.
 */
export function AnalyticsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("30d");

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", range],
    queryFn: () => api.analytics(range),
  });

  /*
   * The day-over-day comparison used to open the front page as five tiles and
   * two percentages. It is analysis, not work, and the first thing the app said
   * every morning should not be a number about yesterday. It lives here, where
   * there is room to show it against a series instead of on its own.
   */
  const { data: today } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return <div className="text-[var(--muted)]">Loading analytics…</div>;
  }

  const shortDate = (d: string) => d.slice(5);
  const totalXp = data.daily.reduce((a, d) => a + d.xp, 0);
  const daysOnTarget = data.daily.filter((d) => d.xp >= d.xpTarget).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // charts and prose, sized for a reading column
      className="mx-auto max-w-6xl space-y-10 pb-16"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Target and actual on the same axis. No levels, no comparison to
            anyone else.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded-full px-3 py-1.5 transition-colors",
                range === r.id
                  ? "bg-white/[0.1] text-[var(--text)]"
                  : "text-[var(--faint)] hover:text-[var(--muted)]",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {today && (
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h2
              className="text-lg font-semibold"
              style={{ color: pulseColor(today.pulse) }}
            >
              {today.pulse}
            </h2>
            <span className="text-sm text-[var(--muted)]">
              {today.pulseExplanation}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-y-6 sm:grid-cols-5">
            {[
              {
                label: "Habits",
                value: today.vsYesterday.habitsCompleted.today,
                delta: today.vsYesterday.habitsCompleted.delta,
              },
              {
                label: "XP",
                value: today.vsYesterday.xpEarned.today,
                delta: today.vsYesterday.xpEarned.delta,
              },
              {
                label: "Efficiency",
                value: `${Math.round(today.vsYesterday.efficiency.today)}%`,
                delta: today.vsYesterday.efficiency.delta,
              },
              {
                label: "Study",
                value: `${today.vsYesterday.studyMinutes.today}m`,
                delta: today.vsYesterday.studyMinutes.delta,
              },
              {
                label: "Sleep",
                value: today.vsYesterday.sleepScore.today ?? "—",
                delta: today.vsYesterday.sleepScore.delta,
              },
            ].map((s) => (
              <div key={s.label}>
                <div className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
                  {s.value}
                </div>
                {typeof s.delta === "number" && (
                  <div
                    className="mt-0.5 font-mono text-xs"
                    style={{
                      color:
                        s.delta > 0
                          ? "#34D399"
                          : s.delta < 0
                            ? "#94A3B8"
                            : "var(--faint)",
                    }}
                  >
                    {s.delta > 0 ? "+" : ""}
                    {Math.round(s.delta)} vs yesterday
                  </div>
                )}
                <div className="mt-1 text-[11px] uppercase tracking-wider text-[var(--faint)]">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-y-6 sm:grid-cols-4">
        <Stat label="Days recorded" value={data.daily.length} />
        <Stat
          label="Days on target"
          value={`${daysOnTarget}/${data.daily.length}`}
        />
        <Stat label="XP earned" value={totalXp} />
        <Stat label="Study" value={`${Math.round(data.study.totalMinutes / 60)}h`} />
      </section>

      {/* ------------------------------------------------------ XP vs target */}
      <Panel
        title="XP against target"
        hint="The dashed line is your daily target — the point is the gap, not the number."
      >
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.daily}
              margin={{ top: 6, right: 6, left: -18, bottom: 0 }}
            >
              <defs>
                <linearGradient id="xpFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis {...axis} dataKey="date" tickFormatter={shortDate} />
              <YAxis {...axis} width={36} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="xp"
                name="Earned"
                stroke="var(--accent)"
                fill="url(#xpFill)"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="xpTarget"
                name="Target"
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* ------------------------------------------------- efficiency & habits */}
      <div className="grid gap-10 lg:grid-cols-2">
        <Panel
          title="Efficiency over time"
          hint="100% is the target line. Above it is a day you beat your own bar."
        >
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.daily}
                margin={{ top: 6, right: 6, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis {...axis} dataKey="date" tickFormatter={shortDate} />
                <YAxis {...axis} width={36} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="efficiencyPct"
                  name="Efficiency %"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="efficiencyTarget"
                  name="Target"
                  stroke="rgba(255,255,255,0.3)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="Habits done vs possible"
          hint="How much of the day's habit list you actually closed."
        >
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.daily}
                margin={{ top: 6, right: 6, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis {...axis} dataKey="date" tickFormatter={shortDate} />
                <YAxis {...axis} width={36} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="habitsCompleted" name="Done" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                <Line
                  type="stepAfter"
                  dataKey="habitsPossible"
                  name="Possible"
                  stroke="rgba(255,255,255,0.3)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------------ per-habit rates */}
      <Panel
        title="Which habits are carrying the day"
        hint="Rate is over the days each habit actually existed, not the whole window."
      >
        {data.habits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No active habits yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.habits.map((h) => (
              <li key={h.id} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-center text-base">{h.emoji}</span>
                <span className="w-32 shrink-0 truncate text-sm">{h.name}</span>
                <span className="flex min-w-0 flex-1 gap-[2px]">
                  {h.history.map((d) => (
                    <span
                      key={d.date}
                      title={`${d.date} · ${d.done ? "done" : "missed"}`}
                      className="h-4 min-w-[3px] flex-1 rounded-[2px]"
                      style={{
                        background: d.done ? h.themeColor : "rgba(255,255,255,0.06)",
                      }}
                    />
                  ))}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums">
                  {h.ratePct}%
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[10px] text-[var(--faint)]">
                  {h.currentStreak}d
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* --------------------------------------------------------- adherence */}
      <div className="grid gap-10 lg:grid-cols-2">
        <Panel
          title="Schedule adherence"
          hint="Of the things that had a time on them, how many you actually did."
        >
          <div className="mb-4 grid grid-cols-4 gap-2">
            <Stat small label="Scheduled" value={data.adherence.scheduled} />
            <Stat small label="Completed" value={data.adherence.completed} />
            <Stat small label="Late" value={data.adherence.completedLate} />
            <Stat small label="Rate" value={`${data.adherence.ratePct}%`} />
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.adherence.byDay}
                margin={{ top: 6, right: 6, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis {...axis} dataKey="date" tickFormatter={shortDate} />
                <YAxis {...axis} width={30} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="scheduled" name="Scheduled" fill="rgba(255,255,255,0.15)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="var(--accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Study" hint="Minutes recorded when a study task was completed.">
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Stat small label="Sessions" value={data.study.sessions} />
            <Stat small label="Minutes" value={data.study.totalMinutes} />
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.study.byDay}
                margin={{ top: 6, right: 6, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis {...axis} dataKey="date" tickFormatter={shortDate} />
                <YAxis {...axis} width={30} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="minutes" name="Minutes" fill="#C084FC" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------------ agent counters */}
      {data.properties.length > 0 && (
        <Panel
          title="Agent counters"
          hint="Whatever your agent decided to keep track of, and how it moved."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            {data.properties.map((p) => (
              <div key={p.uid}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm">{p.label}</span>
                  <span className="font-mono text-sm tabular-nums">
                    {p.current ?? "—"}
                    {p.unit ? ` ${p.unit}` : ""}
                    {p.delta !== null && p.delta !== 0 && (
                      <span
                        className="ml-2 text-[11px]"
                        style={{ color: p.delta > 0 ? "#34D399" : "#94A3B8" }}
                      >
                        {p.delta > 0 ? "+" : ""}
                        {p.delta}
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-16 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={p.series} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={() => ""} />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name={p.label}
                        stroke="var(--accent)"
                        strokeWidth={1.75}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------------- goals */}
      {data.goals.length > 0 && (
        <Panel title="Goal progression" hint="How each goal has moved toward its condition.">
          <div className="space-y-5">
            {data.goals.map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm">
                    {g.emoji} {g.title}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                    {Math.round(g.progressPct)}%
                  </span>
                </div>
                {g.series.length > 1 ? (
                  <div className="h-16 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={g.series} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={() => ""} />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name="Progress %"
                          stroke={g.themeColor}
                          fill={`${g.themeColor}22`}
                          strokeWidth={1.75}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  /* One point is not a curve. Draw the bar and say so. */
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${g.progressPct}%`, background: g.themeColor }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </motion.div>
  );
}

const axis = {
  stroke: "var(--faint)",
  fontSize: 10,
  axisLine: false,
  tickLine: false,
} as const;

const tooltipStyle = {
  background: "oklch(12% 0.014 260)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 12,
} as const;

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
        {title}
      </h2>
      {hint && <p className="mt-1 mb-3 text-xs text-[var(--muted)]">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: ReactNode;
  small?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "font-mono font-semibold tabular-nums tracking-tight",
          small ? "text-lg" : "text-2xl",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--faint)]">
        {label}
      </div>
    </div>
  );
}
