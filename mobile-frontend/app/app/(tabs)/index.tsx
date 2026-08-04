import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { font, pulseColor, radius, rgba } from "@/lib/theme";
import { useTheme } from "@/lib/theme-provider";
import { isSilenced } from "@/lib/schedule";
import { cacheDashboard, readDashboardCache } from "@/lib/storage";
import type { DashboardToday, Activity } from "@/lib/types";
import { Body, Button, Chip, Loading, SectionHeader } from "@/components/ui";
import { GrowthHero } from "@/components/growth-hero";
import { HabitRow } from "@/components/habit-row";
import { CardRow } from "@/components/card-row";
import { AgentCard, AgentSetupStrip } from "@/components/agent-card";
import { ActivitySession } from "@/components/activity-session";
import { ReminderRunner } from "@/components/reminder-runner";
import { CelebrationModal } from "@/components/celebration-modal";
import { SwipeTabs } from "@/components/swipe-tabs";
import { pushWidgetFromDashboard } from "@/widgets/update";

export default function TodayScreen() {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { t, osReducedMotion } = useTheme();
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

  const completeEvent = useMutation({
    mutationFn: (id: string) => api.completeEvent(id),
    onSuccess: () => {
      invalidate();
      setToast("Logged");
    },
  });

  const dismissEvent = useMutation({
    mutationFn: (id: string) => api.dismissEvent(id),
    onSuccess: invalidate,
  });

  const completeReview = useMutation({
    mutationFn: (id: string) => api.completeReview(id),
    onSuccess: () => {
      invalidate();
      setToast("Review complete");
    },
  });

  const completeCard = useMutation({
    mutationFn: (id: string) => api.completeCard(id),
    onSuccess: (res) => {
      invalidate();
      if (res.xpAwarded) setToast(`+${res.xpAwarded} XP`);
    },
  });

  const startCard = useMutation({
    mutationFn: (id: string) => api.startCard(id),
    onSuccess: (res) => {
      invalidate();
      setToast(`Started · ${res.block?.category ?? "session"}`);
    },
    onError: (e: Error) => setToast(e.message),
  });

  const celebrate = useMutation({
    mutationFn: (id: string) => api.markCelebrationSeen(id),
    onSuccess: invalidate,
  });

  const pendingAgent = useMemo(() => {
    const events = (data?.agentEvents ?? []).filter((e) => e.status === "pending");
    const reviews = (data?.lightReviews ?? []).filter((r) => !r.completedAt);
    return { events, reviews, hasAgent: events.length + reviews.length > 0 };
  }, [data]);

  if (dashQ.isLoading && !data) return <Loading />;

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
  const contentCards = (data.cards ?? []).filter((c) => c.slot === 0 || c.slot === 1);
  const setupCard = (data.cards ?? []).find(
    (c) => c.slot === 2 || c.kind === "agent-setup",
  );
  const upcoming = data.upcoming ?? [];
  const laterCount = (data.scheduled?.length ?? 0) - upcoming.length;

  return (
    <SwipeTabs index={0}>
      <ReminderRunner due={data.dueReminders ?? []} scheduled={data.scheduled} />
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
          paddingHorizontal: 18,
          paddingBottom: 32,
          gap: 24,
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

        {/* ---------------------------------------------------- agent cards */}
        {setupCard || contentCards.length > 0 ? (
          <View style={{ gap: 12 }}>
            <SectionHeader title="From your agent" />
            {setupCard ? <AgentSetupStrip card={setupCard} /> : null}
            {contentCards.map((c) => (
              <AgentCard key={c.id} card={c} onComplete={() => completeCard.mutate(c.id)} />
            ))}
          </View>
        ) : null}

        {/* ------------------------------------------------------- right now */}
        <ActivitySession
          active={data.activeSession}
          onSelect={(a) => setActivity.mutate(a)}
          onClear={() => clearActivity.mutate()}
        />

        {/* --------------------------------------------- up next (15 min) */}
        {upcoming.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionHeader
              title="Up next"
              right={
                laterCount > 0 ? (
                  <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 12 }}>
                    +{laterCount} on Timeline
                  </Text>
                ) : null
              }
            />
            {upcoming.map((c) => (
              <CardRow
                key={c.id}
                card={c}
                urgent={Boolean(c.flash && c.notifiedAt)}
                onStart={() => startCard.mutate(c.id)}
                onComplete={() => completeCard.mutate(c.id)}
              />
            ))}
          </View>
        ) : null}

        {/* -------------------------------------------------------- quick log */}
        <View style={{ gap: 10 }}>
          <SectionHeader title={pendingAgent.hasAgent ? "Needs you" : "Quick log"} />
          {pendingAgent.hasAgent ? (
            <>
              {pendingAgent.events.map((ev) => (
                <View
                  key={ev.id}
                  style={{
                    gap: 10,
                    backgroundColor: rgba(t.accent, 0.08),
                    borderWidth: 1,
                    borderColor: rgba(t.accent, 0.24),
                    borderRadius: radius.lg,
                    padding: 16,
                    borderCurve: "continuous",
                  }}
                >
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
              {pendingAgent.reviews.map((r) => (
                <View
                  key={r.id}
                  style={{
                    gap: 10,
                    backgroundColor: rgba(t.accent, 0.08),
                    borderWidth: 1,
                    borderColor: rgba(t.accent, 0.24),
                    borderRadius: radius.lg,
                    padding: 16,
                    borderCurve: "continuous",
                  }}
                >
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
            </>
          ) : (
            (data.habits ?? []).map((h) => (
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
            ))
          )}
        </View>

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
