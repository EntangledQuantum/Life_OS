import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { colors, accentColor } from "@/lib/theme";
import {
  NOTIFICATION_SOUNDS,
  type AccentThemeId,
  type NotificationSoundId,
} from "@/lib/types";
import { Body, Button, Card, Label, Loading, SectionHeader } from "@/components/ui";

export default function SettingsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const { baseUrl, username, health, disconnect, refreshHealth } =
    useConnection();
  const [msg, setMsg] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
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
  const theme = s.accentTheme ?? "nebula";
  const accent = accentColor(theme);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 18 }}
    >
      <View>
        <SectionHeader title="Connection" />
        <Card style={{ gap: 8 }}>
          <Row label="Server" value={baseUrl ?? "—"} mono />
          <Row label="User" value={username ?? "—"} />
          <Row
            label="Health"
            value={
              health?.ok
                ? `ok · ${health.storage}${health.lan ? " · LAN" : ""}`
                : "unreachable"
            }
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
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

      <View>
        <SectionHeader title="Do not disturb" />
        <Card style={{ gap: 14 }}>
          <Toggle
            label="Do not disturb"
            hint="Silence interruptions, keep reminders visible"
            value={s.doNotDisturb}
            accent={accent}
            onChange={(v) => patch.mutate({ doNotDisturb: v })}
          />
          <Toggle
            label="Quiet hours auto-silence"
            hint={`${s.quietHoursStart} – ${s.quietHoursEnd}`}
            value={s.quietHoursSilent}
            accent={accent}
            onChange={(v) => patch.mutate({ quietHoursSilent: v })}
          />
        </Card>
      </View>

      <View>
        <SectionHeader title="Notification sound" />
        <Card style={{ gap: 6 }}>
          {NOTIFICATION_SOUNDS.map((opt) => {
            const on = s.notificationSound === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() =>
                  patch.mutate({
                    notificationSound: opt.id as NotificationSoundId,
                  })
                }
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 8,
                  borderRadius: 10,
                  backgroundColor: on ? "rgba(255,255,255,0.06)" : "transparent",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: "Figtree_600SemiBold",
                      fontSize: 14,
                    }}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={{
                      color: colors.faint,
                      fontFamily: "Figtree_400Regular",
                      fontSize: 12,
                    }}
                  >
                    {opt.description}
                  </Text>
                </View>
                {on ? (
                  <Text style={{ color: accent, fontSize: 16 }}>●</Text>
                ) : null}
              </Pressable>
            );
          })}
          <Body style={{ marginTop: 4 }}>
            Native maps these ids onto system notification sounds — the id is the
            contract, not the waveform.
          </Body>
        </Card>
      </View>

      <View>
        <SectionHeader title="Appearance" />
        <Card style={{ gap: 10 }}>
          <Label>Accent theme</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(
              [
                ["nebula", "Nebula"],
                ["quantum", "Quantum"],
                ["terminal", "Terminal"],
                ["ember", "Ember"],
              ] as [AccentThemeId, string][]
            ).map(([id, name]) => {
              const on = theme === id;
              const c = accentColor(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => patch.mutate({ accentTheme: id })}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: on ? c : colors.surface2,
                  }}
                >
                  <Text
                    style={{
                      color: on ? colors.background : colors.muted,
                      fontFamily: "Figtree_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Toggle
            label="Reduced motion"
            value={s.reducedMotion}
            accent={accent}
            onChange={(v) => patch.mutate({ reducedMotion: v })}
          />
        </Card>
      </View>

      <View>
        <SectionHeader title="Surfaces" />
        <Card style={{ gap: 12 }}>
          <Toggle
            label="Streaks"
            value={s.streaksEnabled}
            accent={accent}
            onChange={(v) => patch.mutate({ streaksEnabled: v })}
          />
          <Toggle
            label="Points / XP"
            value={s.pointsEnabled}
            accent={accent}
            onChange={(v) => patch.mutate({ pointsEnabled: v })}
          />
          <Toggle
            label="Gamification"
            value={s.gamificationEnabled}
            accent={accent}
            onChange={(v) => patch.mutate({ gamificationEnabled: v })}
          />
        </Card>
      </View>

      <View>
        <SectionHeader title="Celebration" />
        <Card style={{ gap: 8 }}>
          {(["full", "minimal", "off"] as const).map((level) => {
            const on = s.celebrationIntensity === level;
            return (
              <Pressable
                key={level}
                onPress={() => patch.mutate({ celebrationIntensity: level })}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 8,
                  borderRadius: 10,
                  backgroundColor: on ? "rgba(255,255,255,0.06)" : "transparent",
                }}
              >
                <Text
                  style={{
                    color: on ? accent : colors.text,
                    fontFamily: "Figtree_600SemiBold",
                    fontSize: 14,
                    textTransform: "capitalize",
                  }}
                >
                  {level}
                </Text>
              </Pressable>
            );
          })}
        </Card>
      </View>

      <View>
        <SectionHeader title="Home screen widget" />
        <Card>
          <Body>
            Add the Life OS Status widget from your Android home screen. It shows
            pulse, efficiency, XP, habits, the day ribbon, and lets you switch the
            current activity. Requires a native Android build (not Expo Go).
            Widget data refreshes whenever the app loads the dashboard.
          </Body>
        </Card>
      </View>

      <Body style={{ textAlign: "center" }}>
        Life OS mobile · local-first · no telemetry
      </Body>

      {msg ? (
        <Text
          style={{
            textAlign: "center",
            color: colors.positive,
            fontFamily: "Figtree_500Medium",
          }}
        >
          {msg}
        </Text>
      ) : null}
    </ScrollView>
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
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.text,
            fontFamily: "Figtree_600SemiBold",
            fontSize: 14,
          }}
        >
          {label}
        </Text>
        {hint ? (
          <Text
            style={{
              color: colors.faint,
              fontFamily: "Figtree_400Regular",
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface2, true: accent }}
        thumbColor={colors.text}
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
  return (
    <View style={{ gap: 2 }}>
      <Label>{label}</Label>
      <Text
        selectable
        style={{
          color: colors.text,
          fontFamily: mono ? "JetBrainsMono_500Medium" : "Figtree_500Medium",
          fontSize: 13,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
