import { Check, Undo2 } from "lucide-react";
import type { AgendaItem } from "@life-os/shared";
import { cn } from "@/lib/utils";

/**
 * Today, as **one** list.
 *
 * Two things went wrong before this. Habits and scheduled tasks were rendered
 * as separate lists, which is what made it reasonable for an agent to create
 * one of each for the same act — two rows to tick, XP paid twice if you ticked
 * both. And then, having merged them, the merged list was split again into
 * "Today" and "Anytime", so a habit with no time sat in a second section
 * underneath a task with a similar name and read as a duplicate of it.
 *
 * There are no sections now. Everything that is on today is in one place, in
 * the order it happens, with untimed work after the timed. A row does not move
 * when you tick it — it stays where it was and shows as done, because a list
 * that reorders under your finger is a list you have to re-read.
 *
 * At the reset the habits come back open on their own: a habit is not done
 * until it is logged, and a log belongs to the life-day it was written in.
 */
export function AgendaList({
  items,
  busy,
  onComplete,
  onUndo,
}: {
  items: AgendaItem[];
  busy: boolean;
  onComplete: (item: AgendaItem) => void;
  onUndo: (item: AgendaItem) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-white/[0.06] px-4 py-8 text-center text-sm text-[var(--muted)]">
        Nothing on today. Ask your agent to set up some habits.
      </p>
    );
  }

  const done = items.filter((i) => i.done).length;

  return (
    <section>
      <header className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
          Today
        </h2>
        <span className="font-mono text-[11px] text-[var(--faint)]">
          {done}/{items.length}
        </span>
      </header>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <Row
            key={item.id}
            item={item}
            busy={busy}
            onComplete={onComplete}
            onUndo={onUndo}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  item,
  busy,
  onComplete,
  onUndo,
}: {
  item: AgendaItem;
  busy: boolean;
  onComplete: (item: AgendaItem) => void;
  onUndo: (item: AgendaItem) => void;
}) {
  /*
   * 24-hour, always. The locale default gave "07:30 AM", which wrapped the
   * fixed-width column onto two lines and pushed every row taller — and the
   * ribbon underneath is already labelled 00/06/12/18/24, so a 12-hour list
   * above it made the two disagree.
   */
  const time = item.at
    ? new Date(item.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : null;

  const isHabit = item.source === "habit";

  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        item.done
          ? "border-transparent bg-white/[0.02]"
          : item.state === "now"
            ? "border-[var(--accent)]/40 bg-[var(--accent)]/[0.06]"
            : "border-white/[0.06] hover:bg-white/[0.03]",
      )}
    >
      {/*
        A fixed-width time column, so the list reads as a schedule rather than
        as ragged text. Untimed rows keep the column and leave it blank instead
        of collapsing it, which would make them look like a different kind of
        thing — they are not, they just have no hour.
      */}
      <span
        className={cn(
          "w-11 shrink-0 font-mono text-[11px] tabular-nums",
          item.state === "overdue" && !item.done
            ? "text-[#FBBF24]"
            : "text-[var(--faint)]",
        )}
      >
        {time ?? ""}
      </span>

      {/*
        A habit is marked, because the two behave differently and the difference
        matters when you look at the row: a habit comes back tomorrow and can be
        un-ticked, a task is a one-off and cannot. The bar is quieter than a
        label and survives being glanced at.
      */}
      <span
        aria-hidden
        className={cn(
          "h-7 w-[3px] shrink-0 rounded-full",
          isHabit ? "opacity-70" : "opacity-0",
        )}
        style={{ background: item.themeColor || "var(--accent)" }}
      />

      {item.emoji && (
        <span className="shrink-0 text-base leading-none">{item.emoji}</span>
      )}

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm",
            item.done && "text-[var(--faint)] line-through",
          )}
        >
          {item.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--faint)]">
          {isHabit && (
            <span title="A habit — it comes back tomorrow">
              habit
              {item.streak !== null && item.streak > 0 ? ` · ${item.streak}d` : ""}
            </span>
          )}
          {/*
            The kind is a tag rather than a tab. A study block is a task with
            links on it, not a separate section of the app — the Study page said
            otherwise and had to keep its own copy of the same list.
          */}
          {item.kind && item.kind !== "task" && (
            <span className="rounded bg-white/[0.05] px-1.5 py-0.5 capitalize">
              {item.kind}
            </span>
          )}
          {item.state === "overdue" && !item.done && (
            <span className="text-[#FBBF24]">missed its slot</span>
          )}
          {item.xp > 0 && <span className="font-mono">{item.xp} XP</span>}
        </div>
      </div>

      {item.done ? (
        <button
          type="button"
          disabled={busy || !isHabit}
          onClick={() => onUndo(item)}
          className={cn(
            "shrink-0 rounded-lg p-2 text-[var(--faint)] transition-colors",
            isHabit
              ? "hover:bg-white/[0.06] hover:text-[var(--text)]"
              : "opacity-40",
          )}
          title={
            isHabit
              ? "Undo"
              : "Completed tasks are not undone — ask your agent to reschedule"
          }
        >
          <Undo2 className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onComplete(item)}
          className="shrink-0 rounded-lg border border-white/[0.08] p-2 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/[0.12] hover:text-[var(--accent)] disabled:opacity-40"
          title="Mark done"
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
