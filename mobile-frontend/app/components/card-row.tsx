import { Linking, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { DashboardCard } from "@/lib/types";
import { activityColor, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { formatClock, formatRelative } from "@/lib/format";

export function CardRow({
  card,
  urgent,
  onStart,
  onComplete,
  showStart,
}: {
  card: DashboardCard;
  urgent?: boolean;
  onStart?: () => void;
  onComplete?: () => void;
  showStart?: boolean;
}) {
  const t = useTokens();
  const when = card.eventAt ?? card.remindAt;
  const tint = card.themeColor || activityColor(card.activityTag, t.accent);
  const canStart =
    showStart !== false &&
    card.kind === "event" &&
    !card.linkedBlockId &&
    card.status === "active";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: urgent ? rgba(t.accent, 0.45) : t.border,
        borderCurve: "continuous",
      }}
    >
      {/* activity colour as a full-height bar, not a left glow */}
      <View
        style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: tint }}
      />

      <Text style={{ fontSize: 20 }}>{card.emoji || "📌"}</Text>

      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 15 }}
          numberOfLines={1}
        >
          {card.title}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {when ? (
            <Text
              style={{
                color: t.muted,
                fontFamily: font.mono,
                fontSize: 11,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatClock(when)} · {formatRelative(when)}
            </Text>
          ) : null}
          {card.activityTag ? (
            <Text style={{ color: tint, fontFamily: font.bodyMedium, fontSize: 11 }}>
              {card.activityTag}
            </Text>
          ) : null}
          {card.durationMinutes ? (
            <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
              {card.durationMinutes}m
            </Text>
          ) : null}
          {card.repeatRule && card.repeatRule !== "none" ? (
            <Text style={{ color: t.faint, fontSize: 11 }}>↻ {card.repeatRule}</Text>
          ) : null}
          {card.remindAt ? <Text style={{ fontSize: 10 }}>🔔</Text> : null}
          {card.xpOnComplete > 0 ? (
            <Text style={{ color: t.positive, fontFamily: font.mono, fontSize: 11 }}>
              +{card.xpOnComplete} XP
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {canStart && onStart ? (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onStart();
            }}
            style={({ pressed }) => ({
              backgroundColor: t.accent,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radius.sm,
              borderCurve: "continuous",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{ color: t.onAccent, fontFamily: font.bodySemi, fontSize: 13 }}
            >
              Start
            </Text>
          </Pressable>
        ) : null}
        {onComplete ? (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onComplete();
            }}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: rgba(t.positive, 0.4),
              backgroundColor: rgba(t.positive, pressed ? 0.25 : 0.08),
              alignItems: "center",
              justifyContent: "center",
              borderCurve: "continuous",
            })}
          >
            <Text style={{ color: t.positive, fontSize: 15 }}>✓</Text>
          </Pressable>
        ) : null}
        {card.ctaLink ? (
          <Pressable onPress={() => Linking.openURL(card.ctaLink!)} hitSlop={8}>
            <Text style={{ color: t.muted, fontSize: 14 }}>↗</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
