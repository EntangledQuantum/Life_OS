import { useMemo, useState, useEffect } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { font, radius, rgba, type Tokens } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { dayKey, labelDay } from "@/lib/format";
import type { DashboardCard } from "@/lib/types";
import { Body, Button, Loading, SectionHeader } from "@/components/ui";
import { DayTimeline } from "@/components/day-timeline";
import { VsYesterdayRow } from "@/components/vs-yesterday";
import { XpChart } from "@/components/xp-chart";
import { CardRow } from "@/components/card-row";
import { SwipeTabs } from "@/components/swipe-tabs";

/**
 * Everything time-shaped lives here: the day ribbon, how today compares, the
 * agent's full schedule, and the week. Today's screen only carries the next
 * fifteen minutes, so this is where the rest goes.
 */
export default function TimelineScreen() {
  const qc = useQueryClient();
  const t = useTokens();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 15_000,
  });

  const start = useMutation({
    mutationFn: (id: string) => api.startCard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeCard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dashboard"] });

  const completeEvent = useMutation({
    mutationFn: (id: string) => api.completeEvent(id),
    onSuccess: invalidate,
  });

  const dismissEvent = useMutation({
    mutationFn: (id: string) => api.dismissEvent(id),
    onSuccess: invalidate,
  });

  const completeReview = useMutation({
    mutationFn: (id: string) => api.completeReview(id),
    onSuccess: invalidate,
  });

  /**
   * Agent-queued work. It used to sit on Today and hide the habits behind it;
   * it belongs here, next to the rest of what the agent has planned.
   */
  const agentEvents = (dashQ.data?.agentEvents ?? []).filter(
    (e) => e.status === "pending",
  );
  const reviews = (dashQ.data?.lightReviews ?? []).filter((r) => !r.completedAt);

  const groups = useMemo(() => {
    void now; // re-group as the clock moves
    const scheduled = dashQ.data?.scheduled ?? [];
    const byDay = new Map<string, DashboardCard[]>();
    for (const card of scheduled) {
      if (card.status !== "active") continue;
      const when = card.eventAt ?? card.remindAt ?? card.showAt;
      const key = when ? dayKey(new Date(when)) : "unscheduled";
      const list = byDay.get(key) ?? [];
      list.push(card);
      byDay.set(key, list);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) =>
        (a.eventAt ?? a.remindAt ?? "").localeCompare(b.eventAt ?? b.remindAt ?? ""),
      );
    }
    const keys = [...byDay.keys()].sort((a, b) => {
      if (a === "unscheduled") return 1;
      if (b === "unscheduled") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, cards: byDay.get(k)! }));
  }, [dashQ.data?.scheduled, now]);

  const doneToday = useMemo(
    () => (dashQ.data?.scheduled ?? []).filter((c) => c.status === "done"),
    [dashQ.data?.scheduled],
  );

  if (dashQ.isLoading && !dashQ.data) return <Loading />;

  return (
    <SwipeTabs index={1}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ padding: 18, paddingBottom: 36, gap: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dashQ.isFetching && !dashQ.isLoading}
            onRefresh={() => void dashQ.refetch()}
            tintColor={t.accent}
          />
        }
      >
        {agentEvents.length + reviews.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionHeader title="Needs you" />
            {agentEvents.map((ev) => (
              <View key={ev.id} style={agentPanel(t)}>
                <Text style={{ color: t.text, fontFamily: font.title, fontSize: 16 }}>
                  {ev.title}
                </Text>
                {ev.body ? <Body>{ev.body}</Body> : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    title={`Done${ev.xpOnComplete ? ` · +${ev.xpOnComplete}` : ""}`}
                    onPress={() => completeEvent.mutate(ev.id)}
                  />
                  <Button
                    title="Dismiss"
                    variant="ghost"
                    onPress={() => dismissEvent.mutate(ev.id)}
                  />
                </View>
              </View>
            ))}
            {reviews.map((r) => (
              <View key={r.id} style={agentPanel(t)}>
                <Text style={{ color: t.text, fontFamily: font.title, fontSize: 16 }}>
                  {r.prompt}
                </Text>
                <Button
                  title="Complete review"
                  onPress={() => completeReview.mutate(r.id)}
                  style={{ alignSelf: "flex-start" }}
                />
              </View>
            ))}
          </View>
        ) : null}

        <View>
          <SectionHeader title="Today's shape" />
          <DayTimeline segments={dashQ.data?.timeline ?? []} />
        </View>

        {dashQ.data?.vsYesterday ? (
          <View>
            <SectionHeader title="Today vs yesterday" />
            <VsYesterdayRow vs={dashQ.data.vsYesterday} />
          </View>
        ) : null}

        {groups.length === 0 ? (
          <Body>Nothing scheduled. Your agent will fill this in.</Body>
        ) : (
          groups.map((g) => (
            <View key={g.key} style={{ gap: 10 }}>
              <SectionHeader
                title={labelDay(g.key)}
                right={
                  <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
                    {g.cards.length}
                  </Text>
                }
              />
              {g.cards.map((c) => (
                <CardRow
                  key={c.id}
                  card={c}
                  urgent={Boolean(c.notifiedAt && c.flash)}
                  onStart={() => start.mutate(c.id)}
                  onComplete={() => complete.mutate(c.id)}
                />
              ))}
            </View>
          ))
        )}

        <XpChart series={dashQ.data?.xpSeries7 ?? []} />

        {doneToday.length > 0 ? (
          <View style={{ gap: 8 }}>
            <SectionHeader title="Done today" />
            {doneToday.map((c) => (
              <View
                key={c.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  backgroundColor: t.surface,
                  opacity: 0.65,
                  borderCurve: "continuous",
                }}
              >
                <Text style={{ fontSize: 16 }}>{c.emoji || "✓"}</Text>
                <Text
                  style={{
                    color: t.muted,
                    fontFamily: font.bodyMedium,
                    fontSize: 14,
                    textDecorationLine: "line-through",
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {c.title}
                </Text>
                {c.xpOnComplete > 0 ? (
                  <Text style={{ color: t.positive, fontFamily: font.mono, fontSize: 12 }}>
                    +{c.xpOnComplete} XP
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SwipeTabs>
  );
}

/** Shared panel styling for the agent's queued items. */
function agentPanel(t: Tokens) {
  return {
    gap: 10,
    backgroundColor: rgba(t.accent, 0.08),
    borderWidth: 1,
    borderColor: rgba(t.accent, 0.24),
    borderRadius: radius.lg,
    padding: 16,
    borderCurve: "continuous" as const,
  };
}
