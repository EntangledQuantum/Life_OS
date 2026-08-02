import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  LogOut,
  Settings,
  Target,
  CheckCircle2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, setToken } from "@/lib/api";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

const tabs = [
  { to: "/app", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/app/habits", label: "Habits", icon: CheckCircle2 },
  { to: "/app/study", label: "Study", icon: BookOpen },
  { to: "/app/goals", label: "Goals", icon: Target },
  { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const navigate = useNavigate();
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

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    navigate("/login");
  };

  const eff = data?.progress.efficiencyPct ?? 0;
  const pending = data?.pendingEventCount ?? 0;

  return (
    <div className="relative min-h-screen">
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 20% -10%, var(--accent-soft), transparent),
            radial-gradient(ellipse 50% 30% at 90% 10%, oklch(40% 0.08 296 / 0.2), transparent)
          `,
        }}
      />

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[oklch(7%_0.01_260_/_0.85)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3.5">
            <img
              src="/icon.png?v=3"
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
          </div>

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
            <div className="chip font-mono" title="Today efficiency vs XP target">
              {Math.round(eff)}%
              <div className="ml-1 h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${Math.min(100, eff)}%` }}
                />
              </div>
            </div>
            <button type="button" className="btn px-2 py-2" onClick={logout} title="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
