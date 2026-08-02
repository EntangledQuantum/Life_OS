import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "@/lib/api";
import { toast } from "sonner";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("lifeos");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.login(username, password);
      setToken(res.token);
      toast.success("Welcome back");
      navigate("/app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 30%, var(--accent-soft), transparent)",
        }}
      />
      <div className="card relative w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <img src="/icon.png" alt="" className="mx-auto h-24 w-24 drop-shadow-[0_0_28px_var(--accent-glow)]" />
          <h1 className="font-semibold mt-4 text-2xl font-bold">Sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Mock admin gate — real data behind it.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="user">
              Username
            </label>
            <input
              id="user"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="label" htmlFor="pass">
              Password
            </label>
            <input
              id="pass"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary w-full py-3"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Enter Life OS"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-[var(--faint)]">
          Default: admin / lifeos ·{" "}
          <Link to="/" className="text-[var(--muted)] underline">
            Back
          </Link>
        </p>
      </div>
    </div>
  );
}
