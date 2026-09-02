/**
 * How an agent card is laid out and painted.
 *
 * A card already carried a title, a body, an emoji, a colour, an image, an
 * inline SVG, a progress bar, a call to action and one interactive control —
 * but the *arrangement* was fixed. An image was always a 144px banner across
 * the top, whatever the picture was for, so an agent that wanted a photograph
 * behind its text could not have one, and one that wanted a small square beside
 * the title got a letterboxed crop instead. On the phone the image was not
 * drawn at all, which meant a card could look considered on the desktop and
 * plain on the device it was mostly read on.
 *
 * This is the arrangement, kept deliberately small. Four layouts, a scrim, a
 * gradient and a border weight — enough to make a card look like the thing it
 * is about, and few enough that both clients can implement all of it and keep
 * implementing it. A styling language with thirty knobs would end up half
 * supported on one surface, which is the state this replaces.
 *
 * Everything is optional. A card with no style at all renders exactly as cards
 * always have.
 */

export const CARD_LAYOUTS = ["banner", "background", "side", "plain"] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

export const CARD_BORDERS = ["accent", "hairline", "none"] as const;
export type CardBorder = (typeof CARD_BORDERS)[number];

export interface CardStyle {
  /**
   * Where the media goes.
   *
   * - `banner` — across the top, text underneath. The default, and right for a
   *   wide picture.
   * - `background` — behind everything, with a scrim over it. For atmosphere;
   *   the text has to stay readable, which is what `overlay` is for.
   * - `side` — a small square beside the title. For a book cover or an avatar,
   *   where a banner crop would cut the subject in half.
   * - `plain` — no media even if an image is set. Useful for turning a picture
   *   off without deleting it.
   */
  layout?: CardLayout;
  /**
   * How dark the scrim over a background image is, 0–1.
   *
   * Only meaningful with `layout: "background"`. Clamped, and floored at a
   * value that keeps body text legible — a card whose text cannot be read is
   * not a style choice, it is a broken card.
   */
  overlay?: number;
  /** Two-stop wash behind the card. Any CSS-ish colour both clients understand. */
  gradient?: { from: string; to: string };
  /** How present the card's edge is. */
  border?: CardBorder;
  /** Header alignment. `center` suits a single short line and a big emoji. */
  align?: "left" | "center";
}

/** Below this the text over a photograph stops being reliably readable. */
export const MIN_CARD_OVERLAY = 0.35;

const isColor = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 64;

/**
 * Coerce whatever an agent sent into a style this app can draw, dropping
 * anything it cannot.
 *
 * Silently dropping a bad field rather than rejecting the whole card is
 * deliberate here: the style is decoration, and a typo in a gradient should not
 * cost the user the card's actual content. Invalid *content* is still rejected
 * — that is a different question.
 */
export function normalizeCardStyle(value: unknown): CardStyle | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const out: CardStyle = {};

  if ((CARD_LAYOUTS as readonly string[]).includes(String(raw.layout))) {
    out.layout = raw.layout as CardLayout;
  }

  if (raw.overlay !== undefined) {
    const n = Number(raw.overlay);
    if (Number.isFinite(n)) {
      out.overlay = Math.min(0.92, Math.max(MIN_CARD_OVERLAY, n));
    }
  }

  if (raw.gradient && typeof raw.gradient === "object") {
    const g = raw.gradient as Record<string, unknown>;
    if (isColor(g.from) && isColor(g.to)) {
      out.gradient = { from: g.from, to: g.to };
    }
  }

  if ((CARD_BORDERS as readonly string[]).includes(String(raw.border))) {
    out.border = raw.border as CardBorder;
  }

  if (raw.align === "left" || raw.align === "center") out.align = raw.align;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The style a client should actually draw, with the defaults filled in.
 *
 * Both renderers call this rather than reading the raw object, so "no style
 * set" and "style set to the defaults" produce the same card on both surfaces
 * instead of two slightly different ones.
 */
export function resolveCardStyle(
  style: CardStyle | null | undefined,
  hasMedia: boolean,
): Required<Omit<CardStyle, "gradient">> & { gradient: CardStyle["gradient"] } {
  const layout = style?.layout ?? "banner";
  return {
    // A background or side layout with nothing to show is just a plain card.
    layout: hasMedia ? layout : "plain",
    overlay: style?.overlay ?? 0.62,
    gradient: style?.gradient,
    border: style?.border ?? "accent",
    align: style?.align ?? "left",
  };
}
