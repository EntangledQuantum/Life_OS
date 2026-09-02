import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { fireTestNotification } from "@/lib/notifications";
import {
  PALETTES,
  PALETTE_IDS,
  font,
  radius,
  rgba,
  type PaletteId,
} from "@/lib/theme";
import { useTheme } from "@/lib/theme-provider";
import {
  NOTIFICATION_SOUNDS,
  type AccentThemeId,
  type GrowthStyle,
  type NotificationSoundId,
} from "@/lib/types";
import { useLayout } from "@/lib/responsive";
import { DayGraphic } from "@/components/day-graphic";
import {
  Body,
  Button,
  Card,
  Label,
  Loading,
  PageBody,
  SectionHeader,
  TwoPane,
} from "@/components/ui";
import { SwipeTabs } from "@/components/swipe-tabs";

export default function SettingsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const { t, palette, choose } = useTheme();
  const { gutter } = useLayout();
  const { baseUrl, health, disconnect, refreshHealth } = useConnection();
  const [msg, setMsg] = useState<string | null>(null);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: api.settings });

  const configQ = useQuery({
    queryKey: ["gamification"],
    queryFn: api.gamificationConfig,
    staleTime: 30_000,
  });

  const patchConfig = useMutation({
    mutationFn: (body: { growthStyle: GrowthStyle }) =>
      api.updateGamificationConfig(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gamification"] });
      // The dashboard carries growthStyle in `progress`, so it has to refetch.
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setMsg("Saved");
      setTimeout(() => setMsg(null), 1500);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateSettings(body as never),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setMsg("Saved");
      setTimeout(() => setMsg(null), 1500);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (settingsQ.isLoading || !settingsQ.data) return <Loading />;
  const s = settingsQ.data;

  return (
    <SwipeTabs index={5}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ padding: gutter, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        <PageBody gap={22}>
          <TwoPane
            gap={22}
            left={
              <>
                {/* --------------------------------------------------- growth meter */}
                <View>
                  <SectionHeader title="How the day is drawn" />
                  <Card style={{ gap: 14 }}>
                    <Body>
                      Bloom, Arc and Rings read the same day and differ only in
                      shape. Sprout and Orb show today against target and
                      nothing else — simpler on purpose.
                    </Body>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                      {(
                        [
                          ["bloom", "Bloom", "a petal per habit"],
                          ["arc", "Arc", "the day as a horizon"],
                          ["rings", "Rings", "one ring per week"],
                          ["sprout", "Sprout", "a plant that grows"],
                          ["orb", "Orb", "fills with light"],
                        ] as [GrowthStyle, string, string][]
                      ).map(([id, name, hint]) => (
                        <GrowthChoice
                          key={id}
                          id={id}
                          name={name}
                          hint={hint}
                          selected={configQ.data?.growthStyle === id}
                          busy={patchConfig.isPending}
                          reducedMotion={s.reducedMotion}
                          onPress={() => {
                            if (configQ.data?.growthStyle === id) return;
                            void Haptics.selectionAsync();
                            patchConfig.mutate({ growthStyle: id });
                          }}
                        />
                      ))}
                    </View>
                  </Card>
                </View>

                {/* ------------------------------------------------------ appearance */}
                <View>
                  <SectionHeader title="Theme" />
                  <Card style={{ gap: 14 }}>
                    <Body>
                      This palette is stored on this phone only — the web app keeps its
                      own accent.
                    </Body>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {PALETTE_IDS.map((id) => (
                        <Swatch
                          key={id}
                          id={id}
                          selected={palette === id}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            choose(id);
                          }}
                        />
                      ))}
                    </View>

                    <Toggle
                      label="Reduced motion"
                      hint="Stops the meter breathing and the confetti"
                      value={s.reducedMotion}
                      accent={t.accent}
                      onChange={(v) => patch.mutate({ reducedMotion: v })}
                    />
                  </Card>
                </View>

                {/* --------------------------------------------------------- silence */}
                <View>
                  <SectionHeader title="Do not disturb" />
                  <Card style={{ gap: 14 }}>
                    <Toggle
                      label="Do not disturb"
                      hint="Silences the interruption, not the information"
                      value={s.doNotDisturb}
                      accent={t.accent}
                      onChange={(v) => patch.mutate({ doNotDisturb: v })}
                    />
                    <Toggle
                      label="Quiet hours auto-silence"
                      hint={`${s.quietHoursStart} – ${s.quietHoursEnd}`}
                      value={s.quietHoursSilent}
                      accent={t.accent}
                      onChange={(v) => patch.mutate({ quietHoursSilent: v })}
                    />
                  </Card>
                </View>

                <View>
                  <SectionHeader title="Tell me this far ahead" />
                  <Card style={{ gap: 10 }}>
                    <Body>
                      The same window decides what reaches Quick log — being told
                      about a thing and having it on your plate are the same
                      moment.
                    </Body>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {[0, 5, 10, 15, 30, 60].map((m) => {
                        const on = (s.reminderLeadMinutes ?? 15) === m;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => {
                              void Haptics.selectionAsync();
                              patch.mutate({ reminderLeadMinutes: m });
                            }}
                            style={{
                              paddingHorizontal: 13,
                              paddingVertical: 8,
                              borderRadius: radius.pill,
                              backgroundColor: on ? rgba(t.accent, 0.2) : t.surface2,
                              borderWidth: 1,
                              borderColor: on ? t.accent : "transparent",
                            }}
                          >
                            <Text
                              style={{
                                color: on ? t.accent : t.muted,
                                fontFamily: font.mono,
                                fontSize: 13,
                              }}
                            >
                              {m === 0 ? "on time" : `${m}m`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </Card>
                </View>

                <View>
                  <SectionHeader title="Notification sound" />
                  <Card style={{ gap: 2 }}>
                    {NOTIFICATION_SOUNDS.map((opt) => (
                      <Option
                        key={opt.id}
                        title={opt.label}
                        hint={opt.description}
                        selected={s.notificationSound === opt.id}
                        accent={t.accent}
                        onPress={() =>
                          patch.mutate({ notificationSound: opt.id as NotificationSoundId })
                        }
                      />
                    ))}
                    {/*
                      The only honest preview. On Android the channel owns the
                      sound and the OS plays it — nothing in JS can audition
                      that, so the way to hear marimba is to send a real
                      notification. It doubles as the answer to "do
                      notifications even work on this phone".
                    */}
                    <Button
                      title="Send a test notification"
                      variant="soft"
                      onPress={() => {
                        void fireTestNotification(
                          (s.notificationSound ?? "chime") as NotificationSoundId,
                        );
                      }}
                      style={{ marginTop: 10 }}
                    />
                  </Card>
                </View>

              </>
            }
            right={
              <>
                <View>
                  <SectionHeader title="Celebration" />
                  <Card style={{ gap: 2 }}>
                    {(
                      [
                        ["full", "Full", "Confetti, glow, the lot"],
                        ["minimal", "Minimal", "Restrained — still unmissable"],
                        ["off", "Off", "No celebration screen at all"],
                      ] as const
                    ).map(([level, title, hint]) => (
                      <Option
                        key={level}
                        title={title}
                        hint={hint}
                        selected={s.celebrationIntensity === level}
                        accent={t.accent}
                        onPress={() => patch.mutate({ celebrationIntensity: level })}
                      />
                    ))}
                  </Card>
                </View>

                {/* -------------------------------------------------------- surfaces */}
                <View>
                  <SectionHeader title="Surfaces" />
                  <Card style={{ gap: 14 }}>
                    <Toggle
                      label="Streaks"
                      value={s.streaksEnabled}
                      accent={t.accent}
                      onChange={(v) => patch.mutate({ streaksEnabled: v })}
                    />
                    <Toggle
                      label="Points / XP"
                      value={s.pointsEnabled}
                      accent={t.accent}
                      onChange={(v) => patch.mutate({ pointsEnabled: v })}
                    />
                    <Toggle
                      label="Gamification"
                      value={s.gamificationEnabled}
                      accent={t.accent}
                      onChange={(v) => patch.mutate({ gamificationEnabled: v })}
                    />
                  </Card>
                </View>

                {/* ------------------------------------------------------ connection */}
                <View>
                  <SectionHeader title="Connection" />
                  <Card style={{ gap: 10 }}>
                    <Row label="Server" value={baseUrl ?? "—"} mono />
                    <Row label="Auth" value="API token · secure store" />
                    <Row
                      label="Health"
                      value={
                        health?.ok
                          ? `ok · ${health.storage}${health.lan ? " · LAN" : ""}`
                          : "unreachable"
                      }
                    />
                    <Body>
                      Disconnect clears the token from the secure store. There is no
                      username/password login.
                    </Body>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                      <Button
                        title="Recheck"
                        variant="soft"
                        onPress={() => void refreshHealth()}
                        style={{ flex: 1 }}
                      />
                      <Button
                        title="Disconnect"
                        variant="ghost"
                        onPress={async () => {
                          await disconnect();
                          router.replace("/connect");
                        }}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </Card>
                </View>

                {/* ------------------------------------------------- web-side accent */}
                <View>
                  <SectionHeader title="Web app accent" />
                  <Card style={{ gap: 10 }}>
                    <Body>Only affects the browser client, not this phone.</Body>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {(
                        [
                          ["nebula", "Nebula"],
                          ["quantum", "Quantum"],
                          ["terminal", "Terminal"],
                          ["ember", "Ember"],
                        ] as [AccentThemeId, string][]
                      ).map(([id, name]) => {
                        const on = s.accentTheme === id;
                        return (
                          <Pressable
                            key={id}
                            onPress={() => patch.mutate({ accentTheme: id })}
                            style={{
                              paddingHorizontal: 13,
                              paddingVertical: 8,
                              borderRadius: radius.pill,
                              backgroundColor: on ? rgba(t.accent, 0.2) : t.surface2,
                              borderWidth: 1,
                              borderColor: on ? t.accent : "transparent",
                            }}
                          >
                            <Text
                              style={{
                                color: on ? t.accent : t.muted,
                                fontFamily: font.bodySemi,
                                fontSize: 13,
                              }}
                            >
                              {name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </Card>
                </View>

                <View>
                  <SectionHeader title="Home screen widget" />
                  <Card>
                    <Body>
                      Add the Life OS Status widget from your Android home screen. It
                      shows pulse, efficiency, XP, habits and the day ribbon, and lets
                      you switch the current activity. Needs a native Android build —
                      not Expo Go. Data refreshes whenever the app loads the dashboard.
                    </Body>
                  </Card>
                </View>
              </>
            }
          />

          <Body style={{ textAlign: "center" }}>
            Life OS mobile · local-first · no telemetry
          </Body>

          {msg ? (
            <Text
              style={{
                textAlign: "center",
                color: t.positive,
                fontFamily: font.bodyMedium,
              }}
            >
              {msg}
            </Text>
          ) : null}
        </PageBody>
      </ScrollView>
    </SwipeTabs>
  );
}

/* --------------------------------------------------------------- pieces */

/**
 * A live preview you pick by tapping it. A sample percentage rather than the
 * real one, so both tiles look the same and you are comparing the drawing
 * rather than the day.
 */
/** Six habits, four closed — enough for the three styles to look different. */
const PREVIEW_HABITS = [
  "#5B8CFF",
  "#34D399",
  "#A78BFA",
  "#FBBF24",
  "#F472B6",
  "#22D3EE",
].map((themeColor, i) => ({
  id: `preview-${i}`,
  completedToday: i < 4,
  themeColor,
})) as never;

const PREVIEW_HISTORY = Array.from({ length: 21 }, (_, i) => 40 + i * 2);

function GrowthChoice({
  id,
  name,
  hint,
  selected,
  busy,
  reducedMotion,
  onPress,
}: {
  id: GrowthStyle;
  name: string;
  hint: string;
  selected: boolean;
  busy: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const t = useTheme().t;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 8,
        paddingVertical: 14,
        borderRadius: radius.md,
        backgroundColor: selected ? rgba(t.accent, 0.12) : t.surface2,
        borderWidth: 1.5,
        borderColor: selected ? t.accent : "transparent",
        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
        borderCurve: "continuous",
      })}
    >
      {/*
        A preview with plausible data, so the three are compared as pictures
        rather than as words. Four of six petals filled reads as a real day.
      */}
      <DayGraphic
        style={id}
        efficiencyPct={62}
        habits={PREVIEW_HABITS}
        agenda={[]}
        history={PREVIEW_HISTORY}
        dayProgress={0.62}
        size={98}
      />
      <Text
        style={{
          color: selected ? t.accent : t.text,
          fontFamily: font.bodySemi,
          fontSize: 14,
        }}
      >
        {name}
      </Text>
      <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 11 }}>
        {hint}
      </Text>
    </Pressable>
  );
}

function Swatch({
  id,
  selected,
  onPress,
}: {
  id: PaletteId;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme().t;
  const p = PALETTES[id];
  return (
    <Pressable onPress={onPress} style={{ alignItems: "center", gap: 6, width: 64 }}>
      <LinearGradient
        colors={[p.accent2, p.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? t.text : "rgba(255,255,255,0.12)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <Text style={{ color: p.onAccent, fontSize: 16, fontFamily: font.bodySemi }}>
            ✓
          </Text>
        ) : null}
      </LinearGradient>
      <Text
        style={{
          color: selected ? t.text : t.faint,
          fontFamily: font.bodyMedium,
          fontSize: 11,
        }}
        numberOfLines={1}
      >
        {p.name}
      </Text>
    </Pressable>
  );
}

function Option({
  title,
  hint,
  selected,
  accent,
  onPress,
}: {
  title: string;
  hint?: string;
  selected: boolean;
  accent: string;
  onPress: () => void;
}) {
  const t = useTheme().t;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 10,
        borderRadius: radius.sm,
        backgroundColor: selected ? rgba(accent, 0.12) : "transparent",
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: selected ? accent : t.text,
            fontFamily: font.bodySemi,
            fontSize: 14,
          }}
        >
          {title}
        </Text>
        {hint ? (
          <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 12, marginTop: 1 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 2,
          borderColor: selected ? accent : t.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  accent,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  accent: string;
}) {
  const t = useTheme().t;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontFamily: font.bodySemi, fontSize: 14 }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 12, marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: t.surface2, true: accent }}
        thumbColor={t.text}
      />
    </View>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const t = useTheme().t;
  return (
    <View style={{ gap: 3 }}>
      <Label>{label}</Label>
      <Text
        selectable
        style={{
          color: t.text,
          fontFamily: mono ? font.mono : font.bodyMedium,
          fontSize: 13,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
