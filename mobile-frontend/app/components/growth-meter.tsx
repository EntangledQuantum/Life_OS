import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { font, rgba, type Tokens } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import type { GrowthStyle } from "@/lib/types";

/**
 * The signature visual: today's progress as something alive, big enough to be
 * the first thing you see.
 *
 * Contract (CLIENT_GUIDE §3.6): the 100% state is always drawn ghosted *behind*
 * the live state, so the gap between where you are and what a full day looks
 * like is visible at a glance. A bare progress bar does not satisfy this.
 *
 * Leaf thresholds match the web client exactly.
 */
const LEAF_THRESHOLDS = [0.16, 0.32, 0.46, 0.62, 0.78, 0.9] as const;

const SPRING = { damping: 16, stiffness: 70, mass: 0.9 };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type CelebrationIntensity = "full" | "minimal" | "off";

export function GrowthMeter({
  efficiencyPct,
  style = "sprout",
  size = 240,
  reducedMotion = false,
  celebrationIntensity = "full",
  showReadout = true,
}: {
  efficiencyPct: number;
  style?: GrowthStyle;
  size?: number;
  reducedMotion?: boolean;
  celebrationIntensity?: CelebrationIntensity;
  /**
   * Off when the meter is a sample rather than your day — a picker tile is
   * already labelled, and "62% of today" on something that is not today reads
   * as a real number.
   */
  showReadout?: boolean;
}) {
  const t = useTokens();
  const pct = Math.min(100, Math.max(0, efficiencyPct));
  const full = pct >= 100;

  return (
    <View style={{ width: size, height: size }}>
      <Halo
        size={size}
        t={t}
        full={full}
        reduce={reducedMotion}
        intensity={celebrationIntensity}
      />
      {style === "orb" ? (
        <Orb pct={pct} full={full} size={size} t={t} reduce={reducedMotion} />
      ) : (
        <Sprout pct={pct} full={full} size={size} t={t} reduce={reducedMotion} />
      )}
      {showReadout ? (
        <Readout pct={pct} full={full} size={size} t={t} style={style} />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ halo */

/**
 * The glow. Sits behind everything and breathes; goes loud only when the day's
 * target is actually met — and only if the user wants celebrations.
 */
function Halo({
  size,
  t,
  full,
  reduce,
  intensity,
}: {
  size: number;
  t: Tokens;
  full: boolean;
  reduce: boolean;
  intensity: CelebrationIntensity;
}) {
  const loud = full && intensity !== "off";
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      pulse.value = withTiming(loud ? 1 : 0.35, { duration: 200 });
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [pulse, reduce, loud]);

  const base = loud ? (intensity === "minimal" ? 0.5 : 0.85) : 0.34;
  const swing = loud ? 0.3 : 0.12;

  const anim = useAnimatedStyle(() => ({
    opacity: base + pulse.value * swing,
    transform: [{ scale: 0.96 + pulse.value * (loud ? 0.09 : 0.04) }],
  }));

  const glowSize = size * 1.55;
  const offset = (size - glowSize) / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left: offset, top: offset },
        anim,
      ]}
    >
      <Svg width={glowSize} height={glowSize}>
        <Defs>
          <RadialGradient id="gm-halo" cx="50%" cy="50%" r="50%">
            <Stop offset="35%" stopColor={t.accent} stopOpacity="0.34" />
            <Stop offset="68%" stopColor={t.accent2} stopOpacity="0.14" />
            <Stop offset="100%" stopColor={t.accent2} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle
          cx={glowSize / 2}
          cy={glowSize / 2}
          r={glowSize / 2}
          fill="url(#gm-halo)"
        />
      </Svg>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------- orb */

/**
 * Water motion is built from plain RN views rather than animated SVG
 * transforms: the crests are a tiled sine that scrolls by exactly one period,
 * so it loops seamlessly and runs entirely on the UI thread. The web version
 * springs a per-frame phase value, which is what makes its surface look like
 * it is dragging.
 */
function Orb({
  pct,
  full,
  size,
  t,
  reduce,
}: {
  pct: number;
  full: boolean;
  size: number;
  t: Tokens;
  reduce: boolean;
}) {
  const inner = size * 0.9; // leaves room for the rim glow
  // Each crest scrolls by exactly its OWN period, so both loops are seamless.
  const periodA = inner / 2;
  const periodB = inner / 3;
  const waveWidth = inner + periodA;
  const ampA = 7;
  const ampB = 5;

  const level = useSharedValue(0);
  const driftA = useSharedValue(0);
  const driftB = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    level.value = reduce
      ? withTiming(pct / 100, { duration: 220 })
      : withSpring(pct / 100, SPRING);
  }, [pct, level, reduce]);

  useEffect(() => {
    if (reduce) {
      driftA.value = 0;
      driftB.value = 0;
      bob.value = 0;
      return;
    }
    // One full period per cycle → the seam never shows.
    driftA.value = withRepeat(
      withTiming(-periodA, { duration: 3400, easing: Easing.linear }),
      -1,
      false,
    );
    driftB.value = withRepeat(
      withTiming(periodB, { duration: 5200, easing: Easing.linear }),
      -1,
      false,
    );
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [driftA, driftB, bob, periodA, periodB, reduce]);

  // Slide a full-height body down out of the clip rather than animating its
  // height: a transform stays on the UI thread, and the crests ride the
  // surface for free because they are children of it.
  const water = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - Math.max(0, level.value)) * inner }],
  }));
  // Both crests live in [-period, 0] so the sphere is always fully covered.
  const waveA = useAnimatedStyle(() => ({
    transform: [
      { translateX: driftA.value },
      { translateY: (bob.value - 0.5) * 3 },
    ],
  }));
  const waveB = useAnimatedStyle(() => ({
    transform: [
      { translateX: driftB.value - periodB },
      { translateY: (0.5 - bob.value) * 3 },
    ],
  }));

  const crestA = useMemo(
    () => wavePath(waveWidth, periodA, ampA),
    [waveWidth, periodA],
  );
  const crestB = useMemo(
    () => wavePath(waveWidth, periodB, ampB),
    [waveWidth, periodB],
  );

  const pad = (size - inner) / 2;

  return (
    <View style={{ position: "absolute", left: pad, top: pad }}>
      {/* ghost: the whole sphere is what 100% looks like */}
      <View
        style={{
          position: "absolute",
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: rgba(t.accent, 0.05),
          borderWidth: 1,
          borderColor: rgba(t.accent, full ? 0.55 : 0.16),
        }}
      />

      {/* liquid, clipped to the sphere */}
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={[
            { position: "absolute", left: 0, right: 0, top: 0, height: inner },
            water,
          ]}
        >
          <LinearGradient
            colors={[t.accent2, t.accent]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={{ flex: 1 }}
          />

          {/* back crest — darker, slower, drifts the other way */}
          <Animated.View
            style={[
              {
                position: "absolute",
                top: -ampB,
                left: 0,
                width: waveWidth,
                height: ampB * 2 + 1,
              },
              waveB,
            ]}
          >
            <Svg width={waveWidth} height={ampB * 2 + 1}>
              <Path d={crestB} fill={t.accent} opacity={0.75} />
            </Svg>
          </Animated.View>

          {/* front crest — carries the specular line */}
          <Animated.View
            style={[
              {
                position: "absolute",
                top: -ampA,
                left: 0,
                width: waveWidth,
                height: ampA * 2 + 1,
              },
              waveA,
            ]}
          >
            <Svg width={waveWidth} height={ampA * 2 + 1}>
              <Path d={crestA} fill={t.accent2} />
              <Path
                d={crestA}
                fill="none"
                stroke="rgba(255,255,255,0.45)"
                strokeWidth={1.5}
              />
            </Svg>
          </Animated.View>

          {pct > 8 && !reduce ? (
            <Bubbles width={inner} height={inner} />
          ) : null}
        </Animated.View>

        {/* specular highlight on the glass, above the liquid */}
        <Svg
          width={inner}
          height={inner}
          style={{ position: "absolute", left: 0, top: 0 }}
          pointerEvents="none"
        >
          <Ellipse
            cx={inner * 0.32}
            cy={inner * 0.26}
            rx={inner * 0.13}
            ry={inner * 0.2}
            fill="rgba(255,255,255,0.10)"
            transform={`rotate(-25 ${inner * 0.32} ${inner * 0.26})`}
          />
        </Svg>
      </View>

      {/* rim last, so it reads as glass in front of the water */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          borderWidth: 2,
          borderColor: full ? t.accent : rgba(t.accent, 0.4),
        }}
      />
    </View>
  );
}

