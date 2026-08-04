import { Link, NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  BellOff,
  BookOpen,
  CalendarClock,
  LayoutDashboard,
  Settings,
  Target,
  CheckCircle2,
} from "lucide-react";
import { isWithinQuietHours } from "@life-os/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { asset } from "@/lib/deploy";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

const tabs = [
  { to: "/app", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/app/timeline", label: "Timeline", icon: CalendarClock },
  { to: "/app/habits", label: "Habits", icon: CheckCircle2 },
  { to: "/app/study", label: "Study", icon: BookOpen },
  { to: "/app/goals", label: "Goals", icon: Target },
  { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const { setAccentTheme } = useUiStore();
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 12000,
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
  });

  useEffect(() => {
    if (settings?.accentTheme) setAccentTheme(settings.accentTheme);
  }, [settings?.accentTheme, setAccentTheme]);

  const eff = data?.progress.efficiencyPct ?? 0;
  const pending = data?.pendingEventCount ?? 0;
  const silenced = Boolean(
    settings &&
      (settings.doNotDisturb ||
        (settings.quietHoursSilent &&
          isWithinQuietHours(settings.quietHoursStart, settings.quietHoursEnd))),
  );

  return (
    <div className="relative min-h-screen">
      {/* Layered ambient background: slow aurora + fine grain, accent-aware. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="app-aurora app-aurora-a" />
        <div className="app-aurora app-aurora-b" />
        <div className="app-aurora app-aurora-c" />
        <div className="app-grain" />
        <div className="app-vignette" />
      </div>

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[oklch(7%_0.01_260_/_0.85)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3.5">
          {/* Doubles as the way back out to the landing page. */}
          <Link
            to="/"
            className="group flex items-center gap-3.5 rounded-xl transition-opacity hover:opacity-80"
            title="Back to the Life OS home page"
          >
            <img
              src={asset("icon.png?v=3")}
              alt="Life OS"
              className="h-12 w-12 drop-shadow-[0_0_18px_var(--accent-glow)] sm:h-14 sm:w-14"
            />
            <div>
              <span className="text-xl font-bold tracking-tight sm:text-2xl">
                LIFE OS
              </span>
              <div className="font-mono text-[10px] text-[var(--faint)]">
                day → {data?.dayResetTime ?? "04:00"} reset
              </div>
            </div>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center justify-center gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-[var(--muted)] transition-colors",
                    isActive &&
                      "bg-[var(--accent-soft)] text-[var(--text)] shadow-[0_0_20px_-8px_var(--accent-glow)]",
                  )
                }
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                {t.to === "/app" && pending > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 font-mono text-[9px] font-bold text-[oklch(12%_0.02_260)]">
                    {pending}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {/* Silence should be visible — otherwise a missed reminder reads as
                a broken app rather than a setting the user chose. */}
            {silenced && (
              <Link
                to="/app/settings"
                className="chip font-mono text-[10px]"
                title={
                  settings?.doNotDisturb
                    ? "Do not disturb is on — reminders are silent"
                    : `Quiet hours (${settings?.quietHoursStart}–${settings?.quietHoursEnd}) — reminders are silent`
                }
              >
                <BellOff className="h-3 w-3" />
                {settings?.doNotDisturb ? "DND" : "quiet"}
              </Link>
            )}
            <div className="chip font-mono" title="Today efficiency vs XP target">
              {Math.round(eff)}%
              <div className="ml-1 h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${Math.min(100, eff)}%` }}
                />
              </div>
            </div>
            {/* No sign-out: Life OS is single-user and you are the admin.
                Multi-user auth is on hold — see Settings. */}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
