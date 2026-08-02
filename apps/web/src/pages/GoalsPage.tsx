import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Goal } from "@life-os/shared";
import { toast } from "sonner";
import { motion } from "motion/react";

export function GoalsPage() {
  const qc = useQueryClient();
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals"],
    queryFn: () => api.goals() as Promise<Goal[]>,
  });
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: api.createGoal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      setOpen(false);
      toast.success("Goal added");
    },
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    create.mutate({
      title: String(fd.get("title")),
      whyItMatters: String(fd.get("why") || "") || null,
      description: String(fd.get("desc") || "") || null,
      progressPct: Number(fd.get("progress") || 0),
      targetDate: String(fd.get("target") || "") || null,
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm text-[var(--muted)]">
            Light MVP — link meaning to habits.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
          Add goal
        </button>
      </div>

      {open && (
        <form onSubmit={onSubmit} className="card mb-6 grid gap-3 p-5">
          <div>
            <label className="label">Title</label>
            <input name="title" className="input" required />
          </div>
          <div>
            <label className="label">Why it matters</label>
            <input name="why" className="input" />
          </div>
          <div>
            <label className="label">Description</label>
            <input name="desc" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Progress %</label>
              <input name="progress" type="number" className="input" defaultValue={0} />
            </div>
            <div>
              <label className="label">Target date</label>
              <input name="target" type="date" className="input" />
            </div>
          </div>
          <button type="submit" className="btn btn-primary justify-self-end">
            Save
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="text-[var(--muted)]">Loading…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {goals.map((g) => (
            <div key={g.id} className="card flex flex-col p-5">
              <div className="chip w-fit capitalize">{g.status}</div>
              <h3 className="font-semibold mt-3 text-lg font-semibold">{g.title}</h3>
              {g.whyItMatters && (
                <p className="mt-2 flex-1 text-sm text-[var(--muted)]">{g.whyItMatters}</p>
              )}
              <div className="mt-4">
                <div className="mb-1 flex justify-between font-mono text-xs text-[var(--muted)]">
                  <span>{Math.round(g.progressPct)}%</span>
                  {g.targetDate && <span>{g.targetDate}</span>}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${g.progressPct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
