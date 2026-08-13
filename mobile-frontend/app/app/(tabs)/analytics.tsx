import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import type { AnalyticsPayload, AnalyticsRange } from "@/lib/types";
import { Body, Loading, PageBody, SectionHeader } from "@/components/ui";
import { SwipeTabs } from "@/components/swipe-tabs";

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "all", label: "All" },
];

/**
 * Analytics on the phone.
 *
 * Same series as the web page, drawn for a narrow screen: bars instead of
 * axes, and every bar that has a target draws the target as a line across it.
 * A number without its target is not a measurement, on either client.
 */
export default function AnalyticsScreen() {
  const t = useTokens();
  const { gutter } = useLayout();
  const [range, setRange] = useState<AnalyticsRange>("30d");

  const q = useQuery({
    queryKey: ["analytics", range],
    queryFn: () => api.analytics(range),
    refetchInterval: 60_000,
  });

  if (q.isLoading && !q.data) return <Loading />;
  const d = q.data;

  return (
    <SwipeTabs index={4}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ padding: gutter, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => void q.refetch()}
            tintColor={t.accent}
          />
        }
      >
        <PageBody>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {RANGES.map((r) => {
              const on = r.id === range;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setRange(r.id)}
                  style={{
                    paddingVertical: 7,
                    paddingHorizontal: 14,
                    borderRadius: radius.pill,
                    backgroundColor: on ? rgba(t.accent, 0.2) : t.surface,
                    borderWidth: 1,
                    borderColor: on ? rgba(t.accent, 0.45) : t.border,
                  }}
                >
                  <Text
                    style={{
                      color: on ? t.accent : t.muted,
                      fontFamily: font.bodySemi,
                      fontSize: 12,
                    }}
                  >
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {!d ? (
            <Body>Couldn&apos;t load analytics.</Body>
          ) : (
            <>
              <DailyBars data={d} />
              <HabitRates data={d} />
              <Adherence data={d} />
              <Counters data={d} />
              <Goals data={d} />
            </>
          )}
        </PageBody>
      </ScrollView>
    </SwipeTabs>
  );
}

/** XP per day, with the target drawn across the bars as a line. */
function DailyBars({ data }: { data: AnalyticsPayload }) {
  const t = useTokens();
  if (data.daily.length === 0) {
    return <Body>No days recorded yet in this window.</Body>;
  }

  const target = data.daily[0]!.xpTarget;
  /* Scale to whichever is bigger, so the target line is always on screen. */
  const peak = Math.max(target, ...data.daily.map((x) => x.xp), 1);
  const H = 110;
  const onTarget = data.daily.filter((x) => x.xp >= x.xpTarget).length;

  return (
    <View style={{ gap: 8 }}>
      <SectionHeader
        title="XP against target"
        right={
          <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
            {onTarget}/{data.daily.length} on target
          </Text>
        }
      />
      <View style={{ height: H, justifyContent: "flex-end" }}>
        {/* The target line, positioned by value rather than by bar. */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: (target / peak) * H,
            height: 1,
            backgroundColor: rgba(t.muted, 0.5),
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
          {data.daily.map((x) => (
            <View
              key={x.date}
              style={{
                flex: 1,
                height: Math.max(2, (x.xp / peak) * H),
                borderRadius: 2,
                backgroundColor: x.xp >= x.xpTarget ? t.positive : t.accent,
                opacity: x.xp >= x.xpTarget ? 1 : 0.75,
              }}
            />
          ))}
        </View>
      </View>
      <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 11 }}>
        Line is your daily target of {target} XP · {data.from} onward
      </Text>
    </View>
  );
}

/** Which habits are actually carrying the day. */
function HabitRates({ data }: { data: AnalyticsPayload }) {
  const t = useTokens();
  if (data.habits.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Habits, by how often you close them" />
      {data.habits.map((h) => (
        <View key={h.id} style={{ gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 14 }}>{h.emoji}</Text>
            <Text
              style={{ color: t.text, fontFamily: font.body, fontSize: 13, flex: 1 }}
              numberOfLines={1}
            >
              {h.name}
            </Text>
            <Text style={{ color: t.muted, fontFamily: font.mono, fontSize: 12 }}>
              {h.ratePct}%
            </Text>
            <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
              {h.currentStreak}d
            </Text>
          </View>
          {/* One tick per day it could have been done. */}
          <View style={{ flexDirection: "row", gap: 2 }}>
            {h.history.map((day) => (
              <View
                key={day.date}
                style={{
                  flex: 1,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: day.done ? h.themeColor : rgba(t.muted, 0.14),
                }}
              />
            ))}
          </View>
        </View>
      ))}
      <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 11 }}>
        Rate is over the days each habit existed, not the whole window.
      </Text>
    </View>
  );
}

function Adherence({ data }: { data: AnalyticsPayload }) {
  const a = data.adherence;
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title="Schedule adherence" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Figure label="Scheduled" value={a.scheduled} />
        <Figure label="Done" value={a.completed} />
        <Figure label="Late" value={a.completedLate} />
        <Figure label="Rate" value={`${a.ratePct}%`} />
      </View>
    </View>
  );
}

function Counters({ data }: { data: AnalyticsPayload }) {
  const t = useTokens();
  if (data.properties.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Agent counters" />
      {data.properties.map((p) => (
        <View
          key={p.uid}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: radius.md,
            backgroundColor: t.surface,
            borderCurve: "continuous",
          }}
        >
          <Text
            style={{ color: t.text, fontFamily: font.body, fontSize: 13, flex: 1 }}
            numberOfLines={1}
          >
            {p.label}
          </Text>
          {p.delta !== null && p.delta !== 0 ? (
            <Text
              style={{
                color: p.delta > 0 ? t.positive : t.muted,
                fontFamily: font.mono,
                fontSize: 11,
              }}
            >
              {p.delta > 0 ? "+" : ""}
              {p.delta}
            </Text>
          ) : null}
          <Text style={{ color: t.text, fontFamily: font.mono, fontSize: 15 }}>
            {p.current ?? "—"}
            {p.unit ? ` ${p.unit}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Goals({ data }: { data: AnalyticsPayload }) {
  const t = useTokens();
  if (data.goals.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title="Goal progression" />
      {data.goals.map((g) => (
        <View key={g.id} style={{ gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 14 }}>{g.emoji}</Text>
            <Text
              style={{ color: t.text, fontFamily: font.body, fontSize: 13, flex: 1 }}
              numberOfLines={1}
            >
              {g.title}
            </Text>
            <Text style={{ color: t.muted, fontFamily: font.mono, fontSize: 12 }}>
              {Math.round(g.progressPct)}%
            </Text>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: rgba(t.muted, 0.14),
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.min(100, Math.max(0, g.progressPct))}%`,
                height: "100%",
                backgroundColor: g.themeColor,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  const t = useTokens();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: t.text, fontFamily: font.mono, fontSize: 19 }}>
        {value}
      </Text>
      <Text
        style={{
          color: t.faint,
          fontFamily: font.bodySemi,
          fontSize: 9,
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