/** Three bubbles on staggered loops. Purely decorative; skipped when reduced. */
function Bubbles({ width, height }: { width: number; height: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Bubble
          key={i}
          index={i}
          x={width * (0.28 + i * 0.2)}
          rise={height * 0.75}
          size={4 + (i % 2) * 2}
        />
      ))}
    </>
  );
}

function Bubble({
  index,
  x,
  rise,
  size,
}: {
  index: number;
  x: number;
  rise: number;
  size: number;
}) {
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withDelay(
      index * 900,
      withRepeat(
        withTiming(1, { duration: 4200 + index * 700, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, [p, index]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: -p.value * rise }],
    opacity: p.value < 0.1 ? p.value * 10 : p.value > 0.8 ? (1 - p.value) * 5 : 1,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: x,
          bottom: 6,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: "rgba(255,255,255,0.4)",
        },
        anim,
      ]}
    />
  );
}

/**
 * Tiled sine, filled down to the bottom of its box. The mean line sits at `amp`
 * so the box can be offset by exactly `-amp` and meet the water without a seam.
 */
function wavePath(width: number, period: number, amp: number): string {
  const half = period / 2;
  const mid = amp;
  let d = `M0 ${mid}`;
  let x = 0;
  let up = true;
  while (x < width) {
    const cy = up ? mid - amp * 2 : mid + amp * 2;
    d += ` Q${x + half / 2} ${cy} ${x + half} ${mid}`;
    x += half;
    up = !up;
  }
  return `${d} L${x} ${amp * 2 + 2} L0 ${amp * 2 + 2} Z`;
}

