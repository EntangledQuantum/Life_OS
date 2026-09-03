import { Image } from "expo-image";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { ImageStyle } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { resolveArt, type ArtFields } from "@/lib/art";
import { radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

/**
 * The two pictures a habit, a goal or a tier can carry — the phone's copy.
 *
 * Mirrors `apps/web/src/components/Art.tsx`: same fields, same fallback to the
 * emoji, same scrim floor. Getting any of that subtly different between the two
 * surfaces is how one app starts looking like two.
 *
 * **`expo-image`, not `react-native`'s `Image`.** It keeps a real memory *and
 * disk* cache, so a habit's background is fetched once and then survives
 * restarts and flight mode. RN's own Image leans on the platform HTTP cache,
 * which is smaller, evicted sooner, and gives a row of broken pictures the
 * first time the phone is off the network — in an app whose whole claim is
 * that it works without anything remote. A `data:` URI is already local and
 * costs nothing either way.
 */
const CACHE_POLICY = "memory-disk" as const;

export function ArtBackground({
  art,
  radius: r = radius.lg,
}: {
  art: ArtFields | null | undefined;
  radius?: number;
}) {
  const { background, overlay } = resolveArt(art);
  if (!background) return null;

  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", inset: 0, borderRadius: r, overflow: "hidden" }}
    >
      <Image
        source={{ uri: background }}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
        cachePolicy={CACHE_POLICY}
        transition={160}
      />
      {/*
        The scrim is not optional and has a floor — a habit whose name cannot be
        read over its own photograph is a broken row. `resolveArt` clamps it.
      */}
      <LinearGradient
        colors={[
          `rgba(7,8,12,${overlay * 0.78})`,
          `rgba(7,8,12,${Math.min(0.96, overlay + 0.18)})`,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: "absolute", inset: 0 }}
      />
    </View>
  );
}

/** The icon tile: the picture if there is one, the emoji if not. */
export function ArtIcon({
  art,
  emoji,
  color,
  size = 44,
  style,
}: {
  art: ArtFields | null | undefined;
  emoji: string | null | undefined;
  color: string;
  size?: number;
  /** Extra layout only — the tile is an Image or a View depending on the art. */
  style?: StyleProp<ViewStyle & ImageStyle>;
}) {
  const t = useTokens();
  const { icon } = resolveArt(art);
  const tint = color || t.accent;

  if (icon) {
    return (
      <Image
        source={{ uri: icon }}
        style={[
          {
            width: size,
            height: size,
            borderRadius: radius.md,
            backgroundColor: rgba(tint, 0.18),
          },
          style as StyleProp<ImageStyle>,
        ]}
        contentFit="cover"
        cachePolicy={CACHE_POLICY}
        transition={160}
      />
    );
  }

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: rgba(tint, 0.18),
          alignItems: "center",
          justifyContent: "center",
          borderCurve: "continuous",
        },
        style as StyleProp<ViewStyle>,
      ]}
    >
      <Text style={{ fontSize: Math.round(size * 0.5) }}>{emoji || "✨"}</Text>
    </View>
  );
}

/** Does this thing have any art at all? Decides whether a card needs a scrim. */
export function hasArt(art: ArtFields | null | undefined): boolean {
  return resolveArt(art).hasArt;
}

/**
 * Pull pictures onto the device before they are needed.
 *
 * The one that matters is a goal tier's: it is not on screen until the
 * condition comes true, and at that moment it is wanted full-screen and
 * immediately. Fetching it then means the celebration opens on an empty
 * medallion and fills in a beat later — exactly the beat that was meant to
 * feel like an arrival.
 */
export function prefetchArt(sources: (string | null | undefined)[]): void {
  const remote = sources.filter(
    (s): s is string => Boolean(s) && /^https?:\/\//i.test(s!),
  );
  if (remote.length === 0) return;
  void Image.prefetch(remote, { cachePolicy: CACHE_POLICY });
}
