import { useState } from "react";
import { Check, Undo2 } from "lucide-react";
import type { HabitWithToday } from "@life-os/shared";
import { cn } from "@/lib/utils";
import { LiquidFill } from "./graphics/LiquidFill";
import { ArtBackground, ArtIcon, hasArt } from "./Art";

export function HabitCard({
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
  const [pop, setPop] = useState(false);

  const handleClick = () => {
    if (busy) return;
    if (habit.completedToday) {
      onUndo();
    } else {
      setPop(true);
      setTimeout(() => setPop(false), 400);
      onComplete();
    }
  };

  const art = hasArt(habit);

  return (
    <div
      className={cn(
        "card relative isolate flex flex-col gap-3 overflow-hidden p-4 transition-colors",
        // A card with a photograph behind it needs its own contrast, not the
        // sheet's translucent grey.
        art && "bg-transparent",
      )}
      style={
        habit.completedToday
          ? { borderColor: `${habit.themeColor}66` }
          : undefined
      }
    >
      <ArtBackground art={habit} className="-z-10" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ArtIcon
            art={habit}
            emoji={habit.emoji}
            color={habit.themeColor}
            className={cn("h-11 w-11", pop && "pop")}
            emojiClassName="text-xl"
          />
          <div>
            <div className="font-medium leading-tight">{habit.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span>{habit.category}</span>
              <span className="font-mono">·</span>
              <span className="font-mono">{habit.currentStreak}d streak</span>
              <span className="font-mono">·</span>
              <span className="font-mono">{habit.baseXp} XP</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          className={cn(
            "btn min-h-11 min-w-11 rounded-xl px-3",
            habit.completedToday && "btn-primary",
          )}
          style={
            habit.completedToday
              ? {
                  background: habit.themeColor,
                  color: "#0a0b10",
                }
              : { borderColor: `${habit.themeColor}55` }
          }
          title={habit.completedToday ? "Undo" : "Complete"}
        >
          {habit.completedToday ? (
            <Undo2 className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </button>
      </div>

      {habit.themeGraphic === "liquid" ? (
        <LiquidFill
          pct={habit.completedToday ? 100 : habit.history7.filter(Boolean).length * 14}
          color={habit.themeColor}
          label={habit.completedToday ? "Full" : "Fill"}
        />
      ) : (
        <div className="flex items-center gap-1.5">
          {habit.history7.map((done, i) => (
            <div
              key={i}
              className="h-2 flex-1 rounded-full"
              style={{
                background: done
                  ? habit.themeColor
                  : "rgba(255,255,255,0.06)",
                opacity: done ? 1 : 0.7,
              }}
            />
          ))}
        </div>
      )}

      {habit.anchor && (
        <div className="text-xs text-[var(--faint)]">Anchor: {habit.anchor}</div>
      )}
    </div>
  );
}
