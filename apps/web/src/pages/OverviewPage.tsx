import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ACTIVITIES, type AgendaItem } from "@life-os/shared";
import { api } from "@/lib/api";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { DayGraphic } from "@/components/graphics/DayGraphic";
import { AgendaList } from "@/components/AgendaList";
import { AgentCardsSection } from "@/components/AgentCardsSection";
import { ReminderRunner } from "@/components/ReminderRunner";
import { GoalCelebration } from "@/components/GoalCelebration";
import { toast } from "sonner";
import { motion } from "motion/react";

/**
 * The front page: the day, and what is on it.
 *
 * It used to open with five comparison tiles, two efficiency percentages, an
 * improvement delta and a seven-day XP chart — a report, above the work. All of
 * that is analysis, it all belongs on Analytics, and putting it first meant the
 * first thing the app said every morning was a number about yesterday.
 *
 * Now: the day drawn, and the day's list. The only judgement that survives here
 * is one word and one figure in the corner, because whether things are trending
 * up is worth a glance and not a dashboard.
 *
 * Habits and scheduled tasks are one list. They used to be two, which is what
 * let an agent create a habit *and* a task for the same act and gave the user
 * two things to tick.
 */
export function OverviewPage() {
  const qc = useQueryClient();
  const intensity = useUiStore((s) => s.celebrationIntensity);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 8000,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * One handler for both kinds, because the list is one list. `source` is the
   * only thing that differs, and it decides which record gets the completion —
   * the habit that owns the streak, or the task that owns the XP.
   */
  const complete = useMutation({
    mutationFn: (item: AgendaItem) =>
      item.source === "habit"
        ? api.completeHabit(item.refId)
        : api.completeTask(item.refId),
    onSuccess: (res: { xpAwarded?: number; streakRecovered?: boolean; error?: string }) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (res?.error) return;
      if (res?.streakRecovered) {
        celebrate(intensity, "streak");
        toast.success("Streak recovered");
        return;
      }
      celebrate(intensity, "complete");
      toast.success(res?.xpAwarded ? `+${res.xpAwarded} XP` : "Done");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undo = useMutation({
    mutationFn: (item: AgendaItem) => api.undoHabit(item.refId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const setActivity = useMutation({
    mutationFn: (activity: string) => api.setActiveSession(activity),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  if (isLoading || !data) {
    return <div className="text-[var(--muted)]">Loading…</div>;
  }

  const p = data.progress;
  const agenda = data.agenda ?? [];

  /* How far through the life-day we are — drives the sun on the arc graphic. */
  const dayStart = Date.parse(data.lifeDay.lifeDayStart);
  const dayEnd = Date.parse(data.lifeDay.lifeDayEnd);
  const dayProgress = Math.max(0, Math.min(1, (now - dayStart) / (dayEnd - dayStart)));

  const done = agenda.filter((i) => i.done).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-6xl pb-16"
    >
      <ReminderRunner due={data.dueReminders ?? []} />
      <GoalCelebration goals={data.pendingCelebrations ?? []} />

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting(now)}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {done} of {agenda.length} done today
          </p>
        </div>

        {/*
          The whole of the old metrics strip, reduced to what it was actually
          for. One word and one number: are things going up. Anything more
          belongs on Analytics, where there is room to be honest about it.
        */}
        <Link
          to="/app/analytics"
          className="shrink-0 rounded-2xl border border-white/[0.09] px-4 py-2.5 text-right transition-colors hover:bg-white/[0.04]"
          title="See the full picture on Analytics"
        >
          <div
            className="text-sm font-medium leading-tight"
            style={{ color: pulseColor(data.pulse) }}
          >
            {data.pulse}
          </div>
          <div className="mt-0.5 font-mono text-[11px] leading-tight text-[var(--faint)]">
            {p.improvementPct > 0 ? "+" : ""}
            {Math.round(p.improvementPct)}%
          </div>
        </Link>
      </header>

      {/*
        Graphic above, list below on a phone; side by side once there is room.
        The list is the part you touch, so on a narrow screen it gets the half
        nearest your thumb.
      */}
      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-12">
        <section className="flex flex-col items-center">
          <DayGraphic
            style={p.growthStyle}
            efficiencyPct={p.efficiencyPct}
            habits={data.habits}
            agenda={agenda}
            history={(data.consistency7 ?? []).map((d) => d.pct)}
            dayProgress={dayProgress}
            className="h-56 w-56 text-[var(--muted)] sm:h-64 sm:w-64"
          />

          <div className="mt-2 font-mono text-xs text-[var(--faint)]">
            {p.dailyXp} / {p.dailyXpTarget} XP
          </div>

          <DayRibbon timeline={data.timeline} now={now} />

          {/*
            Kept because it is a control, not a readout: this is the only thing
            that writes what activity you are in, and nothing else should.
          */}
          <div className="mt-6 flex w-full flex-wrap justify-center gap-1.5">
            {ACTIVITIES.map((a) => {
              const on = data.activeSession?.activity === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActivity.mutate(a)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    on
                      ? "bg-[var(--accent)] font-medium text-[oklch(12%_0.02_260)]"
                      : "bg-white/[0.04] text-[var(--muted)] hover:bg-white/[0.08]",
                  )}
                >
                  {a}
                </button>
              );
            })}
          </div>

          {/*
            Under the graphic rather than below the fold. This column ran out of
            content halfway down while the cards sat full-width underneath, so
            the page had a hole in it and its most-read prose was the last thing
            you reached. Stacked, because half a wide card is unreadable.
          */}
          <div className="mt-8 w-full">
            <AgentCardsSection
              tasks={data.tasks}
              habits={data.habits}
              stacked
              busy={complete.isPending}
              onComplete={(id) =>
                complete.mutate({ source: "task", refId: id } as AgendaItem)
              }
            />
          </div>
        </section>

        <section className="min-w-0">
          <AgendaList
            items={agenda}
            busy={complete.isPending || undo.isPending}
            onComplete={(item) => complete.mutate(item)}
            onUndo={(item) => undo.mutate(item)}
          />
        </section>
      </div>


    </motion.div>
  );
}

function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 22) return "Evening";
  return "Tonight";
}

