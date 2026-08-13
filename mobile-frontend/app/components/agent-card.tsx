import { useMemo, useRef, useState } from "react";
import { Linking, PanResponder, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DashboardCard } from "@/lib/types";
import { api } from "@/lib/api";
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

        {card.control ? <CardControl card={card} tint={tint} /> : null}

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

/**
 * The agent's own widget on a card.
 *
 * Not a completion: an agent asking "how did that feel, 1–10" wants the answer,
 * not the card gone. The slider commits on release (`onSlidingComplete`) rather
 * than on every frame — a drag from 1 to 9 would otherwise be dozens of POSTs
 * and, if the agent subscribed, dozens of webhooks.
 */
function CardControl({ card, tint }: { card: DashboardCard; tint: string }) {
  const t = useTokens();
  const qc = useQueryClient();
  const control = card.control!;
  const [draft, setDraft] = useState(
    control.kind === "slider" ? control.value : 0,
  );

  const interact = useMutation({
    mutationFn: (body: { value?: number; pressed?: boolean }) =>
      api.interactWithCard(card.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  if (control.kind === "button") {
    const pressed = Boolean(control.pressedAt);
    return (
      <Pressable
        disabled={pressed || interact.isPending}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          interact.mutate({ pressed: true });
        }}
        style={({ pressed: down }) => ({
          backgroundColor: rgba(tint, pressed ? 0.08 : down ? 0.3 : 0.18),
          borderWidth: 1,
          borderColor: rgba(tint, pressed ? 0.2 : 0.45),
          borderRadius: radius.sm,
          paddingVertical: 11,
          alignItems: "center",
          borderCurve: "continuous",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: tint, fontFamily: font.bodySemi, fontSize: 14 }}>
          {control.label}
          {pressed ? " ✓" : ""}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.muted, fontFamily: font.body, fontSize: 12 }}>
          {control.label}
        </Text>
        <Text
          style={{
            color: t.text,
            fontFamily: font.monoBold,
            fontSize: 14,
            fontVariant: ["tabular-nums"],
          }}
        >
          {draft}
          {control.unit ? ` ${control.unit}` : ""}
        </Text>
      </View>
      <Slider
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={draft}
        tint={tint}
        onChange={setDraft}
        onCommit={(v) => interact.mutate({ value: v })}
      />
    </View>
  );
}

/**
 * A slider built from a PanResponder rather than a native module.
 *
 * `@react-native-community/slider` would mean a new native dependency and
 * therefore a full rebuild before this widget worked at all. This is JS only,
 * so it ships with the next JS bundle — and the app already hand-rolls its
 * gestures (`swipe-tabs.tsx`), so it is the same shape as everything else here.
 */
function Slider({
  min,
  max,
  step,
  value,
  tint,
  onChange,
  onCommit,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  tint: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const t = useTokens();
  const [width, setWidth] = useState(0);
  // The responder closes over these, so a ref keeps it reading live values
  // instead of whatever they were when the responder was created.
  const live = useRef({ width, value });
  live.current = { width, value };

  const THUMB = 22;

  const valueAt = (x: number): number => {
    const w = live.current.width - THUMB;
    if (w <= 0) return min;
    const ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / w));
    const raw = min + ratio * (max - min);
    const snapped = min + Math.round((raw - min) / step) * step;
    const decimals = (String(step).split(".")[1] ?? "").length;
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Claim the gesture outright: this sits inside a horizontally
        // swipeable screen, and a drag on the track must move the thumb
        // rather than change tab.
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e) => onChange(valueAt(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChange(valueAt(e.nativeEvent.locationX)),
        onPanResponderRelease: (e) => onCommit(valueAt(e.nativeEvent.locationX)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step],
  );

  const pct = max > min ? (value - min) / (max - min) : 0;

  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: THUMB + 12, justifyContent: "center" }}
    >
      <View
        style={{
          height: 5,
          borderRadius: 3,
          backgroundColor: rgba(t.text, 0.13),
          overflow: "hidden",
        }}
      >
        <View
          style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: tint }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: Math.max(0, pct * (width - THUMB)),
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: tint,
          borderWidth: 2,
          borderColor: t.bg,
        }}
      />
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
