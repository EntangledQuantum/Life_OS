import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { resolveArt, themePalette, type Goal, type GoalTier } from "@life-os/shared";
import { api } from "@/lib/api";
import { celebrate } from "@/lib/celebrate";
import { useUiStore } from "@/lib/store";
import { playChime } from "@/lib/notify";
import { useCachedImage } from "@/lib/image-cache";

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

  /*
   * On a tiered goal this is about one rung, and the rung decides how loud it
   * is. A five-rung goal plays five of these on the way up, each in its own
   * theme, which is the whole point of a rarity.
   */
  const tier = goal?.pendingTier ?? null;

  const claim = useMutation({
    mutationFn: ({ id, tierId }: { id: string; tierId?: string }) =>
      api.markCelebrationSeen(id, tierId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  useEffect(() => {
    if (!goal) return;
    // Keyed on the rung: two rungs of one goal are two celebrations.
    const key = tier ? `${goal.id}:${tier.id}` : goal.id;
    if (firedRef.current === key) return;
    firedRef.current = key;
    const palette = themePalette(tier?.theme);
    /*
     * The theme's intensity multiplies the user's setting rather than replacing
     * it. Someone who turned celebrations down did not ask for the top rung to
     * be exempt.
     */
    celebrate(intensity, "levelup", {
      colors: tier ? palette.particles : undefined,
      scale: tier ? palette.intensity : 1,
    });
    playChime(0.22);
  }, [goal, tier, intensity]);

  if (!goal || typeof document === "undefined") return null;

  return createPortal(
    <GoalCelebrationOverlay
      goal={goal}
      tier={tier}
      queued={goals.length - 1}
      busy={claim.isPending}
      onClaim={() => claim.mutate({ id: goal.id, tierId: tier?.id })}
    />,
    document.body,
  );
}

function GoalCelebrationOverlay({
  goal,
  tier,
  queued,
  onClaim,
  busy,
}: {
  goal: Goal;
  /** The rung being celebrated, or null on a goal with no ladder. */
  tier: GoalTier | null;
  queued: number;
  onClaim: () => void;
  busy: boolean;
}) {
  const palette = themePalette(tier?.theme);
  /*
   * The tier's own colour if it named one, otherwise the theme's. The agent
   * picks the feeling and the palette supplies the hues — a rung hard-coding
   * purple against a gold theme reads as a bug, not as a rarity.
   */
  const color = tier
    ? tier.themeColor || palette.primary
    : goal.themeColor || "#A78BFA";
  const art = resolveArt(tier ?? goal);
  const backdrop = useCachedImage(art.background);
  const medallion = useCachedImage(art.icon);
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

  const metAt = tier?.metAt ?? goal.conditionMetAt;
  const metOn = metAt
    ? new Date(metAt).toLocaleString([], {
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
        background: `radial-gradient(ellipse at center, ${palette.secondary}cc, oklch(7% 0.012 260 / 0.985))`,
        backdropFilter: "blur(8px)",
      }}
    >
      {/*
        The tier's own picture, full-bleed behind everything and heavily
        darkened. This is the one place the art gets the stage it was made for:
        a 3:2 background on a 3:2 screen.
      */}
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse at center, rgba(7,8,12,${art.overlay * 0.9}), rgba(7,8,12,0.97))`,
            }}
          />
        </div>
      )}
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
            className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-full text-6xl"
            style={{
              background: `radial-gradient(circle at 50% 35%, ${color}44, ${color}12)`,
              boxShadow: `0 0 60px -10px ${color}`,
              border: `1px solid ${color}66`,
            }}
          >
            {medallion ? (
              <img src={medallion} alt="" className="h-full w-full object-cover" />
            ) : (
              tier?.emoji || goal.emoji || "🎯"
            )}
          </div>

          {/*
            The rarity is the headline on a tiered goal. "Goal complete" would
            be a lie on four rungs out of five, and the rung's name is the thing
            the user is meant to remember.
          */}
          <p
            className="mt-6 font-mono text-[11px] uppercase tracking-[0.32em]"
            style={{ color }}
          >
            {tier ? tier.label : "Goal complete"}
          </p>
          <h2
            id="goal-celebration-title"
            className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl"
          >
            {tier?.title || goal.title}
          </h2>
          {tier && (
            <p
              className="mt-2 font-mono text-[11px] uppercase tracking-[0.22em]"
              // The faint token disappears against a darkened photograph; this
              // line is how you know which rung of how many you just cleared.
              style={{ color: `${color}cc` }}
            >
              {palette.word} · tier {tier.rank} of {goal.tiers.length}
              {tier.rank === goal.tiers.length ? " · the last one" : ""}
            </p>
          )}

          {(tier?.description || goal.description) && (
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              {tier?.description || goal.description}
            </p>
          )}
          {goal.whyItMatters && (
            <p className="mx-auto mt-2 max-w-md text-sm italic leading-relaxed text-[var(--muted)]">
              “{goal.whyItMatters}”
            </p>
          )}

          {(tier?.conditionDetail ?? goal.conditionDetail).length > 0 && (
            <ul className="mx-auto mt-6 inline-flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-left">
              {(tier?.conditionDetail ?? goal.conditionDetail).map((line) => (
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
            className="btn mx-auto mt-7 px-7 py-3 text-base font-semibold"
            // The rung owns the colour here too — a lavender button under a
            // gold celebration is the app talking over the moment.
            style={{ background: color, color: "#0a0b10", borderColor: color }}
          >
            {busy ? "Saving…" : "Claim it"}
          </button>

          <p className="mt-3 text-[11px] text-[var(--faint)]">
            {queued > 0
              ? `${queued} more goal${queued === 1 ? "" : "s"} waiting behind this one`
              : tier && tier.rank < goal.tiers.length
                ? `${goal.tiers.length - tier.rank} more tier${
                    goal.tiers.length - tier.rank === 1 ? "" : "s"
                  } above this one`
                : "Not marked finished until you've seen this"}
          </p>
        </div>
      </div>
    </div>
  );
}
