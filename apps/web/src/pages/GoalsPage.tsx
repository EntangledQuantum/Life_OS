import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Bot, Check, CircleDot, Sparkles } from "lucide-react";
import type { AgentProperty, Goal } from "@life-os/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Goals are read-only here on purpose.
 *
 * Deciding what to want is exactly the executive-function tax this app exists
 * to remove, so goals are set by the agent, not typed in by the user. This page
 * shows what the agent has committed you to, how close each one is, and the
 * counters it is watching.
 */
export function GoalsPage() {
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals"],
    queryFn: () => api.goals(),
    refetchInterval: 15_000,
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["properties"],
    queryFn: () => api.properties(),
    refetchInterval: 15_000,
  });

  const open = goals.filter((g) => g.status === "active" && !g.celebrationPending);
  const waiting = goals.filter((g) => g.celebrationPending);
  const done = goals.filter((g) => g.status === "achieved");
  const parked = goals.filter(
    (g) => g.status === "paused" || g.status === "abandoned",
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10 pb-16"
    >
      <header>
        <h1 className="text-2xl font-bold">Goals</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <Bot className="h-4 w-4 shrink-0" />
          Set by your agent, not by you. Each one is a condition the system
          re-checks after every change — you just keep living.
        </p>
      </header>

      {isLoading && <div className="text-[var(--muted)]">Loading…</div>}

      {!isLoading && goals.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/[0.12] p-8 text-center">
          <p className="text-[var(--muted)]">
            No goals yet. Ask your agent to set one — it can watch a habit
            streak, your study minutes, or a counter it keeps itself.
          </p>
        </div>
      )}

      {waiting.length > 0 && (
        <GoalGroup
          title="Waiting for you"
          note="Condition met — open the dashboard to claim it"
          goals={waiting}
        />
      )}
      {open.length > 0 && <GoalGroup title="In flight" goals={open} />}
      {done.length > 0 && <GoalGroup title="Achieved" goals={done} />}
      {parked.length > 0 && <GoalGroup title="Parked" goals={parked} />}

      {properties.length > 0 && <PropertyPanel properties={properties} />}
    </motion.div>
  );
}

function GoalGroup({
  title,
  note,
  goals,
}: {
  title: string;
  note?: string;
  goals: Goal[];
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
          {title}
        </h2>
        {note && (
          <span className="font-mono text-[10px] text-[var(--accent)]">{note}</span>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} />
        ))}
      </div>
    </section>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const color = goal.themeColor || "#A78BFA";
  const achieved = goal.status === "achieved";
  const pct = Math.max(0, Math.min(100, Math.round(goal.progressPct)));

  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5",
        goal.celebrationPending && "reminder-due",
      )}
      style={!goal.celebrationPending ? { borderColor: `${color}33` } : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: `${color}22` }}
        >
          {goal.emoji || "🎯"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight">{goal.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--faint)]">
            <span>{goal.ownerKind === "agent" ? "agent-set" : "manual"}</span>
            {goal.condition && <span>auto-checked</span>}
            {goal.targetDate && <span>by {goal.targetDate}</span>}
          </div>
        </div>
        {achieved && (
          <Check className="h-4 w-4 shrink-0" style={{ color }} aria-label="Achieved" />
        )}
      </div>

      {goal.whyItMatters && (
        <p className="mt-3 text-sm italic leading-relaxed text-[var(--muted)]">
          “{goal.whyItMatters}”
        </p>
      )}
      {goal.description && (
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          {goal.description}
        </p>
      )}

      {goal.conditionDetail.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1">
          {goal.conditionDetail.map((line) => (
            <li
              key={line}
              className="flex items-start gap-1.5 font-mono text-[11px] text-[var(--muted)]"
            >
              <CircleDot
                className="mt-0.5 h-3 w-3 shrink-0"
                style={{ color }}
                aria-hidden
              />
              {line}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4">
        <div className="mb-1 flex justify-between font-mono text-[11px] text-[var(--faint)]">
          <span>{pct}%</span>
          {goal.celebrationPending && (
            <span className="text-[var(--accent)]">claim on the dashboard</span>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>
    </article>
  );
}

function PropertyPanel({ properties }: { properties: AgentProperty[] }) {
  return (
    <section>
      <h2 className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--faint)]">
        Agent counters
      </h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Values your agent invented and maintains itself. Goal conditions read
        these by key.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {properties.map((prop) => (
          <div
            key={prop.uid}
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
          >
            <div className="flex items-baseline gap-2">
              <Sparkles className="h-3 w-3 shrink-0 text-[var(--accent)]" aria-hidden />
              <span className="font-mono text-[10px] text-[var(--faint)]">
                {prop.key}
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
              {prop.value ?? prop.textValue ?? "—"}
              {prop.unit && (
                <span className="ml-1 text-sm text-[var(--faint)]">{prop.unit}</span>
              )}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">{prop.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
