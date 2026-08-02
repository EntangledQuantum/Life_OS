import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ACTIVITIES,
  GROWTH_STYLES,
  type GrowthStyle,
  type HabitWithToday,
} from "@life-os/shared";
import { api } from "@/lib/api";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { cn, formatDelta, formatElapsed } from "@/lib/utils";
import { GrowthMeter } from "@/components/graphics/GrowthMeter";
import { AgentCard } from "@/components/AgentCard";
import { AgentCardsSection } from "@/components/AgentCardsSection";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Check, ExternalLink, Undo2, X } from "lucide-react";

/**
 * Open dashboard. Quick log prioritizes agent tasks (revision/reviews);
 * habits only when no pending agent work.
 */
export function OverviewPage() {
  const qc = useQueryClient();
  const intensity = useUiStore((s) => s.celebrationIntensity);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 8000,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeHabit(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (res.streakRecovered) {
        celebrate(intensity, "streak");
        toast.success("Streak recovered");
      } else if (!res.error) {
        celebrate(intensity, "complete");
        toast.success(`+${res.xpAwarded} XP`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undo = useMutation({
    mutationFn: (id: string) => api.undoHabit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const setActivity = useMutation({
    mutationFn: (activity: string) => api.setActiveSession(activity),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const completeEvent = useMutation({
    mutationFn: (id: string) => api.completeEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Logged · agent task complete");
    },
  });

  const dismissEvent = useMutation({
    mutationFn: (id: string) => api.dismissEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const completeReview = useMutation({
    mutationFn: (id: string) =>
      fetch(
        (import.meta.env.VITE_API_URL ?? "") + `/api/v1/reviews/${id}/complete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("lifeos_token") ?? ""}`,
          },
        },
      ).then(async (r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Review complete");
    },
  });

  const completeCard = useMutation({
    mutationFn: (id: string) =>
      fetch((import.meta.env.VITE_API_URL ?? "") + `/api/v1/cards/${id}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("lifeos_token") ?? ""}`,
        },
        body: JSON.stringify({ source: "user" }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
        return r.json();
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      celebrate(intensity, "complete");
      toast.success(
        res.xpAwarded
          ? `Card done · +${res.xpAwarded} XP`
          : "Card complete · agent notified if webhook set",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setGrowthStyle = useMutation({
    mutationFn: (growthStyle: GrowthStyle) =>
      fetch((import.meta.env.VITE_API_URL ?? "") + "/api/v1/gamification/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("lifeos_token") ?? ""}`,
        },
        body: JSON.stringify({ growthStyle }),
      }).then(async (r) => {
        if (!r.ok) throw new Error("Failed to update growth style");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Growth meter updated");
    },
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (isLoading || !data) {
    return <div className="text-[var(--muted)]">Loading…</div>;
  }

  const elapsed = data.activeSession
    ? now - new Date(data.activeSession.startedAt).getTime()
    : 0;
  const clock = new Date(now);
  const clockLabel = clock.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const hourFrac = clock.getHours() + clock.getMinutes() / 60;

  const pulseColor =
    data.pulse === "Improving"
      ? "#34D399"
      : data.pulse === "Recovering"
        ? "#FBBF24"
        : data.pulse === "Drifting"
          ? "#94A3B8"
          : "var(--accent)";

  const p = data.progress;
  const growthMode: GrowthStyle = p.growthStyle === "orb" ? "orb" : "sprout";

  const pendingEvents = data.agentEvents.filter((e) => e.status === "pending");
  const pendingReviews = (data.lightReviews ?? []).filter((r) => !r.completedAt);
  const agentQueueCount = pendingEvents.length + pendingReviews.length;
  /** When agent has work: Quick log shows only that. Habits return when queue is clear. */
  const showHabitsInQuickLog = agentQueueCount === 0;

  const deltas = [
    {
      label: "Habits",
      value: data.vsYesterday.habitsCompleted.today,
      delta: data.vsYesterday.habitsCompleted.delta,
    },
    {
      label: "XP",
      value: data.vsYesterday.xpEarned.today,
      delta: data.vsYesterday.xpEarned.delta,
    },
    {
      label: "Efficiency",
      value: `${Math.round(data.vsYesterday.efficiency.today)}%`,
      delta: data.vsYesterday.efficiency.delta,
    },
    {
      label: "Study",
      value: `${data.vsYesterday.studyMinutes.today}m`,
      delta: data.vsYesterday.studyMinutes.delta,
    },
    {
      label: "Sleep",
      value: data.vsYesterday.sleepScore.today ?? "—",
      delta: data.vsYesterday.sleepScore.delta,
    },
  ];

  // Solid bar: absolute % widths from continuous 0–24 segments (no Free holes)
  const segs = [...data.timeline]
    .map((b) => {
      const start = Math.max(0, Math.min(24, Number(b.startHour) || 0));
      let end = Math.max(0, Math.min(24, Number(b.endHour) || 0));
      if (end < start) end = start;
      return { ...b, startHour: start, endHour: end };
    })
    .filter((b) => b.endHour > b.startHour)
    .sort((a, b) => a.startHour - b.startHour);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-6xl space-y-10 pb-16"
    >
      <header className="flex flex-col gap-6 border-b border-white/[0.06] pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--faint)]">
            {data.date} · resets {data.dayResetTime}
          </p>
          <h1
            className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl"
            style={{ color: pulseColor }}
          >
            {data.pulse}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">
            {data.pulseExplanation}
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-sm">
            <span>
              <span className="text-2xl font-semibold text-[var(--accent)]">
                {Math.round(p.efficiencyPct)}%
              </span>
              <span className="ml-2 text-[var(--faint)]">efficiency</span>
            </span>
            <span>
              <span
                className="text-2xl font-semibold"
                style={{
                  color:
                    p.improvementPct > 0
                      ? "#34D399"
                      : p.improvementPct < 0
                        ? "#94A3B8"
                        : "var(--text)",
                }}
              >
                {formatDelta(p.improvementPct)}%
              </span>
              <span className="ml-2 text-[var(--faint)]">vs yesterday</span>
            </span>
            <span className="text-[var(--faint)]">
              {p.dailyXp}/{p.dailyXpTarget} XP
            </span>
          </div>
        </div>

        <div className="sm:text-right">
          <p className="font-mono text-xs text-[var(--faint)]">{clockLabel}</p>
          <p className="mt-1 font-mono text-4xl font-semibold tracking-tight text-[var(--accent)] sm:text-5xl">
            {data.activeSession ? formatElapsed(elapsed) : "00:00:00"}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {data.activeSession
              ? `Doing · ${data.activeSession.activity}`
              : "Nothing running — pick below"}
          </p>
        </div>
      </header>

      <section>
        <SectionLabel>Today vs yesterday</SectionLabel>
        <div className="mt-4 grid grid-cols-2 gap-y-6 sm:grid-cols-5">
          {deltas.map((s, i) => (
            <div
              key={s.label}
              className={cn("sm:px-4", i > 0 && "sm:border-l sm:border-white/[0.06]")}
            >
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
                  {formatDelta(s.delta)} vs yday
                </div>
              )}
              <div className="mt-1 text-[11px] uppercase tracking-wider text-[var(--faint)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <AgentCardsSection
        cards={data.cards ?? []}
        busy={completeCard.isPending}
        onComplete={(id) => completeCard.mutate(id)}
      />

      <section>
        <SectionLabel>Right now</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIVITIES.map((a) => {
            const on = data.activeSession?.activity === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setActivity.mutate(a)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm transition-colors",
                  on
                    ? "bg-[var(--accent)] font-medium text-[oklch(12%_0.02_260)]"
                    : "bg-white/[0.04] text-[var(--muted)] hover:bg-white/[0.08] hover:text-[var(--text)]",
                )}
              >
                {a}
              </button>
            );
          })}
        </div>
      </section>

      {/* Solid 24h ribbon: neighbors share edges — zero black Free gaps */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <SectionLabel className="mb-0">Day timeline</SectionLabel>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {[
              ...new Map(segs.map((b) => [b.category, b.color])).entries(),
            ].map(([cat, color]) => (
              <span
                key={cat}
                className="flex items-center gap-1.5 text-[10px] text-[var(--faint)]"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: color }}
                />
                {cat}
              </span>
            ))}
          </div>
        </div>
        <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-transparent">
          {segs.map((b, i) => {
            const left = (b.startHour / 24) * 100;
            const width = ((b.endHour - b.startHour) / 24) * 100;
            // overdraw 0.2px to kill subpixel seams
            return (
              <div
                key={`${b.id}-${i}`}
                title={`${b.label} · ${b.category}`}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${left}%`,
                  width: `calc(${width}% + 0.2px)`,
                  backgroundColor: b.color,
                  opacity: b.status === "done" ? 0.55 : 1,
                }}
              />
            );
          })}
          <div
            className="pointer-events-none absolute top-[-2px] bottom-[-2px] z-10 w-0.5 bg-white"
            style={{ left: `${(hourFrac / 24) * 100}%` }}
            title="Now"
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] text-[var(--faint)]">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-12">
        <section className="lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel className="mb-0">Growth</SectionLabel>
            <div className="flex gap-1 text-xs">
              {GROWTH_STYLES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setGrowthStyle.mutate(mode)}
                  className={cn(
                    "rounded-full px-3 py-1 capitalize transition-colors",
                    growthMode === mode
                      ? "bg-white/[0.1] text-[var(--text)]"
                      : "text-[var(--faint)] hover:text-[var(--muted)]",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <GrowthMeter
              efficiencyPct={p.efficiencyPct}
              style={growthMode}
              dailyXp={p.dailyXp}
              dailyXpTarget={p.dailyXpTarget}
            />
          </div>
        </section>

        <section className="lg:col-span-7">
          <div className="flex items-baseline justify-between gap-2">
            <SectionLabel className="mb-0">Quick log</SectionLabel>
            {agentQueueCount > 0 && (
              <span className="font-mono text-[10px] text-[var(--accent)]">
                {agentQueueCount} agent · flash until done
              </span>
            )}
          </div>

          <ul className="mt-3 divide-y divide-white/[0.05]">
            {/* Agent revision / reviews / tasks first — flash until complete */}
            {pendingReviews.map((r) => (
              <QuickLogAgentItem
                key={`rev-${r.id}`}
                kind="review"
                title={r.prompt}
                body="Light review · stored for Hermes retrieval"
                link={r.link}
                onComplete={() => completeReview.mutate(r.id)}
              />
            ))}
            {pendingEvents.map((ev) => (
              <QuickLogAgentItem
                key={ev.id}
                kind={ev.kind}
                title={ev.title}
                body={ev.body}
                link={ev.link}
                onComplete={() => completeEvent.mutate(ev.id)}
                onDismiss={() => dismissEvent.mutate(ev.id)}
              />
            ))}

            {showHabitsInQuickLog &&
              data.habits.slice(0, 6).map((h) => (
                <HabitRow
                  key={h.id}
                  habit={h}
                  busy={complete.isPending || undo.isPending}
                  onComplete={() => complete.mutate(h.id)}
                  onUndo={() => undo.mutate(h.id)}
                />
              ))}

            {!showHabitsInQuickLog && agentQueueCount > 0 && (
              <li className="py-3 text-xs text-[var(--faint)]">
                Habits hidden while agent work is open — complete or dismiss above.
                Full habit list stays under Habits tab.
              </li>
            )}

            {showHabitsInQuickLog && data.habits.length === 0 && agentQueueCount === 0 && (
              <li className="py-3 text-sm text-[var(--muted)]">
                Nothing queued. Hermes can inject reviews/tasks anytime.
              </li>
            )}
          </ul>

          <div className="mt-10">
            <SectionLabel>XP · target vs current</SectionLabel>
            <div className="mt-2 h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.xpSeries7}
                  margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="xpOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => d.slice(5)}
                    stroke="var(--faint)"
                    fontSize={10}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="var(--faint)"
                    fontSize={10}
                    width={32}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(12% 0.014 260)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    name="Current"
                    stroke="var(--accent)"
                    fill="url(#xpOpen)"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="target"
                    name="Target"
                    stroke="rgba(255,255,255,0.25)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

function QuickLogAgentItem({
  kind,
  title,
  body,
  link,
  onComplete,
  onDismiss,
}: {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  onComplete: () => void;
  onDismiss?: () => void;
}) {
  return (
    <li className="quicklog-flash relative flex flex-wrap items-start gap-3 py-3 pl-3">
      <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[var(--accent)]" />
      <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
            {kind}
          </span>
          <span className="font-medium">{title}</span>
        </div>
        {body && <p className="mt-1 text-sm text-[var(--muted)]">{body}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary py-1.5 text-sm"
          >
            Do it <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button type="button" className="btn btn-primary py-1.5 text-sm" onClick={onComplete}>
          <Check className="h-3.5 w-3.5" /> Complete
        </button>
        {onDismiss && (
          <button type="button" className="btn py-1.5 text-sm" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

function HabitRow({
  habit,
  onComplete,
  onUndo,
  busy,
}: {
  habit: HabitWithToday;
  onComplete: () => void;
  onUndo: () => void;
  busy?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg"
        style={{ background: `${habit.themeColor}18` }}
      >
        {habit.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{habit.name}</div>
        <div className="mt-1 flex items-center gap-1">
          {habit.history7.map((done, i) => (
            <span
              key={i}
              className="h-1 flex-1 rounded-full"
              style={{
                background: done ? habit.themeColor : "rgba(255,255,255,0.06)",
              }}
            />
          ))}
        </div>
      </div>
      <span className="hidden font-mono text-[10px] text-[var(--faint)] sm:inline">
        {habit.currentStreak}d · {habit.baseXp}xp
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => (habit.completedToday ? onUndo() : onComplete())}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
          habit.completedToday
            ? "text-[oklch(12%_0.02_260)]"
            : "bg-white/[0.05] text-[var(--muted)] hover:bg-white/[0.1]",
        )}
        style={
          habit.completedToday ? { background: habit.themeColor } : undefined
        }
        title={habit.completedToday ? "Undo" : "Complete"}
      >
        {habit.completedToday ? (
          <Undo2 className="h-4 w-4" />
        ) : (
          <Check className="h-4 w-4" />
        )}
      </button>
    </li>
  );
}
