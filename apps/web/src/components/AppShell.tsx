import { Link, NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  BellOff,
  CalendarClock,
  LayoutDashboard,
  Settings,
  Target,
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
  /**
   * The badge sits on Timeline, not Overview: agent-queued work lives there
   * now. What is landing in the next few minutes is already the top of the
   * Quick log, and a number on the tab you are looking at says nothing.
   */
  const pending = data?.tasks.filter((t) => t.status === "active").length ?? 0;
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
              className="h-9 w-9 drop-shadow-[0_0_18px_var(--accent-glow)] sm:h-12 sm:w-12"
            />
            {/*
              The wordmark and the reset line are the first things to go on a
              narrow screen. Six labelled tabs plus a logo plus a readout wrapped
              the header onto three rows on a phone, which pushed the day itself
              below the fold — the one thing the page is for.
            */}
            <div className="hidden sm:block">
              <span className="text-xl font-bold tracking-tight sm:text-2xl">
                LIFE OS
              </span>
              <div className="font-mono text-[10px] text-[var(--faint)]">
                day → {data?.dayResetTime ?? "04:00"} reset
              </div>
            </div>
          </Link>

          <nav className="flex flex-1 items-center justify-center gap-0.5 sm:gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-1.5 rounded-xl px-2 py-2 text-sm text-[var(--muted)] transition-colors sm:px-3",
                    isActive &&
                      "bg-[var(--accent-soft)] text-[var(--text)] shadow-[0_0_20px_-8px_var(--accent-glow)]",
                  )
                }
              >
                <t.icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                {/* Icons alone below `sm` — the labels are what wrapped. */}
                <span className="hidden sm:inline">{t.label}</span>
                {t.to === "/app/timeline" && pending > 0 && (
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

      {/*
        1152px was a reading width, and it was right when every page was a
        column of text and rows. Overview is a board now — the day as cards
        beside the hero, the agent's two cards under it — and at 1152 those come
        out 326px each, which is a row wearing a card's clothes. The pages that
        are still prose cap themselves.
      */}
      <main className="relative mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
