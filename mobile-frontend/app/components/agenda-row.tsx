import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { ArtBackground, ArtIcon, hasArt } from "@/components/art";
import type { AgendaItem, HabitWithToday } from "@/lib/types";

/**
 * One card of today, whatever table it came from.
 *
 * Habits and scheduled tasks used to render as two separate lists on this
 * screen, which is what made it reasonable for an agent to create one of each
 * for the same act — and gave two things to tick, paying out twice if both were
 * ticked. `source` decides where the tick lands; nothing else here cares which
 * kind it is.
 *
 * It is a card rather than a row because this is the only place a habit is
 * shown. The dashboard used to have a second, larger view of the same habits —
 * their art, their week — which meant the screen you actually look at every day
 * was the poorer of the two. That page is gone and this is what it was.
 *
 * The 3px colour bar went with it. It was doing the job of saying "this is a
 * habit, and this is which part of the day it belongs to" in three pixels,
 * where it read as a divider. The card's own edge carries it now.
 */
export function AgendaRow({
  item,
  habit,
  busy,
  onComplete,
  onUndo,
}: {
  item: AgendaItem;
  /**
   * The full habit row, for the art and the week.
   *
   * Looked up by the screen rather than copied onto every agenda item — the
   * dashboard payload already carries these, and a background picture is a
   * `data:` URI big enough that sending it twice per poll is real bandwidth on
   * a phone.
   */
  habit?: HabitWithToday;
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
    : null;

  const isHabit = item.source === "habit";
  const tint = item.themeColor || t.accent;
  const overdue = item.state === "overdue" && !item.done;
  /* The habit's own art if there is any; otherwise whatever the row resolved. */
  const art = habit ?? {
    iconImageData: item.iconImage,
    iconImageUrl: null,
    backgroundImageData: null,
    backgroundImageUrl: null,
  };

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        /*
          An outline in the activity's colour, and a glow under it while it is
          the current thing. Same information the bar carried, at a size you can
          see without looking for it.
        */
        borderColor: item.done
          ? t.border
          : item.state === "now"
            ? rgba(tint, 0.55)
            : rgba(tint, 0.28),
        backgroundColor: hasArt(habit) ? "transparent" : rgba(t.text, 0.02),
        overflow: "hidden",
        borderCurve: "continuous",
        opacity: item.done ? 0.72 : 1,
        ...(item.state === "now" && !item.done
          ? {
              shadowColor: tint,
              shadowOpacity: 0.35,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }
          : {}),
      }}
    >
      <ArtBackground art={habit} />

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          padding: 13,
        }}
      >
        {/* Big enough to be the picture, not a bullet point. */}
        <ArtIcon art={art} emoji={item.emoji} color={tint} size={46} />

        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 15,
                fontFamily: font.bodySemi,
                color: item.done ? t.faint : t.text,
                textDecorationLine: item.done ? "line-through" : "none",
              }}
            >
              {item.title}
            </Text>
            {time ? (
              <Text
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  color: overdue ? t.warning : t.faint,
                }}
              >
                {time}
              </Text>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {isHabit ? (
              <Text style={{ fontSize: 11, color: t.muted }}>
                {habit?.category ?? "habit"}
                {(item.streak ?? 0) > 0 ? ` · ${item.streak}d streak` : ""}
              </Text>
            ) : item.kind && item.kind !== "task" ? (
              /* The kind is a tag, not a tab — a study block is a task with links. */
              <Text
                style={{ fontSize: 11, color: t.muted, textTransform: "capitalize" }}
              >
                {item.kind}
              </Text>
            ) : null}
            {item.xp > 0 ? (
              <Text style={{ fontSize: 11, color: t.faint, fontFamily: font.mono }}>
                {item.xp} XP
              </Text>
            ) : null}
            {overdue ? (
              <Text style={{ fontSize: 11, color: t.warning }}>missed its slot</Text>
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
            width: 38,
            height: 38,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: item.done ? t.border : rgba(tint, 0.4),
            opacity: item.done && !isHabit ? 0.35 : 1,
            borderCurve: "continuous",
          }}
          accessibilityRole="button"
          accessibilityLabel={
            item.done ? `Undo ${item.title}` : `Mark ${item.title} done`
          }
        >
          <Text style={{ color: item.done ? t.faint : t.muted, fontSize: 16 }}>
            {item.done ? "↺" : "✓"}
          </Text>
        </Pressable>
      </View>

      {/*
        The week, habits only — a task has no week, it happens once. This came
        off the dashboard's Habits page, and it is the reason that page existed:
        the useful thing about a habit is the run behind it, not today's tick.
      */}
      {habit && habit.history7.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            gap: 5,
            paddingHorizontal: 13,
            paddingBottom: 11,
          }}
        >
          {habit.history7.map((was, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 3,
                backgroundColor: was ? tint : rgba(t.text, 0.07),
              }}
            />
          ))}
        </View>
      ) : null}

      {habit?.anchor ? (
        <Text
          style={{
            paddingHorizontal: 13,
            paddingBottom: 11,
            color: t.faint,
            fontFamily: font.body,
            fontSize: 11,
          }}
        >
          Anchor: {habit.anchor}
        </Text>
      ) : null}
    </View>
  );
}
