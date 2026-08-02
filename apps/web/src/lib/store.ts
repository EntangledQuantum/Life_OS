import { create } from "zustand";
import type { AccentThemeId } from "@life-os/shared";

interface UiState {
  accentTheme: AccentThemeId;
  setAccentTheme: (t: AccentThemeId) => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
  celebrationIntensity: "full" | "minimal" | "off";
  setCelebrationIntensity: (v: "full" | "minimal" | "off") => void;
}

export const useUiStore = create<UiState>((set) => ({
  accentTheme: "nebula",
  setAccentTheme: (accentTheme) => {
    document.documentElement.setAttribute("data-theme", accentTheme);
    set({ accentTheme });
  },
  reducedMotion: false,
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  celebrationIntensity: "full",
  setCelebrationIntensity: (celebrationIntensity) => set({ celebrationIntensity }),
}));
