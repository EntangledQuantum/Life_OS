import type { AccentThemeId, Activity, ImprovementPulse } from "./types";
import { ACCENT_HUES } from "./types";

/**
 * Mobile palettes.
 *
 * These are *device-local* and deliberately richer than the API's four
 * `accentTheme` hues. The server setting stays the source of truth for the web
 * client; the phone gets its own look, which is the whole point of it not being
 * a web page in a shell.
 *
 * Dark only — there is no light theme, on purpose.
 */

export type PaletteId =
  | "bloom"
  | "orchid"
  | "sunset"
  | "nebula"
  | "lagoon"
  | "terminal"
  | "ember"
  | "gold";

export interface Tokens {
  id: PaletteId;
  name: string;

  /** Primary accent, and the partner it gradients into. */
  accent: string;
  accent2: string;
  /** Readable foreground on top of an `accent` fill. */
  onAccent: string;
  /** Halo colour for glows — always rgba so it can stack. */
  glow: string;
  glowSoft: string;

  bg: string;
  /** Top of the screen wash; sits behind everything. */
  bgLift: string;
  surface: string;
  surface2: string;
  border: string;
  borderLift: string;

  text: string;
  muted: string;
  faint: string;

  positive: string;
  warning: string;
  /** A worse day is never red. Grey-blue instead. */
  neutralNegative: string;
  danger: string;
  flash: string;
}

const SEMANTIC = {
  text: "#F6F4F8",
  muted: "#A8A3B4",
  faint: "#6E6A7C",
  positive: "#34D399",
  warning: "#FBBF24",
  neutralNegative: "#94A3B8",
  danger: "#F87171",
} as const;

function palette(
  id: PaletteId,
  name: string,
  p: {
    accent: string;
    accent2: string;
    onAccent?: string;
    glow: string;
    bg: string;
    bgLift: string;
    surface: string;
    surface2: string;
  },
): Tokens {
  return {
    id,
    name,
    accent: p.accent,
    accent2: p.accent2,
    onAccent: p.onAccent ?? "#12070E",
    glow: rgba(p.glow, 0.34),
    glowSoft: rgba(p.glow, 0.12),
    bg: p.bg,
    bgLift: p.bgLift,
    surface: p.surface,
    surface2: p.surface2,
    border: "rgba(255,255,255,0.07)",
    borderLift: rgba(p.accent, 0.22),
    ...SEMANTIC,
    flash: rgba(p.accent, 0.16),
  };
}

export const PALETTES: Record<PaletteId, Tokens> = {
  bloom: palette("bloom", "Bloom", {
    accent: "#FF5FA2",
    accent2: "#FFA0C9",
    glow: "#FF5FA2",
    bg: "#0D0910",
    bgLift: "#160D18",
    surface: "#1A1220",
    surface2: "#241829",
  }),
  orchid: palette("orchid", "Orchid", {
    accent: "#C77DFF",
    accent2: "#8B6BFF",
    glow: "#B07BFF",
    bg: "#0B0912",
    bgLift: "#140F1F",
    surface: "#171327",
    surface2: "#211B33",
  }),
  sunset: palette("sunset", "Sunset", {
    accent: "#FF7A6B",
    accent2: "#FFC46B",
    glow: "#FF8A5C",
    bg: "#100B0B",
    bgLift: "#1A1010",
    surface: "#1E1414",
    surface2: "#2A1C1A",
  }),
  nebula: palette("nebula", "Nebula", {
    accent: "#7C9CFF",
    accent2: "#B69CFF",
    onAccent: "#080B18",
    glow: "#7C9CFF",
    bg: "#090A12",
    bgLift: "#0F1120",
    surface: "#141728",
    surface2: "#1D2134",
  }),
  lagoon: palette("lagoon", "Lagoon", {
    accent: "#2DD4BF",
    accent2: "#38BDF8",
    onAccent: "#04120F",
    glow: "#2DD4BF",
    bg: "#07100F",
    bgLift: "#0B1A1A",
    surface: "#0F1D1E",
    surface2: "#16292B",
  }),
  terminal: palette("terminal", "Terminal", {
    accent: "#4ADE80",
    accent2: "#A3E635",
    onAccent: "#05130A",
    glow: "#4ADE80",
    bg: "#080D0A",
    bgLift: "#0D1611",
    surface: "#111A15",
    surface2: "#19261D",
  }),
  ember: palette("ember", "Ember", {
    accent: "#FB923C",
    accent2: "#F472B6",
    onAccent: "#140A04",
    glow: "#FB923C",
    bg: "#0E0A08",
    bgLift: "#17100B",
    surface: "#1B1410",
    surface2: "#261B15",
  }),
  gold: palette("gold", "Gold", {
    accent: "#FFC857",
    accent2: "#FF9E6B",
    onAccent: "#150F03",
    glow: "#FFC857",
    bg: "#0E0C07",
    bgLift: "#17130B",
    surface: "#1A160F",
    surface2: "#251F15",
  }),
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
export const DEFAULT_PALETTE: PaletteId = "bloom";

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === "string" && v in PALETTES;
}

