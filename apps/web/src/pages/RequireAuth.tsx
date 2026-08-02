import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { api } from "@/lib/api";

export function RequireAuth() {
  const [state, setState] = useState<"loading" | "ok" | "no">("loading");

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(() => {
        if (!cancelled) setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("no");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Checking session…
      </div>
    );
  }
  if (state === "no") return <Navigate to="/login" replace />;
  return <Outlet />;
}
