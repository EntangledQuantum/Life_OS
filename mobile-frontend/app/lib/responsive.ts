import { useWindowDimensions } from "react-native";

/**
 * Window size classes.
 *
 * Measured from `useWindowDimensions()` rather than from the device, because on
 * an iPad the app is routinely *not* the size of the screen: Split View and
 * Slide Over hand it a third or a half of the display, and it is resized while
 * running. `Device.deviceType` would say "tablet" for a 320pt-wide Slide Over
 * pane and every layout decision downstream would be wrong.
 *
 * Breakpoints are the Material 3 window size classes, which happen to line up
 * with real iPad widths:
 *
 * | class      | width     | what it is                                      |
 * |------------|-----------|-------------------------------------------------|
 * | `compact`  | `< 600`   | every phone in portrait, iPad Slide Over        |
 * | `medium`   | `600–899` | iPad portrait (768/834), 1/2 split, phone landscape |
 * | `expanded` | `>= 900`  | iPad landscape (1024/1194/1366)                 |
 */
export type SizeClass = "compact" | "medium" | "expanded";

export interface Layout {
  width: number;
  height: number;
  sizeClass: SizeClass;
  landscape: boolean;
  /** Enough room for a side rail instead of a bottom bar. */
  wide: boolean;
  /** Enough room to put two columns of content next to each other. */
  twoPane: boolean;
  /** Screen-edge padding for this class. */
  gutter: number;
  /**
   * How wide content is allowed to get. A single column of habit rows stretched
   * across 1366pt is unreadable — line length is what this caps.
   */
  maxContent: number;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();

  const sizeClass: SizeClass =
    width >= 900 ? "expanded" : width >= 600 ? "medium" : "compact";
  const twoPane = sizeClass === "expanded";
  const wide = sizeClass !== "compact";

  return {
    width,
    height,
    sizeClass,
    landscape: width > height,
    wide,
    twoPane,
    gutter: sizeClass === "compact" ? 18 : sizeClass === "medium" ? 28 : 36,
    maxContent: twoPane ? 1180 : sizeClass === "medium" ? 720 : width,
  };
}
