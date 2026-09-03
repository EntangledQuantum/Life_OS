/**
 * Pictures on habits, goals and rarity tiers — the phone's copy of the
 * contract.
 *
 * A straight copy of `packages/shared/src/art.ts`, because this app must not
 * import from the workspace (see `AGENTS.md`). Keep the two identical: the
 * reason `resolveArt` is a function rather than four field reads at each call
 * site is that the phone and the dashboard must not drift apart about which
 * picture is the icon and how dark the scrim is.
 */

/** What to hand us, and why these numbers — see the shared file for the full note. */
export const ART_SPEC = {
  background: {
    aspect: 3 / 2,
    recommended: { width: 1200, height: 800 },
    minimum: { width: 600, height: 400 },
  },
  icon: {
    aspect: 1,
    recommended: { width: 256, height: 256 },
    minimum: { width: 96, height: 96 },
  },
} as const;

export const MIN_ART_OVERLAY = 0.35;
export const DEFAULT_ART_OVERLAY = 0.58;

export interface ArtFields {
  iconImageUrl?: string | null;
  iconImageData?: string | null;
  backgroundImageUrl?: string | null;
  backgroundImageData?: string | null;
  artOverlay?: number | null;
}

export interface ResolvedArt {
  icon: string | null;
  background: string | null;
  overlay: number;
  hasArt: boolean;
}

export function resolveArt(fields: ArtFields | null | undefined): ResolvedArt {
  // Inline data wins: it is already on the device and cannot fail to load.
  const icon = fields?.iconImageData || fields?.iconImageUrl || null;
  const background =
    fields?.backgroundImageData || fields?.backgroundImageUrl || null;
  const raw = Number(fields?.artOverlay);
  const overlay = Number.isFinite(raw)
    ? Math.min(0.92, Math.max(MIN_ART_OVERLAY, raw))
    : DEFAULT_ART_OVERLAY;
  return { icon, background, overlay, hasArt: Boolean(icon || background) };
}

/* ------------------------------------------------------------------ rarity */

export const CELEBRATION_THEMES = [
  "spark",
  "ember",
  "gold",
  "frost",
  "aurora",
  "void",
] as const;
export type CelebrationTheme = (typeof CELEBRATION_THEMES)[number];

export interface ThemePalette {
  primary: string;
  secondary: string;
  particles: string[];
  /** How loud the animation is, 0–1. Higher tiers earn more. */
  intensity: number;
  word: string;
}

/**
 * The same table the dashboard reads. A theme that looked different here would
 * make the rarity meaningless — it is supposed to be recognisable at a glance,
 * across surfaces.
 */
export const THEME_PALETTES: Record<CelebrationTheme, ThemePalette> = {
  spark: {
    primary: "#8B9DC3",
    secondary: "#5B6B8C",
    particles: ["#8B9DC3", "#C3CBDC", "#6B7B9C"],
    intensity: 0.35,
    word: "Reached",
  },
  ember: {
    primary: "#F97316",
    secondary: "#7C2D12",
    particles: ["#F97316", "#FB923C", "#FDBA74", "#DC2626"],
    intensity: 0.55,
    word: "Forged",
  },
  gold: {
    primary: "#FBBF24",
    secondary: "#92400E",
    particles: ["#FBBF24", "#FCD34D", "#FDE68A", "#F59E0B"],
    intensity: 0.75,
    word: "Gold",
  },
  frost: {
    primary: "#67E8F9",
    secondary: "#0E7490",
    particles: ["#67E8F9", "#A5F3FC", "#CFFAFE", "#22D3EE"],
    intensity: 0.6,
    word: "Crystalline",
  },
  aurora: {
    primary: "#A78BFA",
    secondary: "#4C1D95",
    particles: ["#A78BFA", "#F0ABFC", "#67E8F9", "#86EFAC"],
    intensity: 0.85,
    word: "Radiant",
  },
  void: {
    primary: "#F0ABFC",
    secondary: "#1E1B4B",
    particles: ["#F0ABFC", "#818CF8", "#E879F9", "#FFFFFF"],
    intensity: 1,
    word: "Beyond",
  },
};

export function themePalette(theme: string | null | undefined): ThemePalette {
  return (
    THEME_PALETTES[(theme ?? "spark") as CelebrationTheme] ?? THEME_PALETTES.spark
  );
}

export const MAX_GOAL_TIERS = 5;
