import type { AccentThemeId, ImprovementPulse } from "./types";
import { ACCENT_HUES } from "./types";

/** Approximate OKLCH → hex for React Native (no oklch support on all RN versions). */
export const colors = {
  background: "#0B0C10",
  surface: "#14161C",
  surface2: "#1C1F28",
  border: "rgba(255,255,255,0.06)",
  text: "#F4F5F7",
  muted: "#A0A6B4",
  faint: "#6B7280",
  positive: "#34D399",
  warning: "#FBBF24",
  neutralNegative: "#94A3B8",
  danger: "#F87171",
  white: "#FFFFFF",
  black: "#000000",
  flash: "rgba(196, 181, 253, 0.18)",
} as const;

const ACCENT_HEX: Record<AccentThemeId, string> = {
  nebula: "#7C9CFF",
  quantum: "#C084FC",
  terminal: "#4ADE80",
  ember: "#FB923C",
};

export function accentColor(theme: AccentThemeId = "nebula"): string {
  return ACCENT_HEX[theme] ?? ACCENT_HEX.nebula;
}

export function accentSoft(theme: AccentThemeId = "nebula", alpha = 0.16): string {
  const hex = accentColor(theme);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function pulseColor(
  pulse: ImprovementPulse,
  theme: AccentThemeId = "nebula",
): string {
  switch (pulse) {
    case "Improving":
      return colors.positive;
    case "Recovering":
      return colors.warning;
    case "Drifting":
      return colors.neutralNegative;
    case "Stable":
    default:
      return accentColor(theme);
  }
}

export function deltaColor(delta: number): string {
  if (delta > 0) return colors.positive;
  if (delta < 0) return colors.neutralNegative; // never red
  return colors.faint;
}

export { ACCENT_HUES };
