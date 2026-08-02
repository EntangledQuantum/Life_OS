import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { api, setToken } from "@/lib/api";

/**
 * Life OS is single-user and self-hosted: whoever runs the server is the admin.
 * Real multi-user auth is on hold, so rather than show a sign-in form to the one
 * person who already owns the machine, we sign in automatically with the mock
 * credentials from .env and drop straight into the app.
 *
 * The login page still exists at /login as a fallback for a customised
 * ADMIN_USER / ADMIN_PASS that the auto sign-in cannot guess.
 */
const DEFAULT_USER = import.meta.env.VITE_ADMIN_USER ?? "admin";
const DEFAULT_PASS = import.meta.env.VITE_ADMIN_PASS ?? "lifeos";

export function RequireAuth() {
  const [state, setState] = useState<"loading" | "ok" | "no">("loading");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await api.me();
        if (!cancelled) setState("ok");
        return;
      } catch {
        /* no valid session yet — try the automatic one */
      }

      try {
        const result = await api.login(DEFAULT_USER, DEFAULT_PASS);
        setToken(result.token);
        if (!cancelled) setState("ok");
      } catch {
        // Custom credentials, or the API is down. Fall back to the form.
        if (!cancelled) setState("no");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Opening Life OS…
      </div>
    );
  }
  if (state === "no") return <Navigate to="/login" replace />;
  return <Outlet />;
}
