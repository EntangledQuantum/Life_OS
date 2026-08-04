import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo } from "react-native";
import {
  DEFAULT_PALETTE,
  isPaletteId,
  tokensFor,
  type PaletteId,
  type Tokens,
} from "./theme";
import { getPalette, setPalette } from "./storage";

interface ThemeValue {
  t: Tokens;
  palette: PaletteId;
  choose: (id: PaletteId) => void;
  /** OS-level "reduce motion". OR this with settings.reducedMotion. */
  osReducedMotion: boolean;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<PaletteId>(DEFAULT_PALETTE);
  const [osReducedMotion, setOsReducedMotion] = useState(false);

  useEffect(() => {
    void getPalette().then((stored) => {
      if (isPaletteId(stored)) setPaletteState(stored);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setOsReducedMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setOsReducedMotion,
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const choose = useCallback((id: PaletteId) => {
    setPaletteState(id);
    void setPalette(id);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ t: tokensFor(palette), palette, choose, osReducedMotion }),
    [palette, choose, osReducedMotion],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme must be used inside <ThemeProvider>");
  return v;
}

/** Shorthand for the common case — just the colour tokens. */
export function useTokens(): Tokens {
  return useTheme().t;
}
