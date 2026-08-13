import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Task } from "@life-os/shared";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { motion } from "motion/react";
import { BookOpen, Check, ExternalLink, FileText, Link2, Video } from "lucide-react";

/**
 * Study is a task with `kind: "study"` — not a separate table, not a separate
 * lifecycle. You complete it; there is nothing to start.
 *
 * What makes it worth its own page is the depth the agent can attach:
 * `body` for instructions and chapter lists, and `resources` for the actual
 * links. That is the thing this page exists to show, and it is why "study
 * blocks" used to feel like a stub — a label and two times was all they could
 * ever hold.
 *
 * The recorded duration is the window the agent planned, not a stopwatch.
 */
export function StudyPage() {
  const qc = useQueryClient();
  const intensity = useUiStore((s) => s.celebrationIntensity);

  const { data: open = [], isLoading } = useQuery({
    queryKey: ["tasks", "study", "active"],
    queryFn: () => api.tasks("?kind=study&status=active"),
    refetchInterval: 10_000,
  });

  const { data: dash } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      celebrate(intensity, "complete");
      toast.success(res.xpAwarded ? `Done · +${res.xpAwarded} XP` : "Done");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Study</h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          What your agent has lined up for you to learn, with whatever it
          attached — chapters, papers, videos. Tick one off when it is done;
          there is nothing to start. You don’t add these here, ask your agent.
        </p>
      </div>

      {isLoading ? (
        <div className="text-[var(--muted)]">Loading…</div>
      ) : open.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">
          Nothing to study right now. Ask your agent to schedule a reading block
          — it can attach the chapter and the links along with it.
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((t) => (
            <StudyRow
              key={t.id}
              task={t}
              onComplete={() => complete.mutate(t.id)}
              busy={complete.isPending}
            />
          ))}
        </div>
      )}

      {dash && dash.studySessions.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">
            Recorded sessions
          </h2>
          <div className="space-y-2">
            {dash.studySessions.slice(0, 10).map((s) => (
              <div
                key={s.id}
                className="flex justify-between rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span>{s.title}</span>
                <span className="font-mono text-[var(--muted)]">
                  {s.durationMinutes ?? 0}m · {s.qualityFlag}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Icon for whatever the agent said the link is. Free-form, so this is a guess. */
function ResourceIcon({ kind }: { kind?: string }) {
  const k = (kind ?? "").toLowerCase();
  if (k.includes("video")) return <Video className="h-3.5 w-3.5" />;
  if (k.includes("book") || k.includes("chapter"))
    return <BookOpen className="h-3.5 w-3.5" />;
  if (k.includes("paper") || k.includes("doc"))
    return <FileText className="h-3.5 w-3.5" />;
  return <Link2 className="h-3.5 w-3.5" />;
}

function StudyRow({
  task,
  onComplete,
  busy,
}: {
  task: Task;
  onComplete: () => void;
  busy?: boolean;
}) {
  const when = task.eventAt ? new Date(task.eventAt) : null;
  const end =
    when && task.durationMinutes
      ? new Date(when.getTime() + task.durationMinutes * 60_000)
      : null;
  const hhmm = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg">{task.emoji ?? "📚"}</span>
            <span className="font-medium">{task.title}</span>
          </div>
          {when && (
            <div className="mt-1 font-mono text-xs text-[var(--muted)]">
              {hhmm(when)}
              {end ? ` – ${hhmm(end)}` : ""}
              {task.durationMinutes ? ` · ${task.durationMinutes}m` : ""}
            </div>
          )}
          {task.subtitle && (
            <p className="mt-1 text-sm text-[var(--muted)]">{task.subtitle}</p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={onComplete}
        >
          <Check className="h-3.5 w-3.5" /> Complete
          {task.xpOnComplete > 0 ? ` · +${task.xpOnComplete}` : ""}
        </button>
      </div>

      {/* The instructions. This is the half a "study block" never had room for. */}
      {task.body && (
        <p className="border-t border-white/[0.06] pt-3 text-sm leading-relaxed whitespace-pre-wrap text-[var(--muted)]">
          {task.body}
        </p>
      )}

      {task.resources.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
          {task.resources.map((r, i) => (
            <a
              key={`${r.url}-${i}`}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-white/[0.1] hover:text-[var(--text)]"
            >
              <ResourceIcon kind={r.kind} />
              {r.label}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          ))}
        </div>
      )}

      {task.purpose && (
        <p className="text-xs text-[var(--faint)]">Why: {task.purpose}</p>
      )}
    </div>
  );
}
