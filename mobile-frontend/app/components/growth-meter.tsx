import { View, Text } from "react-native";
import Svg, { Circle, Path, G } from "react-native-svg";
import { colors, accentColor } from "@/lib/theme";
import type { AccentThemeId, GrowthStyle } from "@/lib/types";

const LEAF_THRESHOLDS = [0.16, 0.32, 0.46, 0.62, 0.78, 0.90];

/**
 * Growth meter with ghosted 100% state behind the live state.
 * Contract: never a plain bar alone — the full-day target must stay visible.
 */
export function GrowthMeter({
  efficiencyPct,
  style = "sprout",
  dailyXp = 0,
  dailyXpTarget = 200,
  theme = "nebula",
  reducedMotion = false,
}: {
  efficiencyPct: number;
  style?: GrowthStyle;
  dailyXp?: number;
  dailyXpTarget?: number;
  theme?: AccentThemeId;
  reducedMotion?: boolean;
}) {
  void reducedMotion;
  const pct = Math.max(0, efficiencyPct);
  const fill = Math.min(100, pct);
  const full = fill >= 100;
  const accent = accentColor(theme);
  const remainder = Math.max(0, dailyXpTarget - dailyXp);

  return (
    <View style={{ alignItems: "center", gap: 12 }}>
      {style === "orb" ? (
        <Orb pct={fill} full={full} accent={accent} />
      ) : (
        <Sprout pct={fill / 100} full={full} accent={accent} />
      )}

      <View style={{ width: "100%", maxWidth: 280, gap: 6 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <Text
            style={{
              fontFamily: "JetBrainsMono_600SemiBold",
              fontSize: 28,
              color: colors.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {Math.round(pct)}
            <Text style={{ fontSize: 14, color: colors.faint }}>%</Text>
          </Text>
          <Text
            style={{
              fontFamily: "JetBrainsMono_500Medium",
              fontSize: 12,
              color: full ? accent : colors.muted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {dailyXp}/{dailyXpTarget} XP
          </Text>
        </View>
        <Text
          style={{
            fontFamily: "Figtree_400Regular",
            fontSize: 12,
            color: colors.faint,
          }}
        >
          {full
            ? "Daily target met — bonus XP still counts"
            : `${remainder} XP to go`}
        </Text>
      </View>
    </View>
  );
}

function Orb({
  pct,
  full,
  accent,
}: {
  pct: number;
  full: boolean;
  accent: string;
}) {
  const size = 140;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ghost = c; // full ring
  const live = c * (1 - pct / 100);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Ghost full ring */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${ghost} ${ghost}`}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
        {/* Live arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={accent}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={live}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
          opacity={full ? 1 : 0.95}
        />
      </Svg>
      <View
        style={{
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontFamily: "JetBrainsMono_600SemiBold",
            fontSize: 22,
            color: accent,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Math.round(pct)}
        </Text>
      </View>
    </View>
  );
}

function Sprout({
  pct,
  full,
  accent,
}: {
  pct: number;
  full: boolean;
  accent: string;
}) {
  const size = 140;
  const leaves = LEAF_THRESHOLDS.filter((t) => pct >= t).length;

  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* Ghost full plant */}
        <G opacity={0.18}>
          <Path
            d="M50 88 L50 40"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {LEAF_THRESHOLDS.map((_, i) => (
            <Path
              key={`g-${i}`}
              d={leafPath(i)}
              fill={accent}
              opacity={0.9}
            />
          ))}
          <Circle cx={50} cy={32} r={8} fill={accent} />
        </G>
        {/* Live plant */}
        <G>
          <Path
            d="M50 88 L50 40"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
            opacity={pct > 0.05 ? 1 : 0.3}
          />
          {LEAF_THRESHOLDS.map((t, i) =>
            pct >= t ? (
              <Path key={`l-${i}`} d={leafPath(i)} fill={accent} />
            ) : null,
          )}
          {full ? (
            <Circle cx={50} cy={32} r={10} fill={accent} opacity={0.95} />
          ) : leaves >= 4 ? (
            <Circle cx={50} cy={36} r={5} fill={accent} opacity={0.7} />
          ) : null}
        </G>
      </Svg>
    </View>
  );
}

function leafPath(i: number): string {
  const y = 78 - i * 8;
  const side = i % 2 === 0 ? -1 : 1;
  const x = 50 + side * 4;
  const tip = 50 + side * 22;
  return `M${x} ${y} Q${tip} ${y - 6} ${x + side * 2} ${y - 14} Q${50 + side * 8} ${y - 4} ${x} ${y}`;
}
