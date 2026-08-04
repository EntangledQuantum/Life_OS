import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  getBaseUrl,
  getToken,
  setBaseUrl,
  setToken,
} from "./storage";
import {
  checkHealth,
  validateToken,
  setUnauthorizedHandler,
  ApiError,
} from "./api";
import type { HealthResponse } from "./types";

type ConnectionState = {
  ready: boolean;
  configured: boolean;
  authenticated: boolean;
  baseUrl: string | null;
  health: HealthResponse | null;
  error: string | null;
  /** Server address + API token. Validates with GET /api/v1/auth/me. */
  connectWithToken: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshHealth: () => Promise<void>;
};

const ConnectionContext = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [baseUrl, setBaseUrlState] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forceLogout = useCallback(async () => {
    await clearSession();
    setAuthenticated(false);
    setError(null);
  }, []);

  // Any 401 from the API → clear token, show connect again. No retry loop.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void forceLogout();
    });
    return () => setUnauthorizedHandler(null);
  }, [forceLogout]);

  useEffect(() => {
    (async () => {
      try {
        const [url, token] = await Promise.all([getBaseUrl(), getToken()]);
        setBaseUrlState(url);
        if (!url || !token) return;

        // Re-validate stored token — do not enter the app on a blind cache hit.
        try {
          const check = await validateToken(url, token);
          if (!check.ok) {
            await clearSession();
            return;
          }
          setAuthenticated(true);
          try {
            setHealth(await checkHealth(url));
          } catch {
            setHealth(null);
          }
        } catch {
          // Server down — keep token, show app with offline cache if possible
          setAuthenticated(true);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const connectWithToken = useCallback(async (url: string, token: string) => {
    setError(null);
    const trimmed = token.trim();
    if (!trimmed) throw new Error("Paste your API_TOKEN from the Life OS .env");

    const h = await checkHealth(url);
    if (!h.ok) throw new ApiError(0, "Server health check failed");

    // Validate before storing permanently as "authenticated"
    const check = await validateToken(url, trimmed);
    if (!check.ok) {
      throw new ApiError(401, "Wrong API token");
    }

    await setBaseUrl(url);
    await setToken(trimmed);
    setBaseUrlState(await getBaseUrl());
    setHealth(h);
    setAuthenticated(true);
  }, []);

  const disconnect = useCallback(async () => {
    await forceLogout();
  }, [forceLogout]);

  const refreshHealth = useCallback(async () => {
    const url = await getBaseUrl();
    if (!url) return;
    try {
      const h = await checkHealth(url);
      setHealth(h);
      setError(null);
    } catch (e) {
      setHealth(null);
      setError(e instanceof Error ? e.message : "Unreachable");
    }
  }, []);

  const value = useMemo(
    () => ({
      ready,
      configured: Boolean(baseUrl),
      authenticated,
      baseUrl,
      health,
      error,
      connectWithToken,
      disconnect,
      refreshHealth,
    }),
    [
      ready,
      baseUrl,
      authenticated,
      health,
      error,
      connectWithToken,
      disconnect,
      refreshHealth,
    ],
  );

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionState {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnection outside provider");
  return ctx;
}
