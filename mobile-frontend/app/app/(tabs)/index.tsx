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
import type { DashboardToday, Activity } from "@/lib/types";
import {
  Body,
  Button,
  Chip,
  Loading,
  PageBody,
  SectionHeader,
  TwoPane,
} from "@/components/ui";
import { GrowthHero } from "@/components/growth-hero";
import { HabitRow } from "@/components/habit-row";
import { TaskRow } from "@/components/task-row";
import { AgentCard, AgentSetupStrip } from "@/components/agent-card";
import { ActivitySession } from "@/components/activity-session";
import { ReminderRunner } from "@/components/reminder-runner";
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

  const completeHabit = useMutation({
    mutationFn: (id: string) => api.completeHabit(id),
    onSuccess: (res) => {
      invalidate();
      if ("alreadyDone" in res && res.alreadyDone) return;
      if (res.xpAwarded) setToast(`+${res.xpAwarded} XP`);
      if ("streakRecovered" in res && res.streakRecovered) {
        setToast("Streak recovered");
      }
    },
    onError: (e: Error) => setToast(e.message),
  });

  const undoHabit = useMutation({
    mutationFn: (id: string) => api.undoHabit(id),
    onSuccess: invalidate,
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
  /* Pinned tasks are drawn as cards; the status strip is neither pinned nor work. */
  const contentCards = data.tasks.filter((t) => isPinned(t) && !isAgentStatus(t));
  const setupCard = data.tasks.find(isAgentStatus);
  /* Already filtered by the server: inside the lead window, not past its end. */
  const current = data.current;
  const laterCount = agentCount;

  return (
    <SwipeTabs index={0}>
      <ReminderRunner due={data.dueReminders ?? []} scheduled={data.tasks} />
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
                {/* ---------------------------------------------------------- header */}
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Chip label={data.date} />
                    {stale ? <Chip label="offline · cached" color={t.warning} dot /> : null}
                    {settings?.doNotDisturb ? (
                      <Chip label="Do not disturb" color={t.warning} dot />
                    ) : quietOnly ? (
                      <Chip label="Quiet hours" color={t.muted} dot />
                    ) : null}
                  </View>
                  <Text
                    style={{
                      color: pulseColor(data.pulse, t),
                      fontFamily: font.display,
                      fontSize: 38,
                      letterSpacing: -1,
                    }}
                  >
                    {data.pulse}
                  </Text>
                  <Body>{data.pulseExplanation}</Body>
                </View>

                {/* ------------------------------------------------------------ hero */}
                <GrowthHero
                  progress={data.progress}
                  vs={data.vsYesterday}
                  reducedMotion={reduce}
                  celebrationIntensity={settings?.celebrationIntensity ?? "full"}
                />

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
                  Quick log: what is landing now, then habits. One list, in the
                  order you act on it — no separate "Up next" section putting
                  the same card on screen twice.
                */}
                <View style={{ gap: 10 }}>
                  <SectionHeader
                    title="Quick log"
                    right={
                      laterCount > 0 ? (
                        <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 12 }}>
                          +{laterCount} on Timeline
                        </Text>
                      ) : null
                    }
                  />

                  {current.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      urgent={Boolean(task.flash && task.notifiedAt)}
                      onComplete={() => completeTask.mutate(task.id)}
                    />
                  ))}

                  {/* Habits are always here — see AGENTS.md, this client
                      deliberately diverges from CLIENT_GUIDE §3.7. */}
                  {(data.habits ?? []).length === 0 ? (
                    current.length === 0 ? (
                      <Body>No habits yet. Ask your agent to build some.</Body>
                    ) : null
                  ) : (
                    <>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          marginTop: current.length > 0 ? 6 : 0,
                        }}
                      >
                        <Text
                          style={{
                            color: t.faint,
                            fontFamily: font.bodySemi,
                            fontSize: 11,
                            letterSpacing: 1.1,
                            textTransform: "uppercase",
                          }}
                        >
                          Habits
                        </Text>
                        <Text style={{ color: t.faint, fontFamily: font.mono, fontSize: 12 }}>
                          {(data.habits ?? []).filter((h) => h.completedToday).length}/
                          {(data.habits ?? []).length}
                        </Text>
                      </View>
                      {(data.habits ?? []).map((h) => (
                        <HabitRow
                          key={h.id}
                          habit={h}
                          streaksEnabled={settings?.streaksEnabled !== false}
                          busy={completeHabit.isPending || undoHabit.isPending}
                          onToggle={() => {
                            if (h.completedToday) undoHabit.mutate(h.id);
                            else completeHabit.mutate(h.id);
                          }}
                        />
                      ))}
                    </>
                  )}
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
