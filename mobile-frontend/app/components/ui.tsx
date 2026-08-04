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
import { colors } from "@/lib/theme";

export function Screen({ style, ...rest }: ViewProps) {
  return (
    <View
      style={[{ flex: 1, backgroundColor: colors.background }, style]}
      {...rest}
    />
  );
}

export function Card({ style, ...rest }: ViewProps) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
          borderCurve: "continuous",
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Title({ style, ...rest }: TextProps) {
  return (
    <Text
      style={[
        {
          color: colors.text,
          fontFamily: "Figtree_700Bold",
          fontSize: 22,
          letterSpacing: -0.3,
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Body({ style, ...rest }: TextProps) {
  return (
    <Text
      style={[
        {
          color: colors.muted,
          fontFamily: "Figtree_400Regular",
          fontSize: 14,
          lineHeight: 20,
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Label({ style, ...rest }: TextProps) {
  return (
    <Text
      style={[
        {
          color: colors.faint,
          fontFamily: "Figtree_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.8,
          textTransform: "uppercase",
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Mono({ style, ...rest }: TextProps) {
  return (
    <Text
      style={[
        {
          color: colors.text,
          fontFamily: "JetBrainsMono_500Medium",
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
  accent = colors.text,
  disabled,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  title: string;
  variant?: "primary" | "ghost" | "soft";
  accent?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === "primary"
      ? accent
      : variant === "soft"
        ? "rgba(255,255,255,0.06)"
        : "transparent";
  const fg = variant === "primary" ? colors.background : colors.text;

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 12,
          borderCurve: "continuous",
          alignItems: "center",
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
      {...rest}
    >
      <Text
        style={{
          color: fg,
          fontFamily: "Figtree_600SemiBold",
          fontSize: 15,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  color = colors.muted,
  bg = "rgba(255,255,255,0.06)",
}: {
  label: string;
  color?: string;
  bg?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderCurve: "continuous",
      }}
    >
      <Text
        style={{
          color,
          fontFamily: "Figtree_600SemiBold",
          fontSize: 11,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.muted} />
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
        marginBottom: 10,
        marginTop: 4,
      }}
    >
      <Label>{title}</Label>
      {right}
    </View>
  );
}
