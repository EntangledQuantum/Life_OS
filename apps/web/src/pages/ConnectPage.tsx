import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { api, setToken } from "@/lib/api";
import { asset } from "@/lib/deploy";

/**
 * Token entry. This replaced the old username/password form.
 *
 * There is no account here and never was — the previous login checked a pair of
 * values that defaulted to `admin` / `lifeos` and were printed in the README, so
 * it kept nobody out. The API token is a real secret the user picks, and it is
 * the same credential every client uses: browser, agent, phone.
 */
export function ConnectPage() {
  const navigate = useNavigate();
  const [token, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    // Store it first so the request picks it up, then roll back if it is wrong —
    // otherwise a bad token would linger and every later call would 401.
    setToken(trimmed);
    try {
      await api.me();
      navigate("/app", { replace: true });
    } catch (err) {
      setToken(null);
      setError(
        err instanceof Error && err.message.toLowerCase().includes("failed")
          ? "Could not reach the Life OS API. Is it running?"
          : "That token was rejected. Check API_TOKEN in your .env.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-7"
      >
        <img
          src={asset("icon.png?v=3")}
          alt=""
          className="mx-auto h-14 w-14 drop-shadow-[0_0_18px_var(--accent-glow)]"
        />
        <h1 className="mt-4 text-center text-xl font-bold tracking-tight">
          Connect to Life OS
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-[var(--muted)]">
          Paste your API token — the <code className="font-mono text-xs">API_TOKEN</code>{" "}
          value in <code className="font-mono text-xs">.env</code>. It is generated
          for you on first run and printed once in the terminal.
        </p>

        <label className="label mt-6 block" htmlFor="token">
          API token
        </label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input
            id="token"
            className="input input-icon-left font-mono text-sm"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            // Never show a real-looking token here — a placeholder that looks
            // like the answer is how shared defaults survive.
            placeholder="paste your token"
            value={token}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>

        {error && (
          <p className="mt-3 text-sm text-[#FBBF24]" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary mt-5 w-full justify-center py-2.5"
          disabled={busy || !token.trim()}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Checking…" : "Connect"}
        </button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[var(--faint)]">
          Stored in this browser only. Life OS is single-user and self-hosted —
          whoever holds the token is the owner.
        </p>
      </form>
    </div>
  );
}
