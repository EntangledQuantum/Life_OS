import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HabitCard } from "@/components/HabitCard";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { toast } from "sonner";
import { motion } from "motion/react";

/**
 * User completes habits. Create/edit/theme is agent-side (API/MCP).
 */
export function HabitsPage() {
  const qc = useQueryClient();
  const intensity = useUiStore((s) => s.celebrationIntensity);
  const { data: habits = [], isLoading } = useQuery({
    queryKey: ["habits"],
    queryFn: api.habits,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeHabit(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (res.error) toast.message(String(res.error));
      else {
        celebrate(intensity, "complete");
        toast.success(`+${res.xpAwarded} XP`);
      }
    },
  });

  const undo = useMutation({
    mutationFn: (id: string) => api.undoHabit(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Habits</h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
          One-tap complete. Themes, XP values, and new habits are customized by
          your agent (Hermes) — not by forms in this UI.
        </p>
      </div>

      {isLoading ? (
        <div className="text-[var(--muted)]">Loading…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {habits.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              onComplete={() => complete.mutate(h.id)}
              onUndo={() => undo.mutate(h.id)}
              busy={complete.isPending || undo.isPending}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
