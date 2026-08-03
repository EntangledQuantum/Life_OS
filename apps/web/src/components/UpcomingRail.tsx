import { useEffect, useState } from "react";
import { Bell, Check, ExternalLink, Play, Repeat } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardCard } from "@life-os/shared";
import { cn } from "@/lib/utils";

/**
 * What is about to happen — the next 15 minutes, plus anything overdue.
 *
 * Deliberately a **list**, not a grid of cards. The dashboard answers "what am
 * I doing now"; a stack of tall panels turns that back into a to-do list. The
 * full agent schedule lives on the Timeline tab.
 */
export function UpcomingRail({
  cards,
  scheduledCount = 0,
  onStart,
  onComplete,
  busy,
}: {
  cards: DashboardCard[];
  /** Total scheduled items, so we can point at the Timeline tab for the rest. */
  scheduledCount?: number;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  busy?: boolean;
}) {
  // Re-render every 30s so "in 12m" does not go stale while the page sits open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const later = Math.max(0, scheduledCount - cards.length);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
          Up next
        </h2>
        <Link
          to="/app/timeline"
          className="font-mono text-[10px] text-[var(--faint)] transition-colors hover:text-[var(--muted)]"
        >
          {later > 0 ? `+${later} later · timeline →` : "timeline →"}
        </Link>
      </div>

      {cards.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted)]">
          Nothing in the next 15 minutes.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {cards.map((card) => (
            <UpcomingRow
              key={card.id}
              card={card}
              now={now}
              busy={busy}
              onStart={() => onStart(card.id)}
              onComplete={() => onComplete(card.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function relativeTime(target: string, now: number): string {
  const diffMs = new Date(target).getTime() - now;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  if (mins < 1) return "now";
  const label =
    mins < 60
      ? `${mins}m`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / (60 * 24))}d`;
  return diffMs > 0 ? `in ${label}` : `${label} late`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UpcomingRow({
  card,
  now,
  onStart,
  onComplete,
  busy,
}: {
  card: DashboardCard;
  now: number;
  onStart: () => void;
  onComplete: () => void;
  busy?: boolean;
}) {
  const color = card.themeColor ?? "#5B8CFF";
  const running = Boolean(card.linkedBlockId);
  const overdue = Boolean(card.eventAt && new Date(card.eventAt).getTime() < now);

  // Pulses while the ping has landed and the thing is still open — being told
  // about something is not the same as dealing with it.
  const due =
    !!card.remindAt &&
    new Date(card.remindAt).getTime() <= now &&
    card.status === "active";

  const startable = card.kind === "event" && !running;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2 py-2.5 transition-colors",
        due && "reminder-due-row",
      )}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
        style={{ background: `${color}1f` }}
        aria-hidden
      >
        {card.emoji ?? (card.kind === "reminder" ? "🔔" : "🗓️")}
      </span>

      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{card.title}</span>
          {card.activityTag && (
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color }}>
              {card.activityTag}
            </span>
          )}
          {card.repeatRule !== "none" && (
            <Repeat
              className="h-3 w-3 text-[var(--faint)]"
              aria-label={`repeats ${card.repeatRule}`}
            />
          )}
        </div>
        {/* The agent decides what the line under the title says. */}
        {(card.subtitle || card.purpose) && (
          <p className="truncate text-xs text-[var(--muted)]">
            {card.subtitle ?? card.purpose}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 font-mono text-[11px]">
        {card.eventAt && (
          <span className={cn(overdue || due ? "text-[var(--accent)]" : "text-[var(--faint)]")}>
            {clockTime(card.eventAt)} · {relativeTime(card.eventAt, now)}
          </span>
        )}
        {!card.eventAt && card.remindAt && (
          <span className="flex items-center gap-1 text-[var(--faint)]">
            <Bell className="h-3 w-3" />
            {clockTime(card.remindAt)}
          </span>
        )}
        {card.durationMinutes && (
          <span className="hidden text-[var(--faint)] sm:inline">
            {card.durationMinutes}m
          </span>
        )}
        {/* Reward, not an action — so it reads as "you'll get this". */}
        {card.xpOnComplete > 0 && (
          <span className="text-[#34D399]">+{card.xpOnComplete} XP</span>
        )}
        {running && <span className="text-[var(--accent)]">running</span>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
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
        {startable && (
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={onStart}
            title="Takes over the day timeline under this card's activity tag"
          >
            <Play className="h-3 w-3" /> Start
          </button>
        )}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-[var(--muted)] transition-colors hover:bg-white/[0.1] hover:text-[var(--text)]"
          disabled={busy}
          onClick={onComplete}
          title={
            card.xpOnComplete > 0
              ? `Mark done · +${card.xpOnComplete} XP`
              : "Mark done"
          }
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
