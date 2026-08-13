import { Linking, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { Task } from "@/lib/types";
import { activityColor, font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { formatClock, formatRelative } from "@/lib/format";

/**
 * One task. Complete is the only action — nothing here starts, and completing
 * it never changes what activity you are in. That is set by hand from the
 * Right-now picker and nowhere else.
 *
 * `expanded` draws the agent's long-form body and its attached links. The Quick
 * log wants the compact form; Timeline and Study want the whole thing.
 */
export function TaskRow({
  task,
  urgent,
  expanded,
  onComplete,
  onDismiss,
}: {
  task: Task;
  urgent?: boolean;
  expanded?: boolean;
  onComplete?: () => void;
  onDismiss?: () => void;
}) {
  const t = useTokens();
  const when = task.eventAt ?? task.remindAt;
  const tint = task.themeColor || activityColor(task.activityTag, t.accent);
  const showDetail = Boolean(expanded && (task.body || task.resources.length > 0));

  return (
    <View
      style={{
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: urgent ? rgba(t.accent, 0.45) : t.border,
        borderCurve: "continuous",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {/* activity colour as a full-height bar, not a left glow */}
        <View
          style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: tint }}
        />

        <Text style={{ fontSize: 20 }}>{task.emoji || "📌"}</Text>

        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 15 }}
            numberOfLines={expanded ? 2 : 1}
          >
            {task.title}
          </Text>
          {task.subtitle ? (
            <Text
              style={{ color: t.muted, fontFamily: font.body, fontSize: 12 }}
              numberOfLines={2}
            >
              {task.subtitle}
            </Text>
          ) : null}
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}
          >
            {when ? (
              <Text
                style={{
                  color: t.muted,
                  fontFamily: font.mono,
                  fontSize: 11,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatClock(when)} · {formatRelative(when)}
              </Text>
            ) : null}
            {task.activityTag ? (
              <Text style={{ color: tint, fontFamily: font.bodyMedium, fontSize: 11 }}>
                {task.activityTag}
              </Text>
            ) : null}
            {task.durationMinutes ? (
              <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
                {task.durationMinutes}m
              </Text>
            ) : null}
            {task.repeatRule && task.repeatRule !== "none" ? (
              <Text style={{ color: t.faint, fontSize: 11 }}>↻ {task.repeatRule}</Text>
            ) : null}
            {task.remindAt ? <Text style={{ fontSize: 10 }}>🔔</Text> : null}
            {task.xpOnComplete > 0 ? (
              <Text style={{ color: t.positive, fontFamily: font.mono, fontSize: 11 }}>
                +{task.xpOnComplete} XP
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {onComplete ? (
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onComplete();
              }}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: rgba(t.positive, 0.4),
                backgroundColor: rgba(t.positive, pressed ? 0.25 : 0.08),
                alignItems: "center",
                justifyContent: "center",
                borderCurve: "continuous",
              })}
            >
              <Text style={{ color: t.positive, fontSize: 15 }}>✓</Text>
            </Pressable>
          ) : null}
          {onDismiss ? (
            <Pressable onPress={onDismiss} hitSlop={8}>
              <Text style={{ color: t.faint, fontSize: 16 }}>✕</Text>
            </Pressable>
          ) : null}
          {task.ctaLink ? (
            <Pressable onPress={() => Linking.openURL(task.ctaLink!)} hitSlop={8}>
              <Text style={{ color: t.muted, fontSize: 14 }}>↗</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/*
        The detail the agent attached. Before tasks, the phone had nowhere to
        show a chapter list or a link — a "study block" was a label and two
        times, and everything the agent actually wanted to hand over was lost.
      */}
      {showDetail ? (
        <View
          style={{
            gap: 8,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: t.border,
          }}
        >
          {task.body ? (
            <Text
              style={{
                color: t.muted,
                fontFamily: font.body,
                fontSize: 13,
                lineHeight: 19,
              }}
            >
              {task.body}
            </Text>
          ) : null}
          {task.resources.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {task.resources.map((r, i) => (
                <Pressable
                  key={`${r.url}-${i}`}
                  onPress={() => Linking.openURL(r.url)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: radius.sm,
                    backgroundColor: rgba(tint, pressed ? 0.22 : 0.1),
                    borderCurve: "continuous",
                  })}
                >
                  <Text style={{ fontSize: 12 }}>{resourceIcon(r.kind)}</Text>
                  <Text
                    style={{ color: t.text, fontFamily: font.bodyMedium, fontSize: 12 }}
                    numberOfLines={1}
                  >
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The agent's `kind` hint is free text, so this is a guess with a fallback. */
function resourceIcon(kind?: string): string {
  const k = (kind ?? "").toLowerCase();
  if (k.includes("video")) return "▶";
  if (k.includes("book") || k.includes("chapter")) return "📕";
  if (k.includes("paper") || k.includes("doc")) return "📄";
  return "🔗";
}
