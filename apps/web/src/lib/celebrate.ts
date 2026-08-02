import confetti from "canvas-confetti";

export function celebrate(
  intensity: "full" | "minimal" | "off" = "full",
  kind: "complete" | "levelup" | "streak" = "complete",
) {
  if (intensity === "off") return;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const count = intensity === "minimal" ? 40 : kind === "levelup" ? 160 : 80;
  const spread = kind === "levelup" ? 100 : 60;

  confetti({
    particleCount: count,
    spread,
    origin: { y: 0.7 },
    colors: ["#5B8CFF", "#A78BFA", "#34D399", "#22D3EE", "#FBBF24"],
    disableForReducedMotion: true,
  });

  if (kind === "levelup" && intensity === "full") {
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
      });
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
      });
    }, 200);
  }
}