export function tokensFor(id: PaletteId | null | undefined): Tokens {
  return PALETTES[id ?? DEFAULT_PALETTE] ?? PALETTES[DEFAULT_PALETTE];
}

/**
 * Server `accentTheme` → nearest mobile palette. Only used to seed a first
 * choice; once the user picks locally, their pick wins.
 */
export const ACCENT_TO_PALETTE: Record<AccentThemeId, PaletteId> = {
  nebula: "nebula",
  quantum: "orchid",
  terminal: "terminal",
  ember: "ember",
};

/* ------------------------------------------------------------- activities */

/** Each day bucket gets its own hue so a timeline reads without a legend. */
export const ACTIVITY_COLORS: Record<Activity, string> = {
  "Deep Work": "#6EA8FF",
  Study: "#B57BFF",
  Exercise: "#FF7A9C",
  Break: "#4ADE80",
  "Life Admin": "#FBBF24",
  Sleep: "#5C6BC0",
  Exploration: "#22D3EE",
};

export function activityColor(a: string | null | undefined, fallback: string): string {
  if (!a) return fallback;
  return ACTIVITY_COLORS[a as Activity] ?? fallback;
}

/* ---------------------------------------------------------------- helpers */

/** `#RRGGBB` + alpha → `rgba(...)`. Passes through anything already rgba. */
export function rgba(hex: string, alpha: number): string {
  if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Blend two hex colours. `amount` 0 → a, 1 → b. */
export function mix(a: string, b: string, amount: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const t = Math.min(1, Math.max(0, amount));
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(pa[0], pb[0])},${c(pa[1], pb[1])},${c(pa[2], pb[2])})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

export function pulseColor(pulse: ImprovementPulse, t: Tokens): string {
  switch (pulse) {
    case "Improving":
      return t.positive;
    case "Recovering":
      return t.warning;
    case "Drifting":
      return t.neutralNegative;
    case "Stable":
    default:
      return t.accent;
  }
}

export function deltaColor(delta: number, t: Tokens): string {
  if (delta > 0) return t.positive;
  if (delta < 0) return t.neutralNegative; // never red
  return t.faint;
}

/* ------------------------------------------------------------- typography */

/**
 * Outfit for anything that carries voice, JetBrains Mono for every number so
 * figures stop jittering as they tick.
 */
export const font = {
  display: "Outfit_700Bold",
  displaySemi: "Outfit_600SemiBold",
  title: "Outfit_600SemiBold",
  body: "Figtree_400Regular",
  bodyMedium: "Figtree_500Medium",
  bodySemi: "Figtree_600SemiBold",
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_600SemiBold",
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Static fallback so non-themed helpers still have something to draw with. */
export const colors = {
  ...PALETTES[DEFAULT_PALETTE],
  background: PALETTES[DEFAULT_PALETTE].bg,
  white: "#FFFFFF",
  black: "#000000",
};

export { ACCENT_HUES };
