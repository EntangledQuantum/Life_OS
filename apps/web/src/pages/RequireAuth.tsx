import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { api, setToken } from "@/lib/api";

/**
 * Gate the app on a valid API token.
 *
 * This used to sign in automatically with `admin` / `lifeos` so the single user
 * never saw a form. That was fine while the API only listened on loopback, and
 * became a real hole the moment it started binding `0.0.0.0` for the phone:
 * anyone on the Wi-Fi could open the app and be let straight in.
 *
 * `VITE_API_TOKEN` is a dev convenience — set it and you skip the prompt on
 * your own machine. Leave it unset for any build you might serve to anything
 * other than yourself, since it bakes the secret into the bundle.
 */
const DEV_TOKEN = import.meta.env.VITE_API_TOKEN as string | undefined;

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
        /* nothing stored, or it no longer works */
      }

      if (DEV_TOKEN) {
        setToken(DEV_TOKEN);
        try {
          await api.me();
          if (!cancelled) setState("ok");
          return;
        } catch {
          setToken(null);
        }
      }

      if (!cancelled) setState("no");
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
  if (state === "no") return <Navigate to="/connect" replace />;
  return <Outlet />;
}
