import { Modal, Pressable, Text, View } from "react-native";
import type { Goal } from "@/lib/types";
import { colors, accentColor } from "@/lib/theme";
import type { AccentThemeId } from "@/lib/types";

/**
 * Full-screen, unmissable. celebration-seen fires ONLY after user dismisses.
 * Never auto-dismiss.
 */
export function CelebrationModal({
  goal,
  intensity = "full",
  theme = "nebula",
  onDismiss,
}: {
  goal: Goal | null;
  intensity?: "full" | "minimal" | "off";
  theme?: AccentThemeId;
  onDismiss: () => void;
}) {
  if (!goal || intensity === "off") return null;
  const accent = accentColor(theme);

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.92)",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        }}
      >
        <Text style={{ fontSize: intensity === "full" ? 72 : 48 }}>
          {goal.emoji || "🎯"}
        </Text>
        <Text
          style={{
            marginTop: 16,
            color: accent,
            fontFamily: "Figtree_700Bold",
            fontSize: 14,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Goal complete
        </Text>
        <Text
          style={{
            marginTop: 10,
            color: colors.text,
            fontFamily: "Figtree_700Bold",
            fontSize: 28,
            textAlign: "center",
          }}
        >
          {goal.title}
        </Text>
        {goal.whyItMatters ? (
          <Text
            style={{
              marginTop: 12,
              color: colors.muted,
              fontFamily: "Figtree_400Regular",
              fontSize: 15,
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            {goal.whyItMatters}
          </Text>
        ) : null}

        <Pressable
          onPress={onDismiss}
          style={{
            marginTop: 36,
            backgroundColor: accent,
            paddingHorizontal: 28,
            paddingVertical: 14,
            borderRadius: 14,
            borderCurve: "continuous",
          }}
        >
          <Text
            style={{
              color: colors.background,
              fontFamily: "Figtree_700Bold",
              fontSize: 16,
            }}
          >
            I saw it
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
