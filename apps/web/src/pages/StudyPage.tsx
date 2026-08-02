import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ScheduleBlock } from "@life-os/shared";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { motion } from "motion/react";
import { Play, Check } from "lucide-react";

/**
 * Study blocks are agent-defined (Hermes). User starts them (Right Now timer)
 * and completes them — real elapsed time is recorded. No free-form "log study".
 */
export function StudyPage() {
  const qc = useQueryClient();
  const intensity = useUiStore((s) => s.celebrationIntensity);

  const { data: blocks = [], isLoading } = useQuery({
    queryKey: ["study-blocks"],
    queryFn: api.studyBlocks,
    refetchInterval: 10000,
  });

  const { data: dash } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
  });

  const start = useMutation({
    mutationFn: (id: string) => api.startBlock(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["study-blocks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Timer on · ${res.block?.label ?? "Study"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeBlock(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["study-blocks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      celebrate(intensity, "complete");
      const mins = res.durationMinutes ?? 0;
      const xp = res.study?.xpAwarded;
      toast.success(
        `Block done · ${mins}m recorded${xp != null ? ` · +${xp} XP` : ""}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Study blocks</h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          Hermes schedules study on your timeline. Start a block to run{" "}
          <strong className="text-[var(--text)]">Right Now</strong> real time,
          then complete it — duration is captured automatically. You don’t add or
          edit blocks here; ask your agent.
        </p>
      </div>

      {dash?.activeSession && (
        <div className="card mb-4 border-[var(--accent)]/30 px-4 py-3 text-sm">
          Live: <span className="text-[var(--accent)]">{dash.activeSession.activity}</span>
          {dash.activeSession.blockId && (
            <span className="text-[var(--muted)]"> · linked block</span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-[var(--muted)]">Loading…</div>
      ) : blocks.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">
          No study blocks today. Your agent can inject them onto the timeline.
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((b) => (
            <BlockRow
              key={b.id}
              block={b}
              activeBlockId={dash?.activeSession?.blockId}
              onStart={() => start.mutate(b.id)}
              onComplete={() => complete.mutate(b.id)}
              busy={start.isPending || complete.isPending}
            />
          ))}
        </div>
      )}

      {dash && dash.studySessions.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">
            Recorded sessions (from completed blocks)
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

function BlockRow({
  block,
  activeBlockId,
  onStart,
  onComplete,
  busy,
}: {
  block: ScheduleBlock;
  activeBlockId?: string | null;
  onStart: () => void;
  onComplete: () => void;
  busy?: boolean;
}) {
  const isActive = activeBlockId === block.id || block.status === "active";
  const done = block.status === "done";

  return (
    <div
      className="card flex flex-wrap items-center justify-between gap-3 p-4"
      style={
        isActive
          ? { borderColor: "color-mix(in oklch, var(--accent) 40%, transparent)" }
          : undefined
      }
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg">📚</span>
          <span className="font-medium">{block.label}</span>
          <span className="chip capitalize">{block.status}</span>
        </div>
        <div className="mt-1 font-mono text-xs text-[var(--muted)]">
          planned {block.plannedStart ?? "—"} – {block.plannedEnd ?? "—"}
          {block.actualStart &&
            ` · actual from ${new Date(block.actualStart).toLocaleTimeString()}`}
        </div>
      </div>
      <div className="flex gap-2">
        {!done && (
          <button
            type="button"
            className="btn"
            disabled={busy || isActive}
            onClick={onStart}
          >
            <Play className="h-3.5 w-3.5" /> Start
          </button>
        )}
        {!done && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={onComplete}
          >
            <Check className="h-3.5 w-3.5" /> Complete
          </button>
        )}
        {done && (
          <span className="chip text-[var(--accent)]">Recorded</span>
        )}
      </div>
    </div>
  );
}
