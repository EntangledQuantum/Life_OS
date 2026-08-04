import { Text, View } from "react-native";
import { colors, accentColor } from "@/lib/theme";
import type { AccentThemeId } from "@/lib/types";

export function XpChart({
  series,
  theme = "nebula",
}: {
  series: { date: string; current: number; target: number }[];
  theme?: AccentThemeId;
}) {
  if (!series?.length) return null;
  const max = Math.max(
    ...series.map((s) => Math.max(s.current, s.target)),
    1,
  );
  const accent = accentColor(theme);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        borderCurve: "continuous",
        gap: 10,
      }}
    >
      <Text
        style={{
          color: colors.faint,
          fontFamily: "Figtree_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.8,
        }}
      >
        7-DAY XP
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          height: 88,
          gap: 6,
        }}
      >
        {series.map((s) => {
          const h = Math.max(4, (s.current / max) * 80);
          const targetH = Math.max(4, (s.target / max) * 80);
          const day = s.date.slice(5); // MM-DD
          return (
            <View
              key={s.date}
              style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}
            >
              <View
                style={{
                  width: "100%",
                  height: 80,
                  justifyContent: "flex-end",
                  position: "relative",
                }}
              >
                {/* target dashed line */}
                <View
                  style={{
                    position: "absolute",
                    bottom: targetH,
                    left: 0,
                    right: 0,
                    height: 1,
                    backgroundColor: colors.faint,
                    opacity: 0.5,
                  }}
                />
                <View
                  style={{
                    width: "100%",
                    height: h,
                    backgroundColor: accent,
                    borderTopLeftRadius: 6,
                    borderTopRightRadius: 6,
                    opacity: 0.9,
                  }}
                />
              </View>
              <Text
                style={{
                  color: colors.faint,
                  fontFamily: "JetBrainsMono_500Medium",
                  fontSize: 9,
                  marginTop: 4,
                }}
              >
                {day}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
