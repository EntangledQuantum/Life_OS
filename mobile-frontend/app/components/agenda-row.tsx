import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import type { AgendaItem } from "@/lib/types";

/**
 * One row of today, whatever table it came from.
 *
 * Habits and scheduled tasks used to render as two separate lists on this
 * screen, which is what made it reasonable for an agent to create one of each
 * for the same act — and gave two things to tick, paying out twice if both were
 * ticked. `source` decides where the tick lands; nothing else here cares which
 * kind it is.
 */
export function AgendaRow({
  item,
  busy,
  onComplete,
  onUndo,
}: {
  item: AgendaItem;
  busy: boolean;
  onComplete: (item: AgendaItem) => void;
  onUndo: (item: AgendaItem) => void;
}) {
  const t = useTokens();

  /*
   * 24-hour, always. The locale default gives "07:30 AM", which is wider than
   * the fixed column and disagrees with the ribbon's 00/06/12/18/24 labels
   * directly above it.
   */
  const time = item.at
    ? new Date(item.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : "—";

  const isHabit = item.source === "habit";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor:
          item.done
            ? "transparent"
            : item.state === "now"
              ? rgba(t.accent, 0.4)
              : t.border,
        backgroundColor: item.done
          ? rgba(t.text, 0.02)
          : item.state === "now"
            ? rgba(t.accent, 0.07)
            : "transparent",
      }}
    >
      <Text
        style={{
          width: 42,
          fontFamily: font.mono,
          fontSize: 11,
          color: item.state === "overdue" && !item.done ? t.warning : t.faint,
        }}
      >
        {item.at ? time : ""}
      </Text>

      {/*
        A habit is marked, because the two behave differently and the difference
        matters when you look at the row: a habit comes back tomorrow and can be
        un-ticked, a task is a one-off and cannot. A bar rather than a label —
        quieter, and it survives being glanced at.
      */}
      <View
        style={{
          width: 3,
          height: 26,
          borderRadius: 2,
          backgroundColor: item.themeColor || t.accent,
          opacity: isHabit ? 0.7 : 0,
        }}
      />

      {/*
        A habit with its own icon shows it here instead of the emoji. Only the
        icon — a row is not a card.
      */}
      {item.iconImage ? (
        <Image
          source={{ uri: item.iconImage }}
          style={{ width: 22, height: 22, borderRadius: 6 }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : item.emoji ? (
        <Text style={{ fontSize: 16 }}>{item.emoji}</Text>
      ) : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 14,
            color: item.done ? t.faint : t.text,
            textDecorationLine: item.done ? "line-through" : "none",
          }}
        >
          {item.title}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
          {isHabit ? (
            <Text style={{ fontSize: 10, color: t.faint }}>
              habit{(item.streak ?? 0) > 0 ? ` · ${item.streak}d` : ""}
            </Text>
          ) : null}
          {/*
            The kind is a tag, not a tab. A study block is a task with links on
            it — the Study screen said otherwise and kept its own copy of this
            same list.
          */}
          {item.kind && item.kind !== "task" ? (
            <Text style={{ fontSize: 10, color: t.faint, textTransform: "capitalize" }}>
              {item.kind}
            </Text>
          ) : null}
          {item.state === "overdue" && !item.done ? (
            <Text style={{ fontSize: 10, color: t.warning }}>missed its slot</Text>
          ) : null}
          {item.xp > 0 ? (
            <Text style={{ fontSize: 10, color: t.faint, fontFamily: font.mono }}>
              {item.xp} XP
            </Text>
          ) : null}
        </View>
      </View>

      <Pressable
        disabled={busy || (item.done && !isHabit)}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (item.done) onUndo(item);
          else onComplete(item);
        }}
        hitSlop={8}
        style={{
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          borderWidth: item.done ? 0 : 1,
          borderColor: t.border,
          opacity: item.done && !isHabit ? 0.35 : 1,
        }}
        accessibilityRole="button"
        accessibilityLabel={item.done ? `Undo ${item.title}` : `Mark ${item.title} done`}
      >
        <Text style={{ color: item.done ? t.faint : t.muted, fontSize: 15 }}>
          {item.done ? "↺" : "✓"}
        </Text>
      </Pressable>
    </View>
  );
}
