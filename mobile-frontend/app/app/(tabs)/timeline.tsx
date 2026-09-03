import { useMemo, useState, useEffect } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { font, radius } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import { dayKey, labelDay } from "@/lib/format";
import { isAgentStatus, isPinned, type Task } from "@/lib/types";
import { Body, Loading, PageBody, SectionHeader, TwoPane } from "@/components/ui";
import { DayTimeline } from "@/components/day-timeline";
import { VsYesterdayRow } from "@/components/vs-yesterday";
import { XpChart } from "@/components/xp-chart";
import { TaskRow } from "@/components/task-row";
import { SwipeTabs } from "@/components/swipe-tabs";

/**
 * Everything time-shaped lives here: the day ribbon, how today compares, the
 * agent's full schedule, and the week. Today's screen only carries what is
 * landing in the next few minutes, so this is where the rest goes.
 *
 * There used to be three lists — scheduled cards, agent events, light reviews —
 * because there used to be three tables. There is one now, and the only thing
 * separating a row here from another is whether it has a time.
 */
export default function TimelineScreen() {
  const qc = useQueryClient();
  const t = useTokens();
  const { gutter } = useLayout();
  /** `?task=` arrives from a tapped notification — that row gets highlighted. */
  const { task: focusId } = useLocalSearchParams<{ task?: string }>();
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

  /** The whole day's completions, which the dashboard payload does not carry. */
  const doneQ = useQuery({
    queryKey: ["tasks", "done"],
    queryFn: () => api.tasks({ status: "done" }),
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const complete = useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissTask(id),
    onSuccess: invalidate,
  });

  const open = useMemo(
    () => (dashQ.data?.tasks ?? []).filter((task) => task.status === "active"),
    [dashQ.data?.tasks],
  );

  /**
   * Work with no time on it — what the agent queued for "whenever". It used to
   * sit on Today and hide the habits behind it; it belongs here, next to the
   * rest of what the agent has planned.
   */
  const needsYou = useMemo(
    () =>
      open.filter(
        (task) =>
          !task.eventAt && !task.remindAt && !isPinned(task) && !isAgentStatus(task),
      ),
    [open],
  );

  /** Everything with a time, grouped by the local day it falls on. */
  const groups = useMemo(() => {
    void now; // re-group as the clock moves
    const byDay = new Map<string, Task[]>();
    for (const task of open) {
      // A pinned card is drawn as a card. Listing it here as well is the same
      // thing twice on one screen, with two places to tick it.
      if (isPinned(task) || isAgentStatus(task)) continue;
      const when = task.eventAt ?? task.remindAt;
      if (!when) continue;
      const key = dayKey(new Date(when));
      const list = byDay.get(key) ?? [];
      list.push(task);
      byDay.set(key, list);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) =>
        (a.eventAt ?? a.remindAt ?? "").localeCompare(b.eventAt ?? b.remindAt ?? ""),
      );
    }
    return [...byDay.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ key: k, tasks: byDay.get(k)! }));
  }, [open, now]);

  const doneToday = useMemo(() => {
    const today = dayKey(new Date());
    return (doneQ.data ?? []).filter(
      (task) => task.completedAt && dayKey(new Date(task.completedAt)) === today,
    );
  }, [doneQ.data]);

  if (!dashQ.data)
    return <Loading error={dashQ.error} onRetry={() => void dashQ.refetch()} />;

  return (
    <SwipeTabs index={1}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: 36,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dashQ.isFetching && !dashQ.isLoading}
            onRefresh={() => void dashQ.refetch()}
            tintColor={t.accent}
          />
        }
      >
        <PageBody>
          <TwoPane
            /* Left is the shape of the day and how it compares; right is the
               list of things that are going to happen in it. */
            left={
              <>
                {needsYou.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    <SectionHeader title="Needs you" />
                    {needsYou.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        expanded
                        urgent={focusId === task.id}
                        onComplete={() => complete.mutate(task.id)}
                        onDismiss={() => dismiss.mutate(task.id)}
                      />
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

                <XpChart series={dashQ.data?.xpSeries7 ?? []} />
              </>
            }
            right={
              <>
                {groups.length === 0 && needsYou.length === 0 ? (
                  <Body>Nothing scheduled. Your agent will fill this in.</Body>
                ) : (
                  groups.map((g) => (
                    <View key={g.key} style={{ gap: 10 }}>
                      <SectionHeader
                        title={labelDay(g.key)}
                        right={
                          <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
                            {g.tasks.length}
                          </Text>
                        }
                      />
                      {g.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          /* The tapped notification's task opens expanded — you
                             are here to deal with it, not to look at a title. */
                          expanded={focusId === task.id}
                          urgent={
                            Boolean(task.notifiedAt && task.flash) || focusId === task.id
                          }
                          onComplete={() => complete.mutate(task.id)}
                        />
                      ))}
                    </View>
                  ))
                )}

                {doneToday.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <SectionHeader title="Done today" />
                    {doneToday.map((task) => (
                      <View
                        key={task.id}
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
                        <Text style={{ fontSize: 16 }}>{task.emoji || "✓"}</Text>
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
                          {task.title}
                        </Text>
                        {task.xpOnComplete > 0 ? (
                          <Text
                            style={{ color: t.positive, fontFamily: font.mono, fontSize: 12 }}
                          >
                            +{task.xpOnComplete} XP
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            }
          />
        </PageBody>
      </ScrollView>
    </SwipeTabs>
  );
}
