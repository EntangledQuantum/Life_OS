import { resolveArt, type ArtFields } from "@life-os/shared";
import { useCachedImage } from "@/lib/image-cache";
import { cn } from "@/lib/utils";

/**
 * The two pictures a habit, a goal or a tier can carry.
 *
 * One component rather than the same twelve lines in four places: the icon
 * falls back to the emoji, the background is always under a scrim, and both
 * come from the on-device cache. Getting any of those subtly different between
 * a habit card and a goal card is how two surfaces of the same app end up
 * looking like two apps.
 */

/**
 * The background layer. Renders nothing at all when there is no picture, which
 * is the normal case — art is never required and its absence is not a fallback.
 */
export function ArtBackground({
  art,
  className,
}: {
  art: ArtFields | null | undefined;
  className?: string;
}) {
  const { background, overlay } = resolveArt(art);
  const src = useCachedImage(background);
  if (!src) return null;

  return (
    <div className={cn("pointer-events-none absolute inset-0", className)} aria-hidden>
      <img src={src} alt="" className="h-full w-full object-cover" />
      {/*
        The scrim is not optional and has a floor. A habit whose name cannot be
        read over its own photograph is a broken row, not a style choice —
        `resolveArt` clamps it, this just draws it.
      */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgba(7,8,12,${overlay * 0.78}), rgba(7,8,12,${Math.min(0.96, overlay + 0.18)}))`,
        }}
      />
    </div>
  );
}

/**
 * The icon tile: the picture if there is one, the emoji if not.
 *
 * `size` is a Tailwind size pair rather than a number so the tile matches
 * whatever it sits next to — a habit row and a goal card do not want the same
 * one, but both want the emoji and the picture to be the same size as each
 * other.
 */
export function ArtIcon({
  art,
  emoji,
  color,
  className,
  emojiClassName,
}: {
  art: ArtFields | null | undefined;
  emoji: string | null | undefined;
  color: string;
  className?: string;
  emojiClassName?: string;
}) {
  const { icon } = resolveArt(art);
  const src = useCachedImage(icon);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn("shrink-0 rounded-[13px] object-cover", className)}
        style={{ background: `${color}22` }}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[13px]",
        className,
        emojiClassName,
      )}
      style={{ background: `${color}22` }}
    >
      {emoji ?? "✨"}
    </span>
  );
}

/** Does this thing have any art at all? Decides whether a card needs a scrim. */
export function hasArt(art: ArtFields | null | undefined): boolean {
  return resolveArt(art).hasArt;
}
