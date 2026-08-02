import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useUiStore } from "@/lib/store";
import { ACCENT_THEMES, type AccentThemeId } from "@life-os/shared";
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
          <label className="label">Improvement pulse visual</label>
          <p className="mb-2 text-xs text-[var(--muted)]">
            Plant growth or water fill for daily XP target progress.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn"
              onClick={() =>
                fetch((import.meta.env.VITE_API_URL ?? "") + "/api/v1/gamification/config", {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("lifeos_token") ?? ""}`,
                  },
                  body: JSON.stringify({ nurtureStyle: "plant" }),
                }).then(() => {
                  qc.invalidateQueries({ queryKey: ["dashboard"] });
                  toast.success("Using plant visual");
                })
              }
            >
              Plant
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                fetch((import.meta.env.VITE_API_URL ?? "") + "/api/v1/gamification/config", {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("lifeos_token") ?? ""}`,
                  },
                  body: JSON.stringify({ nurtureStyle: "water" }),
                }).then(() => {
                  qc.invalidateQueries({ queryKey: ["dashboard"] });
                  toast.success("Using water visual");
                })
              }
            >
              Water
            </button>
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
          Cards max 2 · habits rebalance daily XP · no levels
        </div>
      </section>
    </motion.div>
  );
}
