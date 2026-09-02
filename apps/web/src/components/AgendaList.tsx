import { useMemo } from "react";
import { Check, Undo2 } from "lucide-react";
import type { AgendaItem } from "@life-os/shared";
import { cn } from "@/lib/utils";

/**
 * Today, as one list.
 *
 * Habits and scheduled tasks used to be rendered as two lists on this page,
 * which is what made it reasonable for an agent to create one of each for the
 * same act — and gave the user two rows to tick, paying out twice if they
 * ticked both. They are one list now, and an item says which record it belongs
 * to so the tick lands on the right one.
 *
 * Timed things first, in time order, because that is the order they happen in.
 * Untimed work sits underneath in its own group: it is real, it is open, and it
 * is not part of today's shape — running the two together is how a front page
 * fills up with things nobody has to do now.
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
  const { timed, anytime } = useMemo(() => {
    return {
      timed: items.filter((i) => i.at !== null),
      anytime: items.filter((i) => i.at === null),
    };
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-white/[0.06] px-4 py-8 text-center text-sm text-[var(--muted)]">
        Nothing on today. Ask your agent to set up some habits.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {timed.length > 0 && (
        <Group label="Today">
          {timed.map((item) => (
            <Row
              key={item.id}
              item={item}
              busy={busy}
              onComplete={onComplete}
              onUndo={onUndo}
            />
          ))}
        </Group>
      )}

      {anytime.length > 0 && (
        <Group label="Anytime">
          {anytime.map((item) => (
            <Row
              key={item.id}
              item={item}
              busy={busy}
              onComplete={onComplete}
              onUndo={onUndo}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
        {label}
      </h2>
      <ul className="space-y-1.5">{children}</ul>
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
        as ragged text. Untimed rows get a dash in the same column instead of
        collapsing it, which would make the two groups look unrelated.
      */}
      <span
        className={cn(
          "w-11 shrink-0 font-mono text-[11px] tabular-nums",
          item.state === "overdue" ? "text-[#FBBF24]" : "text-[var(--faint)]",
        )}
      >
        {time ?? "—"}
      </span>

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
          {item.source === "habit" && item.streak !== null && item.streak > 0 && (
            <span title="Current streak">{item.streak}d streak</span>
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
          disabled={busy || item.source !== "habit"}
          onClick={() => onUndo(item)}
          className={cn(
            "shrink-0 rounded-lg p-2 text-[var(--faint)] transition-colors",
            item.source === "habit"
              ? "hover:bg-white/[0.06] hover:text-[var(--text)]"
              : "opacity-40",
          )}
          title={
            item.source === "habit"
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