function pulseColor(pulse: string): string {
  if (pulse === "Improving") return "#34D399";
  if (pulse === "Recovering") return "#FBBF24";
  if (pulse === "Drifting") return "#94A3B8";
  return "var(--accent)";
}

/**
 * The 24-hour ribbon, kept because it is the one thing that shows the *shape*
 * of a day rather than its contents. Behind the marker it is what you actually
 * did, from the activity log; ahead of it, what is planned.
 */
function DayRibbon({
  timeline,
  now,
}: {
  timeline: { id: string; startHour: number; endHour: number; color: string; status: string; label: string; category: string }[];
  now: number;
}) {
  const clock = new Date(now);
  const hourFrac = clock.getHours() + clock.getMinutes() / 60;

  const segs = [...timeline]
    .map((b) => {
      const start = Math.max(0, Math.min(24, Number(b.startHour) || 0));
      let end = Math.max(0, Math.min(24, Number(b.endHour) || 0));
      if (end < start) end = start;
      return { ...b, startHour: start, endHour: end };
    })
    .filter((b) => b.endHour > b.startHour)
    .sort((a, b) => a.startHour - b.startHour);

  return (
    <div className="mt-6 w-full">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.03]">
        {segs.map((b, i) => (
          <div
            key={`${b.id}-${i}`}
            title={`${b.label} · ${b.category}`}
            className="absolute top-0 bottom-0"
            style={{
              left: `${(b.startHour / 24) * 100}%`,
              width: `calc(${((b.endHour - b.startHour) / 24) * 100}% + 0.2px)`,
              backgroundColor: b.color,
              opacity: b.status === "done" ? 0.5 : 0.95,
            }}
          />
        ))}
        <div
          className="pointer-events-none absolute top-[-2px] bottom-[-2px] z-10 w-0.5 bg-white"
          style={{ left: `${(hourFrac / 24) * 100}%` }}
          title="Now"
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--faint)]">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
