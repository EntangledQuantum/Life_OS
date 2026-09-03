/**
 * Pictures on habits, goals and rarity tiers — one contract for all three.
 *
 * Cards could carry art and nothing else could, so a habit and a goal were a
 * coloured emoji in a tinted square no matter what they were about. These are
 * the same two slots the card model settled on, with the same meanings:
 *
 * - **icon** — what marks this thing in a list of things. Square, small, drawn
 *   in place of the emoji.
 * - **background** — what it is *about*. Fills the card behind the text, under
 *   a scrim, so the words stay readable.
 *
 * Both are optional everywhere and always have been. Nothing here forces an
 * agent to supply a picture: a habit or goal with no art renders exactly as it
 * did before any of this existed, and that is the shape most of them should
 * stay. A picture is worth adding when it says something the emoji cannot.
 *
 * Habit cards and goal cards are deliberately the same shape, so one image
 * works in either place and an agent has one set of dimensions to remember
 * rather than two.
 */

/**
 * What to hand us, and why these numbers.
 *
 * The background is drawn `cover` into a landscape box — cropped from the
 * centre outward, so anything that must survive belongs in the middle. 3:2 is
 * the ratio of the box on both clients; give it more pixels than the box so it
 * stays sharp on a phone at 3× density, and not so many that a `data:` URI
 * becomes megabytes of JSON on every dashboard poll.
 *
 * The icon is drawn into a rounded square about 44pt across. 256×256 is four
 * times that at 3×, which is enough for any screen and small enough to inline.
 */
export const ART_SPEC = {
  background: {
    /** width ÷ height. The box is this on web and on the phone. */
    aspect: 3 / 2,
    recommended: { width: 1200, height: 800 },
    minimum: { width: 600, height: 400 },
    note: "Cover-cropped from the centre. Keep the subject away from the edges.",
  },
  icon: {
    aspect: 1,
    recommended: { width: 256, height: 256 },
    minimum: { width: 96, height: 96 },
    note: "Drawn at about 44pt in a rounded square. A busy image reads as mud at that size.",
  },
} as const;

/**
 * How dark the scrim over a background picture is.
 *
 * Same floor as the card model, for the same reason: a habit whose name cannot
 * be read over its own photograph is not a style choice, it is a broken row.
 */
export const MIN_ART_OVERLAY = 0.35;
export const DEFAULT_ART_OVERLAY = 0.58;

/** The four fields a habit, a goal or a tier can carry. All optional. */
export interface ArtFields {
  iconImageUrl?: string | null;
  iconImageData?: string | null;
  backgroundImageUrl?: string | null;
  backgroundImageData?: string | null;
  /** 0.35–0.92. How dark the scrim over the background is. */
  artOverlay?: number | null;
}

/** What a renderer actually draws: two resolved sources, or nothing. */
export interface ResolvedArt {
  icon: string | null;
  background: string | null;
  overlay: number;
  /** True when there is any picture at all — the plain path is not a fallback. */
  hasArt: boolean;
}

/**
 * Resolve the four fields to what a client should draw.
 *
 * Both clients call this rather than reading the fields and choosing, so the
 * phone and the dashboard cannot drift apart about which picture is which —
 * exactly the drift the single card image slot produced.
 */
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

/**
 * The look of a celebration, chosen per tier.
 *
 * A closed set, and small on purpose. Every theme is implemented on both
 * surfaces, which is only affordable if there are six of them; an open palette
 * would end up half-supported on the phone, which is the state the card
 * `layout` vocabulary was written to avoid.
 *
 * The agent picks the *feeling*, not the hex codes — it does not know what
 * accent the user is running, and a tier that hard-codes its own purple against
 * a gold theme looks like a bug rather than a rarity.
 */
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
  /** Drives the halo, the rays and the ring. */
  primary: string;
  /** The second stop of every gradient in the overlay. */
  secondary: string;
  /** Confetti and particles. */
  particles: string[];
  /** How loud the animation is, 0–1. Higher tiers earn more. */
  intensity: number;
  /** One word shown above the title, if the tier does not name itself. */
  word: string;
}

/**
 * One table, read by both clients. A theme that looked different on the phone
 * than on the dashboard would make the rarity meaningless — it is supposed to
 * be recognisable at a glance, across surfaces.
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
  return THEME_PALETTES[(theme ?? "spark") as CelebrationTheme] ?? THEME_PALETTES.spark;
}

/**
 * How many rungs a goal may have.
 *
 * Five, and the limit is the point. A ladder with fifteen rungs is not a set of
 * rarities, it is a progress bar with extra steps — and the whole value of a
 * rarity is that reaching the top one is rare.
 */
export const MAX_GOAL_TIERS = 5;
