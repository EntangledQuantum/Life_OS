import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Bell, Calendar, Check, ExternalLink, Repeat } from "lucide-react";
import type { DashboardCard, ScheduleBlock, TimelineBlock } from "@life-os/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The full agent schedule.
 *
 * The dashboard only shows the next fifteen minutes, so this is where
 * everything else lives: every scheduled card your agent has queued, grouped by
 * day, plus today's planned blocks laid out against the clock.
 */
export function TimelinePage() {
  const qc = useQueryClient();
  /**
   * `?card=<id>` arrives from a clicked OS notification. The row is highlighted
   * and scrolled to, so the notification lands you on the thing itself with one
   * button left to press.
   */
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("card");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 15_000,
  });
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: api.cards,
    refetchInterval: 15_000,
  });
  // Every block, not just the study ones the dashboard highlights — this page
  // is the whole day.
  const { data: blocks = [] } = useQuery({
    queryKey: ["blocks"],
    queryFn: api.blocks,
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["cards"] });
  };

  const completeEvent = useMutation({
    mutationFn: (id: string) => api.completeEvent(id),
    onSuccess: () => {
      invalidate();
      toast.success("Done");
    },
  });

  const dismissEvent = useMutation({
    mutationFn: (id: string) => api.dismissEvent(id),
    onSuccess: invalidate,
  });

  const completeReview = useMutation({
    mutationFn: (id: string) => api.completeReview(id),
    onSuccess: () => {
      invalidate();
      toast.success("Review complete");
    },
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeCard(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["cards"] });
      toast.success(res.xpAwarded ? `Done · +${res.xpAwarded} XP` : "Done");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Open scheduled cards, grouped by the local day their event falls on. */
  const groups = useMemo(() => {
    const scheduled = cards.filter(
      (c) => (c.kind === "event" || c.kind === "reminder") && c.status === "active",
    );
    const byDay = new Map<string, DashboardCard[]>();
    for (const card of scheduled) {
      const when = card.eventAt ?? card.remindAt ?? card.showAt;
      // Cards with no time at all are still real work — bucket them separately
      // rather than dropping them off the only page that lists everything.
      const key = when ? dayKey(new Date(when)) : "unscheduled";
      const list = byDay.get(key) ?? [];
      list.push(card);
      byDay.set(key, list);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) =>
        (a.eventAt ?? a.remindAt ?? "").localeCompare(b.eventAt ?? b.remindAt ?? ""),
      );
    }
    return [...byDay.entries()].sort(([a], [b]) =>
      a === "unscheduled" ? 1 : b === "unscheduled" ? -1 : a.localeCompare(b),
    );
  }, [cards]);

  /** Agent events and light reviews, flattened into one actionable list. */
  const needsYou = useMemo(() => {
    const events = (dashboard?.agentEvents ?? [])
      .filter((e) => e.status === "pending")
      .map((e) => ({
        key: `ev-${e.id}`,
        kind: e.kind,
        title: e.title,
        body: e.body,
        link: e.link,
        xp: e.xpOnComplete,
        onComplete: () => completeEvent.mutate(e.id),
        onDismiss: () => dismissEvent.mutate(e.id),
      }));
    const reviews = (dashboard?.lightReviews ?? [])
      .filter((r) => !r.completedAt)
      .map((r) => ({
        key: `rev-${r.id}`,
        kind: "review",
        title: r.prompt,
        body: null as string | null,
        link: r.link ?? null,
        xp: 0,
        onComplete: () => completeReview.mutate(r.id),
        onDismiss: undefined,
      }));
    return [...reviews, ...events];
    // The mutation objects are stable; depending on them would rebuild forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.agentEvents, dashboard?.lightReviews]);

  const doneToday = cards.filter(
    (c) =>
      (c.kind === "event" || c.kind === "reminder") &&
      c.status === "done" &&
      c.completedAt &&
      dayKey(new Date(c.completedAt)) === dayKey(new Date()),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10 pb-16"
    >
      <header>
        <h1 className="text-2xl font-bold">Timeline</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <Calendar className="h-4 w-4 shrink-0" />
          Everything your agent has scheduled. The dashboard only shows the next
          fifteen minutes.
        </p>
      </header>

      {/*
        Agent-queued work lives here, next to the rest of what the agent has
        planned. It used to sit in the dashboard's Quick log and push the habits
        out of it entirely whenever the queue was non-empty — which, against an
        agent that always has something queued, was always.
      */}
      {needsYou.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
            Needs you
          </h2>
          <ul className="space-y-2">
            {needsYou.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.07] p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
                      {item.kind}
                    </span>
                    <span className="font-medium">{item.title}</span>
                  </div>
                  {item.body && (
                    <p className="mt-1 text-sm text-[var(--muted)]">{item.body}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="btn py-1.5 text-sm"
                    >
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary py-1.5 text-sm"
                    onClick={item.onComplete}
                  >
                    <Check className="h-3.5 w-3.5" /> Done
                    {item.xp ? ` · +${item.xp}` : ""}
                  </button>
                  {item.onDismiss && (
                    <button
                      type="button"
                      className="btn py-1.5 text-sm"
                      onClick={item.onDismiss}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dashboard && (
        <DayRibbon timeline={dashboard.timeline} blocks={blocks} now={now} />
      )}

      {isLoading && <div className="text-[var(--muted)]">Loading…</div>}

      {!isLoading && groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/[0.12] p-8 text-center">
          <p className="text-[var(--muted)]">
            Nothing scheduled. Ask your agent to put something in the calendar —
            a review, a reading block, a nudge before a call.
          </p>
        </div>
      )}

      {groups.map(([key, items]) => (
        <DayGroup
          key={key}
          dayKeyValue={key}
          cards={items}
          now={now}
          busy={complete.isPending}
          focusId={focusId}
          onComplete={(id) => complete.mutate(id)}
        />
      ))}

      {doneToday.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
            Done today
          </h2>
          <ul className="divide-y divide-white/[0.05]">
            {doneToday.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 px-2 py-2 text-sm text-[var(--faint)]"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span className="min-w-0 flex-1 truncate line-through">
                  {card.title}
                </span>
                {card.completedAt && (
                  <span className="font-mono text-[11px]">
                    {clockTime(card.completedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </motion.div>
  );
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(key: string): string {
  if (key === "unscheduled") return "No time set";
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  return new Date(`${key}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Today's planned day as a continuous colour ribbon with a live now marker. */
function DayRibbon({
  timeline,
  blocks,
  now,
}: {
  timeline: TimelineBlock[];
  blocks: ScheduleBlock[];
  now: number;
}) {
  const clock = new Date(now);
  const hourFrac = clock.getHours() + clock.getMinutes() / 60;
  const legend = [...new Map(timeline.map((b) => [b.category, b.color])).entries()];

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
          Today's shape
        </h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {legend.map(([cat, color]) => (
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

      <div className="relative h-4 w-full overflow-hidden rounded-full">
        {timeline.map((b, i) => (
          <div
            key={`${b.id}-${i}`}
            title={`${b.label} · ${b.category}${b.actual ? "" : " · planned"}`}
            className="absolute top-0 bottom-0"
            style={{
              left: `${(b.startHour / 24) * 100}%`,
              // Overdraw a hair to kill subpixel seams between neighbours.
              width: `calc(${((b.endHour - b.startHour) / 24) * 100}% + 0.2px)`,
              /*
               * Behind the marker the ribbon is what you actually did, so it is
               * painted solid. Ahead of it, it is only the plan — drawn as a
               * faint wash with a hatch, so the two are never mistaken for each
               * other at a glance.
               */
              backgroundColor: b.actual ? b.color : "transparent",
              backgroundImage: b.actual
                ? undefined
                : `repeating-linear-gradient(135deg, ${b.color}55 0 3px, transparent 3px 7px)`,
              boxShadow: b.actual ? undefined : `inset 0 0 0 1px ${b.color}44`,
              opacity: b.actual && b.status === "done" ? 0.75 : 1,
            }}
          />
        ))}
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
      <p className="mt-1 text-[10px] text-[var(--faint)]">
        Solid is what you did · hatched is what is planned
      </p>

      {blocks.length > 0 && (
        <ul className="mt-4 space-y-1">
          {blocks.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3 px-2 py-1.5 font-mono text-[11px] text-[var(--muted)]"
            >
              <span className="w-24 shrink-0 text-[var(--faint)]">
                {b.plannedStart ?? "—"}
                {b.plannedEnd ? `–${b.plannedEnd}` : ""}
              </span>
              <span className="min-w-0 flex-1 truncate font-sans text-sm">
                {b.label}
              </span>
              <span className="text-[var(--faint)]">{b.category}</span>
              {b.status === "done" && <Check className="h-3 w-3 text-[#34D399]" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayGroup({
  dayKeyValue,
  cards,
  now,
  onComplete,
  busy,
  focusId,
}: {
  dayKeyValue: string;
  cards: DashboardCard[];
  now: number;
  onComplete: (id: string) => void;
  busy?: boolean;
  focusId?: string | null;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 border-b border-white/[0.06] pb-2">
        <h2 className="text-sm font-semibold">{dayLabel(dayKeyValue)}</h2>
        <span className="font-mono text-[10px] text-[var(--faint)]">
          {cards.length} item{cards.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul>
        {cards.map((card) => (
          <AgendaRow
            key={card.id}
            card={card}
            now={now}
            busy={busy}
            focused={focusId === card.id}
            onComplete={() => onComplete(card.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/** One calendar row: time gutter on the left, the thing on the right. */
function AgendaRow({
  card,
  now,
  onComplete,
  busy,
  focused,
}: {
  card: DashboardCard;
  now: number;
  onComplete: () => void;
  busy?: boolean;
  focused?: boolean;
}) {
  const color = card.themeColor ?? "#5B8CFF";
  const when = card.eventAt ?? card.remindAt;
  const past = Boolean(when && new Date(when).getTime() < now);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  return (
    <li
      ref={ref}
      className={cn(
        "flex gap-3 py-2.5",
        focused &&
          "-mx-2 rounded-xl bg-[var(--accent)]/[0.08] px-2 ring-1 ring-[var(--accent)]/40",
      )}
    >
      <div className="w-14 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums">
        <div className={past ? "text-[var(--accent)]" : "text-[var(--muted)]"}>
          {when ? clockTime(when) : "—"}
        </div>
        {card.durationMinutes && (
          <div className="text-[10px] text-[var(--faint)]">
            {card.durationMinutes}m
          </div>
        )}
      </div>

      {/* Colour lives in this thin rail rather than glowing behind the row. */}
      <div
        className="w-0.5 shrink-0 rounded-full"
        style={{ background: color, opacity: past ? 0.4 : 1 }}
        aria-hidden
      />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">
              {card.emoji} {card.title}
            </span>
            {card.activityTag && (
              <span
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color }}
              >
                {card.activityTag}
              </span>
            )}
            {card.repeatRule !== "none" && (
              <span
                className="flex items-center gap-1 font-mono text-[10px] text-[var(--faint)]"
                title={
                  card.repeatRule === "spaced"
                    ? "Spaced repetition — the gap widens each time you complete it"
                    : `Repeats ${card.repeatRule}`
                }
              >
                <Repeat className="h-3 w-3" />
                {card.repeatRule}
              </span>
            )}
            {card.remindAt && (
              <span
                className="flex items-center gap-1 font-mono text-[10px] text-[var(--faint)]"
                title="Reminder fires here"
              >
                <Bell className="h-3 w-3" />
                {clockTime(card.remindAt)}
              </span>
            )}
          </div>
          {(card.subtitle || card.purpose) && (
            <p className="truncate text-xs text-[var(--muted)]">
              {card.subtitle ?? card.purpose}
            </p>
          )}
          {card.body && (
            <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-[var(--muted)]">
              {card.body}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {card.xpOnComplete > 0 && (
            <span className="font-mono text-[11px] text-[#34D399]">
              +{card.xpOnComplete} XP
            </span>
          )}
          {card.ctaLink && (
            <a
              href={card.ctaLink}
              target="_blank"
              rel="noreferrer"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-[var(--muted)] transition-colors hover:bg-white/[0.1] hover:text-[var(--text)]"
              title={card.ctaLabel ?? "Open"}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {/* One action. A scheduled thing is done or it isn't — it never runs. */}
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
              past
                ? "btn btn-primary"
                : "bg-white/[0.05] text-[var(--muted)] hover:bg-white/[0.1] hover:text-[var(--text)]",
            )}
            disabled={busy}
            onClick={onComplete}
            title="Mark done"
          >
            <Check className="h-3.5 w-3.5" /> Done
          </button>
        </div>
      </div>
    </li>
  );
}
