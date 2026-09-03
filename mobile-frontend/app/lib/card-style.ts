/**
 * How an agent card is laid out and painted.
 *
 * Duplicated from `packages/shared/src/card-style.ts` **on purpose** — this app
 * is deliberately isolated from the workspace and must not import across it.
 * The two files have to agree, or the same card looks like a different object
 * on each surface, which is worse than not offering the choice at all.
 */

export type CardLayout = "banner" | "background" | "side" | "plain";
export type CardBorder = "accent" | "hairline" | "none";

export interface CardStyle {
  layout?: CardLayout;
  overlay?: number;
  gradient?: { from: string; to: string };
  border?: CardBorder;
  align?: "left" | "center";
}

/**
 * The style to actually draw, with defaults filled in, so "no style set" and
 * "style set to the defaults" produce the same card on both surfaces.
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

/**
 * The two pictures a card can carry, resolved to what a renderer should draw.
 *
 * A copy of `cardImages` in `packages/shared/src/tasks.ts` — this app does not
 * import from the workspace. Keep the two identical: the whole reason it is a
 * function rather than four field reads at the call site is that the phone and
 * the dashboard must not end up disagreeing about which image is the icon.
 */
export function cardImages(task: {
  imageUrl: string | null;
  imageData: string | null;
  iconImageUrl: string | null;
  iconImageData: string | null;
}): { media: string | null; icon: string | null } {
  return {
    // Inline data wins: it is already on the device and cannot fail to load.
    media: task.imageData || task.imageUrl || null,
    icon: task.iconImageData || task.iconImageUrl || null,
  };
}
