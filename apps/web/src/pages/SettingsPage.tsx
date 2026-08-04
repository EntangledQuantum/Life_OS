import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useUiStore } from "@/lib/store";
import { playSound } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  ACCENT_THEMES,
  NOTIFICATION_SOUNDS,
  isWithinQuietHours,
  type AccentThemeId,
} from "@life-os/shared";
import { Play, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";

export function SettingsPage() {
  const qc = useQueryClient();
  const ui = useUiStore();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
  });

  useEffect(() => {
    if (!settings) return;
    ui.setAccentTheme(settings.accentTheme);
    ui.setCelebrationIntensity(settings.celebrationIntensity);
    ui.setReducedMotion(settings.reducedMotion);
  }, [settings]);

  const update = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (s: any) => {
      qc.setQueryData(["settings"], s);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Settings saved");
      if (s.accentTheme) ui.setAccentTheme(s.accentTheme);
      if (s.celebrationIntensity) ui.setCelebrationIntensity(s.celebrationIntensity);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportData = async () => {
    try {
      const data = await api.exportJson();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lifeos-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  };

  if (isLoading || !settings) {
    return <div className="text-[var(--muted)]">Loading settings…</div>;
  }

  const patch = (partial: Record<string, unknown>) => update.mutate(partial);

  /** Are reminders muted at this exact moment, and why? */
  const silencedNow =
    settings.doNotDisturb ||
    (settings.quietHoursSilent &&
      isWithinQuietHours(settings.quietHoursStart, settings.quietHoursEnd));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-3xl space-y-4"
    >
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--muted)]">
          Day reset, gamification feedback, appearance. Structure (habits, blocks,
          targets) is owned by your agent.
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Global day reset</h2>
        <p className="text-sm text-[var(--muted)]">
          Stats roll over at this time — not midnight. Night-owl default 04:00.
        </p>
        <div>
          <label className="label">Reset time</label>
          <input
            type="time"
            className="input max-w-xs"
            defaultValue={settings.dayResetTime}
            onBlur={(e) => patch({ dayResetTime: e.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["plannedWake", "Planned wake"],
              ["plannedSleepStart", "Sleep window start"],
              ["plannedSleepEnd", "Sleep window end"],
              ["quietHoursStart", "Quiet hours start"],
              ["quietHoursEnd", "Quiet hours end"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input
                type="time"
                className="input"
                defaultValue={(settings as any)[key]}
                onBlur={(e) => patch({ [key]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Feedback layer</h2>
        {(
          [
            ["gamificationEnabled", "Show XP / efficiency visuals"],
            ["streaksEnabled", "Streaks"],
            ["pointsEnabled", "Points"],
            ["achievementsEnabled", "Achievements"],
            ["questsEnabled", "Quests"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-4 text-sm">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={(settings as any)[key]}
              onChange={(e) => patch({ [key]: e.target.checked })}
            />
          </label>
        ))}
        <div>
          <label className="label">Celebration intensity</label>
          <select
            className="input"
            value={settings.celebrationIntensity}
            onChange={(e) =>
              patch({
                celebrationIntensity: e.target.value as "full" | "minimal" | "off",
              })
            }
          >
            <option value="full">Full</option>
            <option value="minimal">Minimal</option>
            <option value="off">Off</option>
          </select>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Appearance</h2>
        <p className="text-sm text-[var(--muted)]">Accent lives here — not the header.</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACCENT_THEMES) as AccentThemeId[]).map((id) => (
            <button
              key={id}
              type="button"
              className="btn"
              style={
                settings.accentTheme === id
                  ? {
                      borderColor: `oklch(76% 0.17 ${ACCENT_THEMES[id].hue})`,
                    }
                  : undefined
              }
              onClick={() => patch({ accentTheme: id })}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{
                  background: `oklch(76% 0.17 ${ACCENT_THEMES[id].hue})`,
                }}
              />
              {ACCENT_THEMES[id].name}
            </button>
          ))}
        </div>
        <div>
          <label className="label">Growth meter style</label>
          <p className="mb-2 text-xs text-[var(--muted)]">
            How daily XP progress is drawn. A sprout that grows, or an orb that
            fills with light — this is about nurturing progress, not hydration.
          </p>
          <div className="flex gap-2">
            {(
              [
                { id: "sprout", label: "Sprout", hint: "grows leaf by leaf" },
                { id: "orb", label: "Orb", hint: "fills with light" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                className="btn flex-col items-start gap-0.5 text-left"
                onClick={() =>
                  fetch(
                    (import.meta.env.VITE_API_URL ?? "") +
                      "/api/v1/gamification/config",
                    {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem("lifeos_token") ?? ""}`,
                      },
                      body: JSON.stringify({ growthStyle: option.id }),
                    },
                  ).then(() => {
                    qc.invalidateQueries({ queryKey: ["dashboard"] });
                    toast.success(`Growth meter: ${option.label.toLowerCase()}`);
                  })
                }
              >
                <span>{option.label}</span>
                <span className="text-[10px] text-[var(--faint)]">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between text-sm">
          <span>Reduced motion</span>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => patch({ reducedMotion: e.target.checked })}
          />
        </label>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Notifications</h2>
        <p className="text-sm text-[var(--muted)]">
          How agent reminders reach you. Sounds are generated in the browser, so
          there is nothing to download and they work offline.
        </p>

        <div>
          <label className="label">Reminder sound</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {NOTIFICATION_SOUNDS.map((sound) => {
              const active = settings.notificationSound === sound.id;
              return (
                <button
                  key={sound.id}
                  type="button"
                  onClick={() => {
                    patch({ notificationSound: sound.id });
                    // Play it as you pick it — choosing a sound blind is silly.
                    playSound(sound.id);
                  }}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] hover:bg-white/[0.04]",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {sound.id === "none" ? (
                      <VolumeX className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                    {sound.label}
                  </span>
                  <span className="text-[11px] leading-snug text-[var(--faint)]">
                    {sound.description}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn mt-2 py-1.5 text-xs"
            onClick={() => {
              if (settings.notificationSound === "none") {
                toast("Silent — reminders will still flash on screen");
                return;
              }
              // Browsers block audio until a gesture; this click is one.
              if (!playSound(settings.notificationSound)) {
                toast.error("Your browser blocked audio playback");
              }
            }}
          >
            <Play className="h-3 w-3" /> Preview
          </button>
        </div>

        <label className="flex items-start justify-between gap-4 text-sm">
          <span>
            Do not disturb
            <span className="mt-0.5 block text-[11px] text-[var(--faint)]">
              No sound, no flash, no system notification. Reminders still appear
              on the dashboard and keep pulsing — you see them when you look.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={settings.doNotDisturb}
            onChange={(e) => patch({ doNotDisturb: e.target.checked })}
          />
        </label>

        <label className="flex items-start justify-between gap-4 text-sm">
          <span>
            Silent during quiet hours
            <span className="mt-0.5 block text-[11px] text-[var(--faint)]">
              Automatically do-not-disturb between {settings.quietHoursStart} and{" "}
              {settings.quietHoursEnd}.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={settings.quietHoursSilent}
            onChange={(e) => patch({ quietHoursSilent: e.target.checked })}
          />
        </label>

        {silencedNow && (
          <p className="rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-[var(--accent)]">
            Reminders are silent right now
            {settings.doNotDisturb ? " (do not disturb)" : " (quiet hours)"}.
          </p>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Storage</h2>
        <div>
          <label className="label">Mode</label>
          <select
            className="input"
            value={settings.storageMode}
            onChange={(e) =>
              patch({ storageMode: e.target.value as "local" | "supabase" })
            }
          >
            <option value="local">Local (SQLite)</option>
            <option value="supabase">Supabase (Postgres)</option>
          </select>
        </div>
        {settings.storageMode === "supabase" && (
          <>
            <div>
              <label className="label">Supabase URL</label>
              <input
                className="input"
                defaultValue={settings.supabaseUrl ?? ""}
                onBlur={(e) => patch({ supabaseUrl: e.target.value || null })}
              />
            </div>
            <div>
              <label className="label">
                Key {settings.supabaseKeySet ? "(set)" : "(not set)"}
              </label>
              <input
                className="input"
                type="password"
                placeholder="service or anon key"
                onBlur={(e) => {
                  if (e.target.value) patch({ supabaseKey: e.target.value });
                }}
              />
            </div>
          </>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Agent webhook</h2>
        <p className="text-sm text-[var(--muted)]">
          When the user completes a card or habit, Life OS POSTs JSON to this URL
          (Hermes / OpenClaw endpoint). Optional secret header{" "}
          <code className="font-mono text-xs">X-LifeOS-Secret</code>.
        </p>
        <div>
          <label className="label">Webhook URL</label>
          <input
            className="input"
            placeholder="https://…/hooks/lifeos"
            defaultValue={settings.agentWebhookUrl ?? ""}
            onBlur={(e) =>
              patch({ agentWebhookUrl: e.target.value.trim() || null })
            }
          />
        </div>
        <div>
          <label className="label">
            Secret {settings.agentWebhookSecretSet ? "(set)" : "(optional)"}
          </label>
          <input
            className="input"
            type="password"
            placeholder="shared secret"
            onBlur={(e) => {
              if (e.target.value)
                patch({ agentWebhookSecret: e.target.value });
            }}
          />
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Database backups</h2>
        <p className="text-sm text-[var(--muted)]">
          Life OS snapshots its SQLite file into{" "}
          <code className="font-mono text-xs">data/backups/</code> on a timer,
          keeping the most recent copies and pruning the rest. Snapshots are
          taken with SQLite's own consistent-copy path, so one is safe to take
          while the app is running.
        </p>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">Automatic backups</span>
          <input
            type="checkbox"
            defaultChecked={settings.backupsEnabled}
            onChange={(e) => patch({ backupsEnabled: e.target.checked })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Every (hours)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={168}
              defaultValue={settings.backupIntervalHours}
              onBlur={(e) =>
                patch({ backupIntervalHours: Number(e.target.value) || 6 })
              }
            />
          </div>
          <div>
            <label className="label">Snapshots to keep</label>
            <input
              className="input"
              type="number"
              min={1}
              max={500}
              defaultValue={settings.backupKeep}
              onBlur={(e) => patch({ backupKeep: Number(e.target.value) || 24 })}
            />
          </div>
        </div>
        <p className="font-mono text-xs text-[var(--faint)]">
          last backup{" "}
          {settings.lastBackupAt
            ? new Date(settings.lastBackupAt).toLocaleString()
            : "— none yet"}
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Data & agents</h2>
        <button type="button" className="btn" onClick={exportData}>
          Export JSON
        </button>
        <div className="rounded-xl border border-[var(--border)] bg-black/20 p-3 font-mono text-xs text-[var(--muted)]">
          API http://127.0.0.1:8787 · MCP: pnpm mcp
          <br />
          Skill: docs/skills/life-os/SKILL.md
          <br />
          2 pinned cards + unlimited scheduled cards · agents own every setting
          <br />
          Goals are agent-set and auto-checked · no levels
        </div>
      </section>
    </motion.div>
  );
}