/* ---------------------------------------------------------------- sprout */

const VB = 200; // sprout viewBox
const STEM = "M100 168 C100 140 88 116 100 92 C112 68 100 46 100 26";
const STEM_LEN = 150; // measured along the curve, close enough for a dash mask

const LEAVES = [
  { x: 97, y: 140, side: -1, size: 1.0 },
  { x: 95, y: 118, side: 1, size: 1.15 },
  { x: 97, y: 100, side: -1, size: 1.2 },
  { x: 106, y: 76, side: 1, size: 1.1 },
  { x: 103, y: 58, side: -1, size: 0.95 },
  { x: 100, y: 44, side: 1, size: 0.85 },
] as const;

function Sprout({
  pct,
  full,
  size,
  t,
  reduce,
}: {
  pct: number;
  full: boolean;
  size: number;
  t: Tokens;
  reduce: boolean;
}) {
  const grow = useSharedValue(0);
  const sway = useSharedValue(0);

  useEffect(() => {
    grow.value = reduce
      ? withTiming(pct / 100, { duration: 220 })
      : withSpring(pct / 100, SPRING);
  }, [pct, grow, reduce]);

  useEffect(() => {
    if (reduce) {
      sway.value = 0;
      return;
    }
    sway.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        withTiming(-1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [sway, reduce]);

  const stemProps = useAnimatedProps(() => ({
    strokeDashoffset: STEM_LEN * (1 - Math.max(0.02, grow.value)),
  }));

  const bloomProps = useAnimatedProps(() => {
    const b = Math.max(0, (grow.value - 0.9) / 0.1);
    return { r: 15 * Math.min(1, b), opacity: Math.min(1, b) };
  });

  const swayStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sway.value * 1.4}deg` }],
  }));

  return (
    <Animated.View
      style={[
        { position: "absolute", left: 0, top: 0, width: size, height: size },
        swayStyle,
      ]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
        {/* ---- ghost: exactly what 100% looks like, always behind ---- */}
        <G opacity={full ? 0 : 0.14}>
          <Path
            d={STEM}
            fill="none"
            stroke={t.text}
            strokeWidth={6}
            strokeLinecap="round"
          />
          {LEAVES.map((leaf, i) => (
            <Path key={`ghost-${i}`} d={leafPath(leaf, 1)} fill={t.text} />
          ))}
          <Circle cx={100} cy={26} r={15} fill={t.text} />
        </G>

        {/* dashed silhouette so the remaining distance reads as a target */}
        {!full ? (
          <Path
            d={STEM}
            fill="none"
            stroke={rgba(t.accent, 0.28)}
            strokeWidth={1}
            strokeDasharray="2 7"
          />
        ) : null}

        {/* ---- the living plant ---- */}
        <AnimatedPath
          d={STEM}
          fill="none"
          stroke={t.accent}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={STEM_LEN}
          animatedProps={stemProps}
        />

        {LEAVES.map((leaf, i) => (
          <Leaf
            key={i}
            leaf={leaf}
            index={i}
            grow={grow}
            color={i % 2 === 0 ? t.accent : t.accent2}
          />
        ))}

        <AnimatedCircle cx={100} cy={26} fill={t.accent2} animatedProps={bloomProps} />
        {full ? <Circle cx={100} cy={26} r={5} fill={t.text} /> : null}

        {/* pot */}
        <Path
          d="M66 166 L73 196 Q100 204 127 196 L134 166 Z"
          fill={rgba(t.text, 0.07)}
          stroke={rgba(t.text, 0.1)}
        />
        <Ellipse cx={100} cy={166} rx={34} ry={7} fill={rgba(t.text, 0.11)} />
        <Ellipse cx={100} cy={165} rx={25} ry={4.5} fill={t.bg} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Each leaf unfurls by interpolating its own geometry, so it grows out of the
 * stem rather than fading in on top of it.
 */
function Leaf({
  leaf,
  index,
  grow,
  color,
}: {
  leaf: (typeof LEAVES)[number];
  index: number;
  grow: SharedValue<number>;
  color: string;
}) {
  const threshold = LEAF_THRESHOLDS[index];

  const props = useAnimatedProps(() => {
    "worklet";
    // Unfurl across the 0.09 of progress that follows the threshold.
    const raw = (grow.value - threshold) / 0.09;
    const s = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return { d: leafPath(leaf, s), opacity: s };
  });

  return <AnimatedPath animatedProps={props} fill={color} />;
}

/** `s` 0 → nothing, 1 → full leaf. Pure maths so it can run in a worklet. */
function leafPath(leaf: (typeof LEAVES)[number], s: number): string {
  "worklet";
  const w = 20 * leaf.size * s;
  const h = 9 * leaf.size * s;
  const { x, y, side } = leaf;
  const tip = x + side * w;
  return (
    `M${x} ${y}` +
    ` C${x + side * w * 0.4} ${y - h} ${tip - side * w * 0.15} ${y - h * 0.6} ${tip} ${y - h * 0.2}` +
    ` C${tip - side * w * 0.2} ${y + h * 0.5} ${x + side * w * 0.4} ${y + h * 0.5} ${x} ${y} Z`
  );
}

/* -------------------------------------------------------------- readout */

/** The number lives inside the visual — it is the point of the visual. */
function Readout({
  pct,
  full,
  size,
  t,
  style,
}: {
  pct: number;
  full: boolean;
  size: number;
  t: Tokens;
  style: GrowthStyle;
}) {
  const orb = style === "orb";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: orb ? 0 : size * 0.62,
        height: orb ? size : size * 0.3,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: font.monoBold,
          fontSize: orb ? size * 0.27 : size * 0.2,
          lineHeight: orb ? size * 0.31 : size * 0.23,
          color: t.text,
          fontVariant: ["tabular-nums"],
          textShadowColor: rgba(t.accent, 0.6),
          textShadowRadius: 18,
        }}
      >
        {Math.round(pct)}
        <Text style={{ fontSize: orb ? size * 0.11 : size * 0.09, color: t.muted }}>
          %
        </Text>
      </Text>
      <Text
        style={{
          fontFamily: font.bodySemi,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: full ? t.accent : t.faint,
          marginTop: 2,
        }}
      >
        {full ? "target met" : "of today"}
      </Text>
    </View>
  );
}
