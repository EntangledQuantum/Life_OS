import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import type { Goal } from "@life-os/shared";
import { api } from "@/lib/api";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { playChime } from "@/lib/notify";

/**
 * Full-screen goal celebration.
 *
 * A goal whose condition has come true is *met*, not *finished*. It only
 * becomes `achieved` once the user has actually watched this — which is why
 * there is exactly one way out of the overlay, and it is the claim button.
 * Close the tab instead and the goal is still waiting next time.
 *
 * Several goals can land at once (one write can satisfy more than one
 * condition), so they queue and play one at a time.
 */
export function GoalCelebration({ goals }: { goals: Goal[] }) {
  const qc = useQueryClient();
  const intensity = useUiStore((s) => s.celebrationIntensity);
  const goal = goals[0] ?? null;
  const firedRef = useRef<string | null>(null);

  const claim = useMutation({
    mutationFn: (id: string) => api.markCelebrationSeen(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  useEffect(() => {
    if (!goal || firedRef.current === goal.id) return;
    firedRef.current = goal.id;
    celebrate(intensity, "levelup");
    playChime(0.22);
  }, [goal, intensity]);

  if (!goal || typeof document === "undefined") return null;

  return createPortal(
    <GoalCelebrationOverlay
      goal={goal}
      queued={goals.length - 1}
      busy={claim.isPending}
      onClaim={() => claim.mutate(goal.id)}
    />,
    document.body,
  );
}

function GoalCelebrationOverlay({
  goal,
  queued,
  onClaim,
  busy,
}: {
  goal: Goal;
  queued: number;
  onClaim: () => void;
  busy: boolean;
}) {
  const color = goal.themeColor || "#A78BFA";
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  // Focus the one way out, so keyboard users are not trapped.
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  const rays = useMemo(
    () => Array.from({ length: 16 }, (_, i) => (i * 360) / 16),
    [],
  );

  const metOn = goal.conditionMetAt
    ? new Date(goal.conditionMetAt).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="goal-celebration-title"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto p-6"
      style={{
        background:
          "radial-gradient(ellipse at center, oklch(14% 0.03 290 / 0.94), oklch(7% 0.012 260 / 0.98))",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="goal-burst relative w-full max-w-lg text-center">
        {/* Radiating light behind the medallion */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <svg
            width="420"
            height="420"
            viewBox="0 0 420 420"
            className="-mt-24 max-w-full opacity-70"
            aria-hidden
          >
            <defs>
              <radialGradient id="goalHalo">
                <stop offset="0%" stopColor={color} stopOpacity="0.55" />
                <stop offset="70%" stopColor={color} stopOpacity="0.06" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="210" cy="210" r="200" fill="url(#goalHalo)" className="goal-glow" />
            <g className={reduced ? undefined : "goal-rays"} style={{ transformOrigin: "210px 210px" }}>
              {rays.map((angle, i) => (
                <rect
                  key={angle}
                  x="208"
                  y="30"
                  width={i % 2 === 0 ? 4 : 2}
                  height={i % 2 === 0 ? 74 : 50}
                  rx="2"
                  fill={color}
                  opacity={i % 2 === 0 ? 0.5 : 0.25}
                  transform={`rotate(${angle} 210 210)`}
                />
              ))}
            </g>
            {!reduced && (
              <>
                <circle
                  cx="210"
                  cy="210"
                  r="70"
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  className="goal-ring"
                  style={{ transformOrigin: "210px 210px" }}
                />
                <circle
                  cx="210"
                  cy="210"
                  r="70"
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                  className="goal-ring"
                  style={{ transformOrigin: "210px 210px", animationDelay: "1.2s" }}
                />
              </>
            )}
          </svg>
        </div>

        <div className="relative">
          <div
            className="mx-auto flex h-28 w-28 items-center justify-center rounded-full text-6xl"
            style={{
              background: `radial-gradient(circle at 50% 35%, ${color}44, ${color}12)`,
              boxShadow: `0 0 60px -10px ${color}`,
              border: `1px solid ${color}66`,
            }}
          >
            {goal.emoji || "🎯"}
          </div>

          <p
            className="mt-6 font-mono text-[11px] uppercase tracking-[0.32em]"
            style={{ color }}
          >
            Goal complete
          </p>
          <h2
            id="goal-celebration-title"
            className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl"
          >
            {goal.title}
          </h2>

          {goal.description && (
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              {goal.description}
            </p>
          )}
          {goal.whyItMatters && (
            <p className="mx-auto mt-2 max-w-md text-sm italic leading-relaxed text-[var(--muted)]">
              “{goal.whyItMatters}”
            </p>
          )}

          {goal.conditionDetail.length > 0 && (
            <ul className="mx-auto mt-6 inline-flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-left">
              {goal.conditionDetail.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 font-mono text-[11px] text-[var(--muted)]"
                >
                  <Sparkles
                    className="mt-0.5 h-3 w-3 shrink-0"
                    style={{ color }}
                    aria-hidden
                  />
                  {line}
                </li>
              ))}
            </ul>
          )}

          {metOn && (
            <p className="mt-4 font-mono text-[11px] text-[var(--faint)]">
              condition met {metOn}
            </p>
          )}

          <button
            ref={buttonRef}
            type="button"
            onClick={onClaim}
            disabled={busy}
            className="btn btn-primary mx-auto mt-7 px-7 py-3 text-base"
          >
            {busy ? "Saving…" : "Claim it"}
          </button>

          <p className="mt-3 text-[11px] text-[var(--faint)]">
            {queued > 0
              ? `${queued} more goal${queued === 1 ? "" : "s"} waiting behind this one`
              : "Not marked finished until you've seen this"}
          </p>
        </div>
      </div>
    </div>
  );
}
