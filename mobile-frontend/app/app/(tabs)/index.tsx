import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ProtocolError } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { font, pulseColor, radius, rgba } from "@/lib/theme";
import { useTheme } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import { isSilenced } from "@/lib/schedule";
import { cacheDashboard, readDashboardCache } from "@/lib/storage";
import { isAgentStatus, isPinned } from "@/lib/types";
import type { DashboardToday, Activity, AgendaItem } from "@/lib/types";
import {
  Body,
  Button,
  Chip,
  Loading,
  PageBody,
  SectionHeader,
  TwoPane,
} from "@/components/ui";
import { DayGraphic } from "@/components/day-graphic";
import { AgendaRow } from "@/components/agenda-row";
import { AgentCard, AgentSetupStrip } from "@/components/agent-card";
import { ActivitySession } from "@/components/activity-session";
import { CelebrationModal } from "@/components/celebration-modal";
import { UpdateRequired } from "@/components/update-required";
import { SwipeTabs } from "@/components/swipe-tabs";
import { pushWidgetFromDashboard } from "@/widgets/update";

export default function TodayScreen() {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, osReducedMotion } = useTheme();
  const { gutter, wide } = useLayout();
  const { authenticated, refreshHealth } = useConnection();
  const [stale, setStale] = useState(false);
  const [cached, setCached] = useState<DashboardToday | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    enabled: authenticated,
    staleTime: 20_000,
  });

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      try {
        const d = await api.dashboard();
        setStale(false);
        await cacheDashboard(JSON.stringify(d));
        void pushWidgetFromDashboard(d, false);
        return d;
      } catch (e) {
        const raw = await readDashboardCache();
        if (raw) {
          setStale(true);
          const parsed = JSON.parse(raw) as DashboardToday;
          setCached(parsed);
          void pushWidgetFromDashboard(parsed, true);
          return parsed;
        }
        throw e;
      }
    },
    enabled: authenticated,
    refetchInterval: 8000,
  });

  // Back off when backgrounded — refetch on resume
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
        void refreshHealth();
      }
    });
    return () => sub.remove();
  }, [qc, refreshHealth]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  const data = dashQ.data ?? cached;
  const settings = settingsQ.data;
  const reduce = Boolean(settings?.reducedMotion) || osReducedMotion;
  const silent = isSilenced(settings);
  const quietOnly =
    !settings?.doNotDisturb && settings?.quietHoursSilent !== false && silent;

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  /**
   * One handler for both kinds, because the screen shows one list.
   *
   * `source` is the only thing that differs, and it decides which record takes
   * the completion — the habit that owns the streak, or the task that owns the
   * XP. Two handlers over two lists is what let the same act be ticked twice.
   */
  const completeItem = useMutation({
    mutationFn: (item: AgendaItem) =>
      item.source === "habit"
        ? api.completeHabit(item.refId)
        : api.completeTask(item.refId),
    onSuccess: (res: any) => {
      invalidate();
      if (res && "alreadyDone" in res && res.alreadyDone) return;
      if (res?.streakRecovered) {
        setToast("Streak recovered");
        return;
      }
      if (res?.xpAwarded) setToast(`+${res.xpAwarded} XP`);
    },
    onError: (e: Error) => setToast(e.message),
  });

  const undoItem = useMutation({
    mutationFn: (item: AgendaItem) => api.undoHabit(item.refId),
    onSuccess: invalidate,
    onError: (e: Error) => setToast(e.message),
  });

  const setActivity = useMutation({
    mutationFn: (a: Activity) => api.setActiveSession(a),
    onSuccess: invalidate,
  });

  const clearActivity = useMutation({
    mutationFn: () => api.clearActiveSession(),
    onSuccess: invalidate,
  });

  const completeTask = useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: (res) => {
      invalidate();
      if (res.xpAwarded) setToast(`+${res.xpAwarded} XP`);
    },
    onError: (e: Error) => setToast(e.message),
  });

  const celebrate = useMutation({
    mutationFn: (id: string) => api.markCelebrationSeen(id),
    onSuccess: invalidate,
  });

  /**
   * Agent items live on Timeline, not here — only their count surfaces on
   * Today. The web client hides habits while any agent item is open, and this
   * screen copied that: with an agent keeping a standing queue of events, the
   * habits never rendered at all. Habits are the one thing Today must always
   * show.
   */
  const agentCount = useMemo(() => {
    if (!data) return 0;
    const current = new Set(data.current.map((t) => t.id));
    return data.tasks.filter(
      (t) => !current.has(t.id) && !isPinned(t) && !isAgentStatus(t),
    ).length;
  }, [data]);

  if (dashQ.isLoading && !data) return <Loading />;

  /*
   * A server that has outgrown this build is its own screen. It is not a
   * connection problem and there is nothing to retry — see update-required.tsx.
   */
  if (dashQ.error instanceof ProtocolError) {
    return <UpdateRequired error={dashQ.error} />;
  }

  if (dashQ.isError && !data) {
    const msg =
      dashQ.error instanceof ApiError ? dashQ.error.message : "Life OS isn't running";
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          padding: 24,
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Text style={{ color: t.text, fontFamily: font.display, fontSize: 24 }}>
          Life OS isn&apos;t running
        </Text>
        <Body>{msg}</Body>
        <Button
          title="Retry"
          onPress={() => void dashQ.refetch()}
          style={{ marginTop: 8 }}
        />
      </View>
    );
  }

  if (!data) return <Loading />;

  const celebration = data.pendingCelebrations?.[0] ?? null;

  /*
   * One list, straight from the server. The client does not merge habits and
   * tasks itself — two clients merging the same two lists is two chances to do
   * it differently.
   */
  const agenda = data.agenda ?? [];
  const timed = agenda.filter((i) => i.at !== null);
  const anytime = agenda.filter((i) => i.at === null);
  const doneCount = agenda.filter((i) => i.done).length;

  const dayStart = Date.parse(data.lifeDay?.lifeDayStart ?? "");
  const dayEnd = Date.parse(data.lifeDay?.lifeDayEnd ?? "");
  const dayProgress = Number.isFinite(dayStart) && dayEnd > dayStart
    ? Math.max(0, Math.min(1, (Date.now() - dayStart) / (dayEnd - dayStart)))
    : 0;
  /* Pinned tasks are drawn as cards; the status strip is neither pinned nor work. */
  const contentCards = data.tasks.filter((t) => isPinned(t) && !isAgentStatus(t));
  const setupCard = data.tasks.find(isAgentStatus);
  /* Already filtered by the server: inside the lead window, not past its end. */
  const current = data.current;
  const laterCount = agentCount;

  return (
    <SwipeTabs index={0}>
      <CelebrationModal
        goal={celebration}
        intensity={settings?.celebrationIntensity ?? "full"}
        reducedMotion={reduce}
        onDismiss={() => {
          if (celebration) celebrate.mutate(celebration.id);
        }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: gutter,
          paddingBottom: 32,
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
            /* The hero is the anchor; on a tablet the lists sit beside it
               instead of under 900pt of whitespace. */
            left={
              <>
                {/*
                  The old header led with the pulse word at 38pt and a
                  paragraph explaining it — a verdict about yesterday, first
                  thing every morning, above any of the work. It is one chip in
                  the corner now; the reasoning lives on Analytics where there
                  is room for it.
                */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        color: t.text,
                        fontFamily: font.display,
                        fontSize: 28,
                        letterSpacing: -0.6,
                      }}
                    >
                      {greeting()}
                    </Text>
                    <Text style={{ color: t.muted, fontFamily: font.body, fontSize: 13, marginTop: 2 }}>
                      {doneCount} of {agenda.length} done today
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => router.navigate("/(tabs)/analytics")}
                    style={{
                      borderWidth: 1,
                      borderColor: t.border,
                      borderRadius: radius.pill,
                      paddingHorizontal: 11,
                      paddingVertical: 6,
                      alignItems: "flex-end",
                    }}
                  >
                    <Text
                      style={{
                        color: pulseColor(data.pulse, t),
                        fontFamily: font.bodySemi,
                        fontSize: 12,
                      }}
                    >
                      {data.pulse}
                    </Text>
                    <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}>
                      {data.progress.improvementPct > 0 ? "+" : ""}
                      {Math.round(data.progress.improvementPct)}%
                    </Text>
                  </Pressable>
                </View>

                {stale || settings?.doNotDisturb || quietOnly ? (
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {stale ? <Chip label="offline · cached" color={t.warning} dot /> : null}
                    {settings?.doNotDisturb ? (
                      <Chip label="Do not disturb" color={t.warning} dot />
                    ) : quietOnly ? (
                      <Chip label="Quiet hours" color={t.muted} dot />
                    ) : null}
                  </View>
                ) : null}

                {/* ------------------------------------------------------------ hero */}
                <View style={{ alignItems: "center", gap: 6 }}>
                  <DayGraphic
                    style={data.progress.growthStyle}
                    efficiencyPct={data.progress.efficiencyPct}
                    habits={data.habits ?? []}
                    agenda={agenda}
                    history={(data.consistency7 ?? []).map((d) => d.pct)}
                    dayProgress={dayProgress}
                    size={210}
                  />
                  <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 12 }}>
                    {data.progress.dailyXp} / {data.progress.dailyXpTarget} XP
                  </Text>
                </View>

                {/* ------------------------------------------------------- right now */}
                <ActivitySession
                  active={data.activeSession}
                  onSelect={(a) => setActivity.mutate(a)}
                  onClear={() => clearActivity.mutate()}
                />
                      </>
                    }
                    right={
                      <>
                {/* ---------------------------------------------------- agent cards */}
                {setupCard || contentCards.length > 0 ? (
                  <View style={{ gap: 12 }}>
                    <SectionHeader title="From your agent" />
                    {setupCard ? <AgentSetupStrip card={setupCard} /> : null}
                    {contentCards.map((c) => (
                      <AgentCard key={c.id} card={c} onComplete={() => completeTask.mutate(c.id)} />
                    ))}
                  </View>
                ) : null}

                {/*
                  One list. Habits and scheduled tasks used to render as two
                  sections here, which is exactly what made it reasonable for an
                  agent to create one of each for the same act — and gave two
                  rows to tick, paying out twice if both were ticked.
                */}
                <View style={{ gap: 10 }}>
                  {timed.length > 0 ? (
                    <>
                      <SectionHeader title="Today" />
                      {timed.map((item) => (
                        <AgendaRow
                          key={item.id}
                          item={item}
                          busy={completeItem.isPending || undoItem.isPending}
                          onComplete={(i) => completeItem.mutate(i)}
                          onUndo={(i) => undoItem.mutate(i)}
                        />
                      ))}
                    </>
                  ) : null}

                  {anytime.length > 0 ? (
                    <>
                      <SectionHeader title="Anytime" />
                      {anytime.map((item) => (
                        <AgendaRow
                          key={item.id}
                          item={item}
                          busy={completeItem.isPending || undoItem.isPending}
                          onComplete={(i) => completeItem.mutate(i)}
                          onUndo={(i) => undoItem.mutate(i)}
                        />
                      ))}
                    </>
                  ) : null}

                  {agenda.length === 0 ? (
                    <Body>Nothing on today. Ask your agent to set up some habits.</Body>
                  ) : null}
                </View>

                {/* Agent items live on Timeline; Today just says how many are waiting. */}
                {agentCount > 0 ? (
                  <Pressable
                    onPress={() => router.navigate("/(tabs)/timeline")}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: rgba(t.accent, 0.1),
                      borderWidth: 1,
                      borderColor: rgba(t.accent, 0.28),
                      borderRadius: radius.md,
                      paddingVertical: 13,
                      paddingHorizontal: 14,
                      opacity: pressed ? 0.8 : 1,
                      borderCurve: "continuous",
                    })}
                  >
                    <Text style={{ fontSize: 15 }}>✦</Text>
                    <Text
                      style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 14, flex: 1 }}
                    >
                      {agentCount} item{agentCount === 1 ? "" : "s"} from your agent need
                      you
                    </Text>
                    <Text style={{ color: t.accent, fontFamily: font.bodySemi, fontSize: 13 }}>
                      Timeline →
                    </Text>
                  </Pressable>
                ) : null}
              </>
            }
          />

          {/* Pointless once the rail is showing every tab at once. */}
          {wide ? null : (
            <Text
              style={{
                textAlign: "center",
                color: t.faint,
                fontFamily: font.body,
                fontSize: 12,
              }}
            >
              Swipe left for your timeline
            </Text>
          )}
        </PageBody>
      </ScrollView>

      {toast ? (
        <Animated.View
          entering={FadeInDown.duration(180)}
          exiting={FadeOut.duration(150)}
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 22,
            alignSelf: "center",
            backgroundColor: t.surface2,
            paddingHorizontal: 18,
            paddingVertical: 11,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: rgba(t.accent, 0.3),
          }}
        >
          <Text style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 13 }}>
            {toast}
          </Text>
        </Animated.View>
      ) : null}
    </SwipeTabs>
  );
}

/** Reads as a person rather than a date stamp, and costs nothing to compute. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 22) return "Evening";
  return "Tonight";
}
