import { Linking, Pressable, Text, View } from "react-native";
import type { DashboardCard } from "@/lib/types";
import { colors } from "@/lib/theme";
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
  const when = card.eventAt ?? card.remindAt;
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
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: urgent ? "rgba(196,181,253,0.35)" : colors.border,
        borderCurve: "continuous",
      }}
    >
      <Text style={{ fontSize: 22 }}>{card.emoji || "📌"}</Text>

      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            color: colors.text,
            fontFamily: "Figtree_600SemiBold",
            fontSize: 15,
          }}
          numberOfLines={1}
        >
          {card.title}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {card.activityTag ? (
            <Text
              style={{
                color: card.themeColor || colors.muted,
                fontFamily: "Figtree_500Medium",
                fontSize: 12,
              }}
            >
              {card.activityTag}
            </Text>
          ) : null}
          {when ? (
            <Text
              style={{
                color: colors.faint,
                fontFamily: "JetBrainsMono_500Medium",
                fontSize: 11,
              }}
            >
              {formatClock(when)} · {formatRelative(when)}
            </Text>
          ) : null}
          {card.durationMinutes ? (
            <Text
              style={{
                color: colors.faint,
                fontFamily: "JetBrainsMono_500Medium",
                fontSize: 11,
              }}
            >
              {card.durationMinutes}m
            </Text>
          ) : null}
          {card.repeatRule && card.repeatRule !== "none" ? (
            <Text style={{ color: colors.faint, fontSize: 11 }}>↻ {card.repeatRule}</Text>
          ) : null}
          {card.remindAt ? (
            <Text style={{ color: colors.faint, fontSize: 11 }}>🔔</Text>
          ) : null}
          {card.xpOnComplete > 0 ? (
            <Text
              style={{
                color: colors.positive,
                fontFamily: "JetBrainsMono_500Medium",
                fontSize: 11,
              }}
            >
              +{card.xpOnComplete} XP
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {canStart && onStart ? (
          <Pressable
            onPress={onStart}
            style={{
              backgroundColor: colors.text,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 10,
            }}
          >
            <Text
              style={{
                color: colors.background,
                fontFamily: "Figtree_600SemiBold",
                fontSize: 13,
              }}
            >
              Start
            </Text>
          </Pressable>
        ) : null}
        {onComplete ? (
          <Pressable
            onPress={onComplete}
            hitSlop={8}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: colors.positive, fontSize: 16 }}>✓</Text>
          </Pressable>
        ) : null}
        {card.ctaLink ? (
          <Pressable onPress={() => Linking.openURL(card.ctaLink!)} hitSlop={8}>
            <Text style={{ color: colors.muted, fontSize: 14 }}>↗</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
