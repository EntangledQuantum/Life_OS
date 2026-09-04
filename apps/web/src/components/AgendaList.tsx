import { Check, Undo2 } from "lucide-react";
import type { AgendaItem, HabitWithToday } from "@life-os/shared";
import { cn } from "@/lib/utils";
import { ArtBackground, ArtIcon, hasArt } from "./Art";

/**
 * Today, as **one** list of cards — and the only place habits live.
 *
 * Three things went wrong on the way here. Habits and scheduled tasks were
 * rendered as separate lists, which is what made it reasonable for an agent to
 * create one of each for the same act. Then, having merged them, the merged
 * list was split again into "Today" and "Anytime", so a habit with no time sat
 * under a task with a similar name and read as a duplicate of it. And then
 * there were *two pages*: this list, and a Habits page showing the same habits
 * larger, with their art and their week — so the thing you looked at every day
 * was the poorer of the two views.
 *
 * The Habits page is gone and this is what it was. Same size, same pictures,
 * same seven-day strip. A habit is on today's list or it is nowhere.
 *
 * There are still no sections, and a card does not move when you tick it — a
 * list that reorders under your finger is a list you have to re-read. At the
 * reset the habits come back open on their own: a habit is not done until it is
 * logged, and a log belongs to the life-day it was written in.
 */
export function AgendaList({
  items,
  habits,
  busy,
  onComplete,
  onUndo,
}: {
  items: AgendaItem[];
  /**
   * The full habit rows, for the art and the week.
   *
   * Looked up by `habitId` rather than copied onto every agenda item: the
   * dashboard payload already carries these, and a background picture is a
   * `data:` URI big enough that sending it twice per poll is real bandwidth.
   */
  habits: HabitWithToday[];
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
  const byId = new Map(habits.map((h) => [h.id, h]));

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
          Today
        </h2>
        <span className="font-mono text-[11px] text-[var(--faint)]">
          {done}/{items.length}
        </span>
      </header>
      {/*
        Two up once the column is wide enough for a card to still be a card.
        Below that, one — half of one of these is unreadable, which is the
        mistake the old narrow row column was avoiding by being a row.
      */}
      <ul className="grid gap-3 xl:grid-cols-2">
        {items.map((item) => (
          <AgendaCard
            key={item.id}
            item={item}
            habit={item.habitId ? byId.get(item.habitId) : undefined}
            busy={busy}
            onComplete={onComplete}
            onUndo={onUndo}
          />
        ))}
      </ul>
    </section>
  );
}

function AgendaCard({
  item,
  habit,
  busy,
  onComplete,
  onUndo,
}: {
  item: AgendaItem;
  habit: HabitWithToday | undefined;
  busy: boolean;
  onComplete: (item: AgendaItem) => void;
  onUndo: (item: AgendaItem) => void;
}) {
  /*
   * 24-hour, always. The locale default gave "07:30 AM", which is wider, and
   * the ribbon on the other side of the page is labelled 00/06/12/18/24 — a
   * 12-hour list beside it made the two disagree.
   */
  const time = item.at
    ? new Date(item.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : null;

  const isHabit = item.source === "habit";
  const color = item.themeColor || "var(--accent)";
  /* The habit's own art if it has any; otherwise whatever the row resolved. */
  const art = habit ?? { iconImageData: item.iconImage, iconImageUrl: null };
  const overdue = item.state === "overdue" && !item.done;

  return (
    <li
      className={cn(
        "group relative isolate flex flex-col overflow-hidden rounded-2xl border transition-all",
        item.done ? "border-white/[0.06] opacity-70" : "border-white/[0.08]",
        !hasArt(habit) && !item.done && "bg-white/[0.03]",
        !item.done && "hover:-translate-y-px",
      )}
      style={
        item.done
          ? undefined
          : {
              /*
                The bar is gone. It was three pixels of colour doing the job of
                saying "this is a habit, and this is which part of your day it
                belongs to" — at that size it read as a divider. The card's own
                edge carries it now: an outline in the activity's colour, and a
                glow underneath that lifts it off the page. Same information,
                and you can see it without looking for it.
              */
              borderColor: `${item.themeColor ?? "#5B8CFF"}${item.state === "now" ? "88" : "40"}`,
              boxShadow:
                item.state === "now"
                  ? `0 0 0 1px ${item.themeColor ?? "#5B8CFF"}55, 0 10px 34px -14px ${item.themeColor ?? "#5B8CFF"}`
                  : `0 8px 26px -20px ${item.themeColor ?? "#5B8CFF"}`,
            }
      }
    >
      <ArtBackground art={habit} className="-z-10" />

      <div className="flex items-start gap-3 p-4">
        <ArtIcon
          art={art}
          emoji={item.emoji}
          color={item.themeColor ?? "#5B8CFF"}
          /* Big enough to be the picture, not a bullet point. */
          className="h-12 w-12"
          emojiClassName="text-2xl"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3
              className={cn(
                "min-w-0 flex-1 truncate font-medium leading-tight",
                item.done && "text-[var(--faint)] line-through",
              )}
            >
              {item.title}
            </h3>
            {time && (
              <span
                className={cn(
                  "shrink-0 font-mono text-xs tabular-nums",
                  overdue ? "text-[#FBBF24]" : "text-[var(--faint)]",
                )}
              >
                {time}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
            {isHabit ? (
              <span title="A habit — it comes back tomorrow">
                {habit?.category ?? "habit"}
                {item.streak !== null && item.streak > 0
                  ? ` · ${item.streak}d streak`
                  : ""}
              </span>
            ) : (
              /*
                The kind is a tag rather than a tab. A study block is a task
                with links on it, not a separate section of the app — the Study
                page said otherwise and kept its own copy of this same list.
              */
              item.kind &&
              item.kind !== "task" && (
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 capitalize">
                  {item.kind}
                </span>
              )
            )}
            {item.xp > 0 && <span className="font-mono">{item.xp} XP</span>}
            {overdue && <span className="text-[#FBBF24]">missed its slot</span>}
          </div>
        </div>

        {item.done ? (
          <button
            type="button"
            disabled={busy || !isHabit}
            onClick={() => onUndo(item)}
            className={cn(
              "shrink-0 rounded-xl border border-white/[0.08] p-2.5 text-[var(--faint)] transition-colors",
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
            className="shrink-0 rounded-xl border p-2.5 text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
            style={{ borderColor: `${item.themeColor ?? "#5B8CFF"}55` }}
            title="Mark done"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>

      {/*
        The week, for habits only — a task has no week, it happens once. This
        came off the Habits page, and it is the reason that page existed: the
        useful thing about a habit is the run behind it, not today's tick.
      */}
      {habit && habit.history7.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 pb-3">
          {habit.history7.map((was, i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{
                background: was ? item.themeColor ?? "#5B8CFF" : "rgba(255,255,255,0.07)",
              }}
              title={was ? "done" : "not done"}
            />
          ))}
        </div>
      )}

      {habit?.anchor && (
        <p className="px-4 pb-3 text-[11px] text-[var(--faint)]">
          Anchor: {habit.anchor}
        </p>
      )}
    </li>
  );
}
