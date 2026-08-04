import { Linking, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { DashboardCard } from "@/lib/types";
import { activityColor, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

/**
 * A pinned agent card. The agent owns the copy — title, subtitle, body and
 * emoji all come from it, so this renders whatever it wrote rather than
 * imposing a shape on it.
 */
export function AgentCard({
  card,
  onComplete,
}: {
  card: DashboardCard;
  onComplete?: () => void;
}) {
  const t = useTokens();
  const tint = card.themeColor || activityColor(card.activityTag, t.accent);

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: rgba(tint, 0.28),
        overflow: "hidden",
        borderCurve: "continuous",
      }}
    >
      <LinearGradient
        colors={[rgba(tint, 0.14), t.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 16, gap: 12 }}
      >
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: rgba(tint, 0.18),
              alignItems: "center",
              justifyContent: "center",
              borderCurve: "continuous",
            }}
          >
            <Text style={{ fontSize: 22 }}>{card.emoji || "✦"}</Text>
          </View>

          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: t.text, fontFamily: font.title, fontSize: 17 }}>
              {card.title}
            </Text>
            {card.subtitle ? (
              <Text style={{ color: t.muted, fontFamily: font.body, fontSize: 13 }}>
                {card.subtitle}
              </Text>
            ) : null}
          </View>

          {card.xpOnComplete > 0 ? (
            <Text style={{ color: t.positive, fontFamily: font.mono, fontSize: 12 }}>
              +{card.xpOnComplete} XP
            </Text>
          ) : null}
        </View>

        {card.body ? (
          <Text
            style={{ color: t.muted, fontFamily: font.body, fontSize: 13, lineHeight: 20 }}
          >
            {card.body}
          </Text>
        ) : null}

        {card.progress > 0 ? (
          <View
            style={{
              height: 5,
              borderRadius: 3,
              backgroundColor: rgba(t.text, 0.08),
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.min(100, card.progress)}%`,
                height: "100%",
                backgroundColor: tint,
                borderRadius: 3,
              }}
            />
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {onComplete ? (
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onComplete();
              }}
              style={({ pressed }) => ({
                backgroundColor: pressed ? tint : rgba(tint, 0.18),
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: radius.sm,
                borderCurve: "continuous",
              })}
            >
              <Text style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 13 }}>
                {card.ctaLabel || "Complete"}
              </Text>
            </Pressable>
          ) : null}
          {card.ctaLink ? (
            <Pressable
              onPress={() => Linking.openURL(card.ctaLink!)}
              hitSlop={8}
              style={{ paddingHorizontal: 8, paddingVertical: 10 }}
            >
              <Text style={{ color: t.muted, fontFamily: font.bodyMedium, fontSize: 13 }}>
                Open ↗
              </Text>
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}

/** The agent's setup / status line. Informational — never a button. */
export function AgentSetupStrip({ card }: { card: DashboardCard }) {
  const t = useTokens();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: rgba(t.accent, 0.08),
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: rgba(t.accent, 0.16),
        paddingVertical: 11,
        paddingHorizontal: 13,
        borderCurve: "continuous",
      }}
    >
      <Text style={{ fontSize: 15 }}>{card.emoji || "✦"}</Text>
      <Text
        style={{ color: t.muted, fontFamily: font.bodyMedium, fontSize: 13, flex: 1 }}
        numberOfLines={2}
      >
        {card.title}
        {card.subtitle ? ` · ${card.subtitle}` : ""}
      </Text>
    </View>
  );
}
