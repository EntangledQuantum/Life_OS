import { useMemo, useState, useEffect } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { colors, accentColor } from "@/lib/theme";
import { dayKey, labelDay } from "@/lib/format";
import type { DashboardCard } from "@/lib/types";
import { Body, Loading, SectionHeader } from "@/components/ui";
import { DayTimeline } from "@/components/day-timeline";
import { CardRow } from "@/components/card-row";

export default function TimelineScreen() {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 15_000,
  });

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    staleTime: 30_000,
  });

  const start = useMutation({
    mutationFn: (id: string) => api.startCard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeCard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const groups = useMemo(() => {
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
        (a.eventAt ?? a.remindAt ?? "").localeCompare(
          b.eventAt ?? b.remindAt ?? "",
        ),
      );
    }
    const keys = [...byDay.keys()].sort((a, b) => {
      if (a === "unscheduled") return 1;
      if (b === "unscheduled") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, cards: byDay.get(k)! }));
  }, [dashQ.data?.scheduled, now]);

  const doneToday = useMemo(() => {
    return (dashQ.data?.scheduled ?? []).filter((c) => c.status === "done");
  }, [dashQ.data?.scheduled]);

  if (dashQ.isLoading && !dashQ.data) return <Loading />;

  const theme = settingsQ.data?.accentTheme ?? "nebula";
  void theme;
  void accentColor;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 18 }}
      refreshControl={
        <RefreshControl
          refreshing={dashQ.isFetching && !dashQ.isLoading}
          onRefresh={() => void dashQ.refetch()}
          tintColor={colors.muted}
        />
      }
    >
      <View>
        <SectionHeader title="Today's shape" />
        <DayTimeline segments={dashQ.data?.timeline ?? []} />
      </View>

      {groups.length === 0 ? (
        <Body>Nothing scheduled. Your agent will fill this in.</Body>
      ) : (
        groups.map((g) => (
          <View key={g.key} style={{ gap: 10 }}>
            <SectionHeader title={labelDay(g.key)} />
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

      {doneToday.length > 0 ? (
        <View style={{ gap: 10, opacity: 0.7 }}>
          <SectionHeader title="Done today" />
          {doneToday.map((c) => (
            <View
              key={c.id}
              style={{
                flexDirection: "row",
                gap: 10,
                paddingVertical: 8,
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ fontSize: 18 }}>{c.emoji || "✓"}</Text>
              <Text
                style={{
                  color: colors.muted,
                  fontFamily: "Figtree_500Medium",
                  fontSize: 14,
                  textDecorationLine: "line-through",
                  flex: 1,
                }}
              >
                {c.title}
              </Text>
              {c.xpOnComplete > 0 ? (
                <Text
                  style={{
                    color: colors.positive,
                    fontFamily: "JetBrainsMono_500Medium",
                    fontSize: 12,
                  }}
                >
                  +{c.xpOnComplete} XP
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
