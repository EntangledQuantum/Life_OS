import { DayGraphic } from "@/components/graphics/DayGraphic";
import { asset } from "@/lib/deploy";
import { cn } from "@/lib/utils";

/**
 * Hero preview of Today: the day drawn, then the habit list as cards.
 * Replaces the old scoreboard mock (timer, five stats, a sparkline) which no
 * longer matches the app.
 */
const MOCK_HABITS = [
  {
    id: "wake",
    completedToday: true,
    themeColor: "#5B8CFF",
  },
  {
    id: "book",
    completedToday: false,
    themeColor: "#A78BFA",
  },
  {
    id: "reviews",
    completedToday: false,
    themeColor: "#C084FC",
  },
  {
    id: "physics",
    completedToday: false,
    themeColor: "#FBBF24",
  },
  {
    id: "sleep",
    completedToday: false,
    themeColor: "#22D3EE",
  },
  {
    id: "gym",
    completedToday: false,
    themeColor: "#F472B6",
  },
] as never;

const CARDS = [
  {
    title: "Wake window",
    meta: "Life · 1d streak · 27 XP",
    time: "08:00",
    anchor: "when I leave bed",
    done: true,
    image: "landing/habit-wake.jpg",
    icon: "landing/habit-wake.jpg",
  },
  {
    title: "Book hour",
    meta: "Study · 2d streak · 41 XP",
    time: "09:00",
    note: "missed its slot",
    anchor: "after breakfast / 09:00",
    done: false,
    image: "landing/habit-book.jpg",
    icon: "landing/habit-book.jpg",
  },
  {
    title: "Spaced reviews",
    meta: "Study · 41 XP",
    time: "10:00",
    note: "missed its slot",
    anchor: "start of study block 10:00",
    done: false,
    image: "landing/habit-reviews.jpg",
    icon: "landing/habit-reviews.jpg",
  },
];

export function HeroDayMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-white/[0.09] bg-[oklch(11%_0.016_260)] shadow-[0_30px_60px_rgba(0,0,0,0.5)]",
        className,
      )}
      role="img"
      aria-label="Life OS Today: the day drawn as a bloom, then habits as cards"
    >
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FB7185]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FBBF24]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#34D399]/70" />
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-stretch">
        <div className="flex min-w-0 flex-col">
          <div className="flex w-full items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-extrabold tracking-tight">Evening</p>
              <p className="mt-0.5 text-xs text-white/40">1 of 6 done today</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-right">
              <span className="block text-xs font-semibold text-[#F472B6]">
                Stable
              </span>
              <span className="block font-mono text-[10px] text-white/40">
                −27%
              </span>
            </span>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center py-2">
            <DayGraphic
              style="bloom"
              efficiencyPct={14}
              habits={MOCK_HABITS}
              agenda={[]}
              history={[12, 18, 22, 30, 28, 40, 35]}
              dayProgress={0.72}
              className="h-40 w-40 text-white/50 sm:h-48 sm:w-48"
            />
            <p className="mt-1 font-mono text-[11px] tracking-wide text-white/35">
              30 / 220 XP
            </p>
          </div>

          <div className="mt-auto flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F472B6]/20 text-sm">
              ◎
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                Right now
              </p>
              <p className="text-sm font-semibold">Deep Work</p>
            </div>
            <span className="font-mono text-sm text-[#F472B6]">1:18:47</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-baseline justify-between px-0.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
              Today
            </p>
            <p className="font-mono text-[10px] text-white/35">1/6</p>
          </div>
          {CARDS.map((card) => (
            <HabitCardPreview key={card.title} {...card} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HabitCardPreview({
  title,
  meta,
  time,
  note,
  anchor,
  done,
  image,
  icon,
}: (typeof CARDS)[number]) {
  return (
    <div className="relative min-h-[6.25rem] flex-1 overflow-hidden rounded-xl border border-white/[0.08]">
      <img
        src={asset(image)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-[oklch(10%_0.02_260)]/55" />
      <div className="relative flex h-full items-center gap-3 px-3.5 py-3.5">
        <img
          src={asset(icon)}
          alt=""
          className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-white/15"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug">{title}</p>
            <p className="shrink-0 font-mono text-[11px] text-white/55">{time}</p>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-white/55">
            {meta}
            {note ? (
              <span className="text-amber-300/90"> · {note}</span>
            ) : null}
          </p>
          <p className="mt-1 text-[10px] text-white/45">
            Anchor: {anchor}
          </p>
        </div>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs",
            done
              ? "border-[var(--accent)]/50 bg-[var(--accent)]/20 text-[var(--accent)]"
              : "border-white/15 text-white/40",
          )}
        >
          {done ? "✓" : ""}
        </span>
      </div>
    </div>
  );
}
