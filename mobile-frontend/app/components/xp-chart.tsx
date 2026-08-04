import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

export function XpChart({
  series,
}: {
  series: { date: string; current: number; target: number }[];
}) {
  const t = useTokens();
  if (!series?.length) return null;

  const max = Math.max(...series.map((s) => Math.max(s.current, s.target)), 1);
  const H = 84;

  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: t.border,
        padding: 16,
        borderCurve: "continuous",
        gap: 12,
      }}
    >
      <Text
        style={{
          color: t.faint,
          fontFamily: font.bodySemi,
          fontSize: 11,
          letterSpacing: 1.1,
        }}
      >
        7-DAY XP
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        {series.map((s, i) => {
          const h = Math.max(4, (s.current / max) * H);
          const targetH = Math.max(4, (s.target / max) * H);
          const hit = s.current >= s.target;
          const today = i === series.length - 1;
          return (
            <View key={s.date} style={{ flex: 1, alignItems: "center" }}>
              <View style={{ width: "100%", height: H, justifyContent: "flex-end" }}>
                <View
                  style={{
                    position: "absolute",
                    bottom: targetH,
                    left: -2,
                    right: -2,
                    height: 1,
                    backgroundColor: rgba(t.text, 0.18),
                  }}
                />
                <LinearGradient
                  colors={
                    hit
                      ? [t.accent2, t.accent]
                      : [rgba(t.accent, 0.55), rgba(t.accent, 0.28)]
                  }
                  style={{
                    width: "100%",
                    height: h,
                    borderRadius: 7,
                    borderCurve: "continuous",
                  }}
                />
              </View>
              <Text
                style={{
                  color: today ? t.accent : t.faint,
                  fontFamily: today ? font.monoBold : font.mono,
                  fontSize: 9,
                  marginTop: 6,
                }}
              >
                {s.date.slice(5)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
