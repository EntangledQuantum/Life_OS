import confetti from "canvas-confetti";

export function celebrate(
  intensity: "full" | "minimal" | "off" = "full",
  kind: "complete" | "levelup" | "streak" = "complete",
  /**
   * Per-rarity trim.
   *
   * A goal tier supplies its theme's colours and how loud it is. `scale`
   * multiplies the count rather than replacing it, so someone who set
   * celebrations to "minimal" still gets minimal — a rare tier is louder than a
   * common one *within* what the user asked for, not instead of it.
   */
  options: { colors?: string[]; scale?: number } = {},
) {
  if (intensity === "off") return;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const scale = Math.max(0.2, Math.min(1, options.scale ?? 1));
  const base = intensity === "minimal" ? 40 : kind === "levelup" ? 160 : 80;
  const count = Math.round(base * scale);
  const spread = kind === "levelup" ? 100 : 60;

  confetti({
    particleCount: count,
    spread,
    origin: { y: 0.7 },
    colors: options.colors?.length
      ? options.colors
      : ["#5B8CFF", "#A78BFA", "#34D399", "#22D3EE", "#FBBF24"],
    disableForReducedMotion: true,
  });

  // The side cannons are for the loud end of the ladder, not every rung.
  if (kind === "levelup" && intensity === "full" && scale >= 0.5) {
    setTimeout(() => {
      confetti({
        particleCount: Math.round(60 * scale),
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: options.colors,
      });
      confetti({
        particleCount: Math.round(60 * scale),
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: options.colors,
      });
    }, 200);
  }
}
