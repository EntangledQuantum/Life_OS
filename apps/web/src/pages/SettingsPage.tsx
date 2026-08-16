import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useUiStore } from "@/lib/store";
import {
  fireReminderAlert,
  notificationPermission,
  playSound,
  requestNotificationPermission,
} from "@/lib/notify";
import { PairPhone } from "@/components/PairPhone";
import { cn } from "@/lib/utils";
import {
  ACCENT_THEMES,
  NOTIFICATION_SOUNDS,
  isWithinQuietHours,
  type AccentThemeId,
} from "@life-os/shared";
import { Bell, BellOff, Check, Play, Volume2, VolumeX } from "lucide-react";
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

      {/* First, because getting the app on your phone is the first thing
          anyone wants from this page. */}
      <PairPhone />

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
                /*
                 * This used to fire a hand-built fetch and never look at the
                 * response, so it congratulated you on a change the server had
                 * rejected — and the picker snapped back on the next refetch
                 * with nothing to explain why.
                 */
                onClick={() =>
                  api
                    .updateGamificationConfig({ growthStyle: option.id })
                    .then(() => {
                      qc.invalidateQueries({ queryKey: ["dashboard"] });
                      toast.success(
                        `Growth meter: ${option.label.toLowerCase()}`,
                      );
                    })
                    .catch((e: Error) => toast.error(e.message))
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

        <SystemNotifications />

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

        <div>
          <label className="label" htmlFor="reminder-lead">
            Tell me this far ahead
          </label>
          <select
            id="reminder-lead"
            className="input"
            value={settings.reminderLeadMinutes}
            onChange={(e) =>
              patch({ reminderLeadMinutes: Number(e.target.value) })
            }
          >
            {[0, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "At the time itself" : `${m} minutes before`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-[var(--faint)]">
            The same window decides what reaches Quick log — being told about a
            thing and having it on your plate are the same moment.
          </p>
        </div>

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

      <WebhookTargets />

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

/**
 * Where completions are delivered.
 *
 * This is normally the agent's job — it registers itself over MCP with
 * `lifeos_add_webhook_target`. The UI exists so the user can see who is
 * listening, prove a target works, and find out when one has been quietly
 * failing. Secrets go in and never come back out: the API returns `secretSet`,
 * never the value.
 */
function WebhookTargets() {
  const qc = useQueryClient();
  const { data: targets = [] } = useQuery({
    queryKey: ["webhook-targets"],
    queryFn: api.webhookTargets,
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: api.webhookDeliveries,
    refetchInterval: 20_000,
  });

  const [form, setForm] = useState({
    name: "",
    url: "",
    preset: "generic",
    secret: "",
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["webhook-targets"] });
    qc.invalidateQueries({ queryKey: ["webhook-deliveries"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createWebhookTarget({
        name: form.name || form.preset,
        url: form.url,
        preset: form.preset,
        secret: form.secret || null,
      }),
    onSuccess: () => {
      setForm({ name: "", url: "", preset: "generic", secret: "" });
      invalidate();
      toast.success("Target added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWebhookTarget(id),
    onSuccess: invalidate,
  });

  const test = useMutation({
    mutationFn: (id: string) => api.testWebhookTarget(id),
    onSuccess: (res) => {
      invalidate();
      if (res.ok) toast.success(`Delivered · HTTP ${res.status}`);
      else toast.error(res.error ?? `Failed · HTTP ${res.status ?? "?"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const failing = deliveries.filter((d) => d.status === "failed").length;

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Agent webhooks</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Where Life OS tells your agent that you finished something. Your agent
          can register itself over MCP; this is here so you can see who is
          listening and whether it is actually working.
        </p>
      </div>

      {targets.length > 0 && (
        <ul className="space-y-2">
          {targets.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="chip font-mono text-[10px]">{t.preset}</span>
                  {!t.active && <span className="chip text-[10px]">paused</span>}
                  {!t.secretSet && t.preset !== "generic" && (
                    <span className="chip text-[10px] text-[#FBBF24]">no secret</span>
                  )}
                </div>
                <div className="truncate font-mono text-[11px] text-[var(--faint)]">
                  {t.url}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--faint)]">
                  {t.events.length === 0
                    ? "every event"
                    : t.events.join(" · ")}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn py-1.5 text-xs"
                  disabled={test.isPending}
                  onClick={() => test.mutate(t.id)}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="btn py-1.5 text-xs"
                  onClick={() => remove.mutate(t.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder="Name (Hermes, OpenClaw…)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          className="input"
          value={form.preset}
          onChange={(e) => setForm({ ...form, preset: e.target.value })}
        >
          <option value="generic">Generic (X-LifeOS-Secret)</option>
          <option value="hermes">Hermes (HMAC signature)</option>
          <option value="openclaw">OpenClaw (bearer token)</option>
        </select>
        <input
          className="input sm:col-span-2"
          placeholder={
            form.preset === "openclaw"
              ? "http://127.0.0.1:18789/hooks/wake"
              : form.preset === "hermes"
                ? "http://127.0.0.1:8644/webhooks/lifeos"
                : "https://…/hooks/lifeos"
          }
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
        />
        <input
          className="input sm:col-span-2"
          type="password"
          placeholder={
            form.preset === "openclaw"
              ? "hooks.token"
              : form.preset === "hermes"
                ? "route secret (required — Hermes 401s without it)"
                : "shared secret (optional)"
          }
          value={form.secret}
          onChange={(e) => setForm({ ...form, secret: e.target.value })}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!form.url || create.isPending}
        onClick={() => create.mutate()}
      >
        Add target
      </button>

      {deliveries.length > 0 && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="label">Recent deliveries</span>
            {failing > 0 && (
              <span className="font-mono text-[11px] text-[#FBBF24]">
                {failing} failing
              </span>
            )}
          </div>
          <ul className="space-y-1 font-mono text-[11px]">
            {deliveries.slice(0, 6).map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    d.status === "delivered" ? "bg-[#34D399]" : "bg-[#F87171]",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
                  {d.event}
                </span>
                <span className="text-[var(--faint)]">
                  {d.responseStatus ?? d.error ?? d.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * System notification permission.
 *
 * This exists as a control because permission cannot be requested any other
 * way. It used to be asked for from a mount effect, which browsers refuse
 * without a user gesture — silently. Permission stayed "default" forever, every
 * OS notification quietly failed, and there was nothing in the console to say
 * so. A button is a gesture.
 *
 * The test button is not decoration either: "did that work" is otherwise
 * unanswerable until a reminder happens to come due.
 */
function SystemNotifications() {
  const [permission, setPermission] = useState(() => notificationPermission());
  const [asking, setAsking] = useState(false);

  if (permission === "unsupported") {
    return (
      <div className="rounded-xl border border-[var(--border)] px-3.5 py-3 text-sm text-[var(--muted)]">
        This browser has no notification API. Reminders will still chime and
        flash while the tab is open.
      </div>
    );
  }

  const granted = permission === "granted";
  const denied = permission === "denied";

  return (
    <div className="rounded-xl border border-[var(--border)] px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {granted ? (
              <Bell className="h-3.5 w-3.5 text-[#34D399]" />
            ) : (
              <BellOff className="h-3.5 w-3.5 text-[var(--faint)]" />
            )}
            System notifications
          </div>
          <p className="mt-1 text-[11px] leading-snug text-[var(--faint)]">
            {granted
              ? "Reminders reach you even when this tab is in the background."
              : denied
                ? "Blocked. Your browser will not ask again — allow notifications for this site in its address-bar settings."
                : "Off. Without this, reminders only land while you are looking at the tab."}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {!granted && !denied && (
            <button
              type="button"
              className="btn btn-primary py-1.5 text-xs"
              disabled={asking}
              onClick={async () => {
                setAsking(true);
                // This click is the gesture the browser requires.
                const result = await requestNotificationPermission();
                setPermission(result);
                setAsking(false);
                if (result === "granted") toast.success("Notifications enabled");
                else if (result === "denied") toast.error("Notifications blocked");
              }}
            >
              <Check className="h-3 w-3" /> Enable
            </button>
          )}
          {granted && (
            <button
              type="button"
              className="btn py-1.5 text-xs"
              onClick={() =>
                fireReminderAlert({
                  title: "Life OS",
                  body: "This is what a reminder looks like.",
                  sound: true,
                  flash: true,
                  soundId: "chime",
                  silent: false,
                  tag: "lifeos-test",
                })
              }
            >
              <Play className="h-3 w-3" /> Test
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
