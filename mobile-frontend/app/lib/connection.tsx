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
  getUsername,
  setBaseUrl,
  setToken,
  setUsername,
} from "./storage";
import { api, checkHealth, ApiError } from "./api";
import type { HealthResponse } from "./types";

type ConnectionState = {
  ready: boolean;
  configured: boolean;
  authenticated: boolean;
  baseUrl: string | null;
  username: string | null;
  health: HealthResponse | null;
  error: string | null;
  connectWithToken: (url: string, token: string) => Promise<void>;
  connectWithLogin: (
    url: string,
    username: string,
    password: string,
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshHealth: () => Promise<void>;
};

const ConnectionContext = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [baseUrl, setBaseUrlState] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [url, token, name] = await Promise.all([
          getBaseUrl(),
          getToken(),
          getUsername(),
        ]);
        setBaseUrlState(url);
        setUsernameState(name);
        if (url && token) {
          setAuthenticated(true);
          try {
            const h = await checkHealth(url);
            setHealth(h);
          } catch {
            setHealth(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const connectWithToken = useCallback(async (url: string, token: string) => {
    setError(null);
    const h = await checkHealth(url);
    if (!h.ok) throw new ApiError(0, "Server health check failed");
    await setBaseUrl(url);
    await setToken(token.trim());
    // Verify token works
    try {
      const me = await api.me();
      await setUsername(me.username);
      setUsernameState(me.username);
    } catch {
      // Bearer agent token may not expose /me the same way — still ok if dashboard works
      await setUsername("agent");
      setUsernameState("agent");
    }
    setBaseUrlState(await getBaseUrl());
    setHealth(h);
    setAuthenticated(true);
  }, []);

  const connectWithLogin = useCallback(
    async (url: string, user: string, password: string) => {
      setError(null);
      const h = await checkHealth(url);
      if (!h.ok) throw new ApiError(0, "Server health check failed");
      await setBaseUrl(url);
      const res = await api.login(user, password);
      await setToken(res.token);
      await setUsername(res.username);
      setBaseUrlState(await getBaseUrl());
      setUsernameState(res.username);
      setHealth(h);
      setAuthenticated(true);
    },
    [],
  );

  const disconnect = useCallback(async () => {
    await clearSession();
    setAuthenticated(false);
    setUsernameState(null);
    setError(null);
  }, []);

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
      username,
      health,
      error,
      connectWithToken,
      connectWithLogin,
      disconnect,
      refreshHealth,
    }),
    [
      ready,
      baseUrl,
      authenticated,
      username,
      health,
      error,
      connectWithToken,
      connectWithLogin,
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
