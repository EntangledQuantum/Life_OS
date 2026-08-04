import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { colors, pulseColor, accentColor, accentSoft } from "@/lib/theme";
import { isSilenced } from "@/lib/schedule";
import { cacheDashboard, readDashboardCache } from "@/lib/storage";
import type { DashboardToday, Activity } from "@/lib/types";
import { Body, Card, Chip, Label, Loading, SectionHeader } from "@/components/ui";
import { GrowthMeter } from "@/components/growth-meter";
import { DayTimeline } from "@/components/day-timeline";
import { HabitRow } from "@/components/habit-row";
import { CardRow } from "@/components/card-row";
import { ActivitySession } from "@/components/activity-session";
import { VsYesterdayRow } from "@/components/vs-yesterday";
import { XpChart } from "@/components/xp-chart";
import { ReminderRunner } from "@/components/reminder-runner";
import { CelebrationModal } from "@/components/celebration-modal";
import { pushWidgetFromDashboard } from "@/widgets/update";

export default function TodayScreen() {
  const qc = useQueryClient();
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
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const data = dashQ.data ?? cached;
  const theme = settingsQ.data?.accentTheme ?? "nebula";
  const accent = accentColor(theme);
  const silent = isSilenced(settingsQ.data);
  const quietOnly =
    !settingsQ.data?.doNotDisturb &&
    settingsQ.data?.quietHoursSilent !== false &&
    silent;

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

  const celebration =
    data?.pendingCelebrations?.[0] ?? null;

  if (dashQ.isLoading && !data) return <Loading />;

  if (dashQ.isError && !data) {
    const msg =
      dashQ.error instanceof ApiError
        ? dashQ.error.message
        : "Life OS isn't running";
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: 24,
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontFamily: "Figtree_700Bold",
            fontSize: 22,
          }}
        >
          Life OS isn&apos;t running
        </Text>
        <Body>{msg}</Body>
        <Pressable
          onPress={() => void dashQ.refetch()}
          style={{
            marginTop: 8,
            backgroundColor: accent,
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: colors.background,
              fontFamily: "Figtree_600SemiBold",
            }}
          >
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return <Loading />;

  const p = data.progress;
  const contentCards = (data.cards ?? []).filter(
    (c) => c.slot === 0 || c.slot === 1,
  );
  const setupCard = (data.cards ?? []).find((c) => c.slot === 2 || c.kind === "agent-setup");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ReminderRunner due={data.dueReminders ?? []} scheduled={data.scheduled} />
      <CelebrationModal
        goal={celebration}
        intensity={settingsQ.data?.celebrationIntensity ?? "full"}
        theme={theme}
        onDismiss={() => {
          if (celebration) celebrate.mutate(celebration.id);
        }}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 18 }}
        refreshControl={
          <RefreshControl
            refreshing={dashQ.isFetching && !dashQ.isLoading}
            onRefresh={() => void dashQ.refetch()}
            tintColor={colors.muted}
          />
        }
      >
        {/* Status chips */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label={data.date} color={colors.muted} />
          {stale ? (
            <Chip label="stale · offline" color={colors.warning} bg="rgba(251,191,36,0.12)" />
          ) : null}
          {settingsQ.data?.doNotDisturb ? (
            <Chip label="DND" color={colors.warning} bg="rgba(251,191,36,0.12)" />
          ) : quietOnly ? (
            <Chip label="quiet hours" color={colors.muted} bg="rgba(255,255,255,0.06)" />
          ) : null}
        </View>

        {/* Pulse header */}
        <View style={{ gap: 6 }}>
          <Text
            style={{
              color: pulseColor(data.pulse, theme),
              fontFamily: "Figtree_700Bold",
              fontSize: 34,
              letterSpacing: -0.5,
            }}
          >
            {data.pulse}
          </Text>
          <Body>{data.pulseExplanation}</Body>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
            <Metric
              label="Efficiency"
              value={`${Math.round(p.efficiencyPct)}%`}
              color={accent}
            />
            <Metric
              label="vs yesterday"
              value={`${p.improvementPct > 0 ? "+" : ""}${p.improvementPct.toFixed(1)} pp`}
              color={
                p.improvementPct > 0
                  ? colors.positive
                  : p.improvementPct < 0
                    ? colors.neutralNegative
                    : colors.muted
              }
            />
            <Metric
              label="XP"
              value={`${p.dailyXp}/${p.dailyXpTarget}`}
              color={colors.text}
            />
          </View>
        </View>

        {/* vs yesterday */}
        <View>
          <SectionHeader title="Today vs yesterday" />
          <VsYesterdayRow vs={data.vsYesterday} />
        </View>

        {/* Agent setup strip */}
        {setupCard ? (
          <View
            style={{
              backgroundColor: accentSoft(theme, 0.1),
              borderRadius: 12,
              padding: 12,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.muted,
                fontFamily: "Figtree_500Medium",
                fontSize: 13,
              }}
            >
              {setupCard.emoji ? `${setupCard.emoji} ` : ""}
              {setupCard.title}
              {setupCard.subtitle ? ` · ${setupCard.subtitle}` : ""}
            </Text>
          </View>
        ) : null}

        {/* Agent content cards */}
        {contentCards.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionHeader title="Focus" />
            {contentCards.map((c) => (
              <Card key={c.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Text style={{ fontSize: 28 }}>{c.emoji || "✦"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.text,
                        fontFamily: "Figtree_600SemiBold",
                        fontSize: 16,
                      }}
                    >
                      {c.title}
                    </Text>
                    {c.subtitle ? (
                      <Text style={{ color: colors.muted, fontSize: 13 }}>
                        {c.subtitle}
                      </Text>
                    ) : null}
                  </View>
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
                {c.progress > 0 ? (
                  <View
                    style={{
                      height: 4,
                      backgroundColor: colors.surface2,
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.min(100, c.progress)}%`,
                        height: "100%",
                        backgroundColor: c.themeColor || accent,
                      }}
                    />
                  </View>
                ) : null}
                <Pressable
                  onPress={() => completeCard.mutate(c.id)}
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: colors.surface2,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: "Figtree_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Complete
                  </Text>
                </Pressable>
              </Card>
            ))}
          </View>
        ) : null}

        {/* Right now */}
        <View>
          <SectionHeader title="Right now" />
          <ActivitySession
            active={data.activeSession}
            theme={theme}
            onSelect={(a) => setActivity.mutate(a)}
            onClear={() => clearActivity.mutate()}
          />
        </View>

        {/* Day timeline ribbon */}
        <View>
          <SectionHeader title="Day shape" />
          <DayTimeline segments={data.timeline ?? []} />
        </View>

        {/* Growth + quick log */}
        <View style={{ gap: 14 }}>
          <SectionHeader title="Growth" />
          <Card>
            <GrowthMeter
              efficiencyPct={p.efficiencyPct}
              style={p.growthStyle ?? "sprout"}
              dailyXp={p.dailyXp}
              dailyXpTarget={p.dailyXpTarget}
              theme={theme}
              reducedMotion={settingsQ.data?.reducedMotion}
            />
          </Card>
        </View>

        {/* Quick log — agent items first; hide habits while any agent item open */}
        <View style={{ gap: 10 }}>
          <SectionHeader title="Quick log" />
          {pendingAgent.hasAgent ? (
            <>
              {pendingAgent.events.map((ev) => (
                <Card key={ev.id} style={{ gap: 8 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: "Figtree_600SemiBold",
                      fontSize: 15,
                    }}
                  >
                    {ev.title}
                  </Text>
                  {ev.body ? (
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{ev.body}</Text>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => completeEvent.mutate(ev.id)}
                      style={{
                        backgroundColor: accent,
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 10,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.background,
                          fontFamily: "Figtree_600SemiBold",
                          fontSize: 13,
                        }}
                      >
                        Done
                        {ev.xpOnComplete ? ` · +${ev.xpOnComplete}` : ""}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => dismissEvent.mutate(ev.id)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ color: colors.faint }}>Dismiss</Text>
                    </Pressable>
                  </View>
                </Card>
              ))}
              {pendingAgent.reviews.map((r) => (
                <Card key={r.id} style={{ gap: 8 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: "Figtree_600SemiBold",
                      fontSize: 15,
                    }}
                  >
                    {r.prompt}
                  </Text>
                  <Pressable
                    onPress={() => completeReview.mutate(r.id)}
                    style={{
                      alignSelf: "flex-start",
                      backgroundColor: accent,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.background,
                        fontFamily: "Figtree_600SemiBold",
                        fontSize: 13,
                      }}
                    >
                      Complete review
                    </Text>
                  </Pressable>
                </Card>
              ))}
            </>
          ) : (
            (data.habits ?? []).map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                streaksEnabled={settingsQ.data?.streaksEnabled !== false}
                busy={completeHabit.isPending || undoHabit.isPending}
                onToggle={() => {
                  if (h.completedToday) undoHabit.mutate(h.id);
                  else completeHabit.mutate(h.id);
                }}
              />
            ))
          )}
        </View>

        <XpChart series={data.xpSeries7 ?? []} theme={theme} />

        {/* Up next — 15 min only */}
        <View style={{ gap: 10 }}>
          <SectionHeader
            title="Up next"
            right={
              (data.scheduled?.length ?? 0) > (data.upcoming?.length ?? 0) ? (
                <Text style={{ color: colors.faint, fontSize: 12 }}>
                  +{(data.scheduled?.length ?? 0) - (data.upcoming?.length ?? 0)}{" "}
                  later · Timeline
                </Text>
              ) : null
            }
          />
          {(data.upcoming ?? []).length === 0 ? (
            <Body>Nothing in the next 15 minutes.</Body>
          ) : (
            data.upcoming.map((c) => (
              <CardRow
                key={c.id}
                card={c}
                urgent={Boolean(c.flash && c.notifiedAt)}
                onStart={() => startCard.mutate(c.id)}
                onComplete={() => completeCard.mutate(c.id)}
              />
            ))
          )}
        </View>
      </ScrollView>

      {toast ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 24,
            alignSelf: "center",
            backgroundColor: colors.surface2,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: "Figtree_500Medium",
              fontSize: 13,
            }}
          >
            {toast}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View>
      <Label>{label}</Label>
      <Text
        style={{
          color,
          fontFamily: "JetBrainsMono_600SemiBold",
          fontSize: 16,
          marginTop: 2,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}
