import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type TextProps,
  type ViewProps,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";

export function Screen({ style, ...rest }: ViewProps) {
  const t = useTokens();
  return <View style={[{ flex: 1, backgroundColor: t.bg }, style]} {...rest} />;
}

/**
 * The content column. Centres itself and stops growing at `maxContent` — a
 * single column of habit rows stretched across an iPad is unreadable, and line
 * length is the thing being capped.
 *
 * Goes *inside* each screen's ScrollView, so the scrollbar and the refresh
 * control still belong to the whole window.
 */
export function PageBody({
  children,
  gap = 24,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { maxContent } = useLayout();
  return (
    <View
      style={[{ width: "100%", maxWidth: maxContent, alignSelf: "center", gap }, style]}
    >
      {children}
    </View>
  );
}

/**
 * Two columns when there is room, one when there is not.
 *
 * Below `expanded` the two halves are emitted straight into the parent, so they
 * inherit its `gap` and read as one list — no wrapper, no double spacing.
 */
export function TwoPane({
  left,
  right,
  gap = 24,
  leftFlex = 1,
  rightFlex = 1,
}: {
  left: ReactNode;
  right: ReactNode;
  gap?: number;
  leftFlex?: number;
  rightFlex?: number;
}) {
  const { twoPane } = useLayout();

  if (!twoPane) {
    return (
      <>
        {left}
        {right}
      </>
    );
  }

  return (
    <View style={{ flexDirection: "row", gap: gap + 8, alignItems: "flex-start" }}>
      {/* `minWidth: 0` — flex children default to their content width, which
          would let a long card title push the column wider than its share. */}
      <View style={{ flex: leftFlex, minWidth: 0, gap }}>{left}</View>
      <View style={{ flex: rightFlex, minWidth: 0, gap }}>{right}</View>
    </View>
  );
}

export function Card({
  style,
  glow,
  ...rest
}: ViewProps & { glow?: boolean }) {
  const t = useTokens();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: glow ? t.borderLift : t.border,
          padding: 16,
          borderCurve: "continuous",
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Title({ style, ...rest }: TextProps) {
  const t = useTokens();
  return (
    <Text
      style={[
        { color: t.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.4 },
        style,
      ]}
      {...rest}
    />
  );
}

export function Body({ style, ...rest }: TextProps) {
  const t = useTokens();
  return (
    <Text
      style={[
        { color: t.muted, fontFamily: font.body, fontSize: 14, lineHeight: 21 },
        style,
      ]}
      {...rest}
    />
  );
}

export function Label({ style, ...rest }: TextProps) {
  const t = useTokens();
  return (
    <Text
      style={[
        {
          color: t.faint,
          fontFamily: font.bodySemi,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: "uppercase",
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Mono({ style, ...rest }: TextProps) {
  const t = useTokens();
  return (
    <Text
      style={[
        {
          color: t.text,
          fontFamily: font.mono,
          fontVariant: ["tabular-nums"],
          fontSize: 14,
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Button({
  title,
  variant = "primary",
  tone,
  disabled,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  title: string;
  variant?: "primary" | "ghost" | "soft";
  /** Overrides the accent for this one button. */
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const accent = tone ?? t.accent;
  const bg =
    variant === "primary"
      ? accent
      : variant === "soft"
        ? rgba(accent, 0.14)
        : "transparent";
  const fg =
    variant === "primary" ? t.onAccent : variant === "soft" ? accent : t.text;

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          paddingVertical: 13,
          paddingHorizontal: 18,
          borderRadius: radius.md,
          borderCurve: "continuous",
          alignItems: "center",
          opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: t.border,
        },
        style,
      ]}
      {...rest}
    >
      <Text style={{ color: fg, fontFamily: font.bodySemi, fontSize: 15 }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  color,
  bg,
  dot,
}: {
  label: string;
  color?: string;
  bg?: string;
  /** Small leading dot in `color` — reads faster than text alone. */
  dot?: boolean;
}) {
  const t = useTokens();
  const fg = color ?? t.muted;
  return (
    <View
      style={{
        backgroundColor: bg ?? rgba(fg, 0.12),
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        borderCurve: "continuous",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {dot ? (
        <View
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }}
        />
      ) : null}
      <Text style={{ color: fg, fontFamily: font.bodySemi, fontSize: 11 }}>
        {label}
      </Text>
    </View>
  );
}

export function Loading() {
  const t = useTokens();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

export function SectionHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <Label>{title}</Label>
      {right}
    </View>
  );
}

/** Hairline divider — used instead of another card border where possible. */
export function Divider() {
  const t = useTokens();
  return <View style={{ height: 1, backgroundColor: t.border }} />;
}
