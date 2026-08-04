import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  token: "lifeos_token",
  baseUrl: "lifeos_base_url",
  username: "lifeos_username",
  dashboardCache: "lifeos_dashboard_cache",
} as const;

/**
 * SecureStore works on iOS/Android. On web (and any SecureStore failure) fall
 * back to AsyncStorage so Connect still works in the browser for UI testing.
 * Production mobile always uses the secure path.
 */
const useSecure =
  Platform.OS === "ios" || Platform.OS === "android";

async function secretGet(key: string): Promise<string | null> {
  if (useSecure) {
    try {
      const SecureStore = await import("expo-secure-store");
      return await SecureStore.getItemAsync(key);
    } catch {
      /* fall through */
    }
  }
  return AsyncStorage.getItem(key);
}

async function secretSet(key: string, value: string): Promise<void> {
  if (useSecure) {
    try {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.setItemAsync(key, value);
      return;
    } catch {
      /* fall through */
    }
  }
  await AsyncStorage.setItem(key, value);
}

async function secretDelete(key: string): Promise<void> {
  if (useSecure) {
    try {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.deleteItemAsync(key);
      return;
    } catch {
      /* fall through */
    }
  }
  await AsyncStorage.removeItem(key);
}

/** Token — SecureStore on native, AsyncStorage on web. Never log it. */
export async function getToken(): Promise<string | null> {
  try {
    return await secretGet(KEYS.token);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await secretSet(KEYS.token, token);
  else await secretDelete(KEYS.token);
}

export async function getBaseUrl(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.baseUrl);
}

export async function setBaseUrl(url: string | null): Promise<void> {
  if (url) await AsyncStorage.setItem(KEYS.baseUrl, normalizeBaseUrl(url));
  else await AsyncStorage.removeItem(KEYS.baseUrl);
}

export async function getUsername(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.username);
}

export async function setUsername(name: string | null): Promise<void> {
  if (name) await AsyncStorage.setItem(KEYS.username, name);
  else await AsyncStorage.removeItem(KEYS.username);
}

export async function cacheDashboard(json: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.dashboardCache, json);
}

export async function readDashboardCache(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.dashboardCache);
}

export async function clearSession(): Promise<void> {
  await setToken(null);
  await setUsername(null);
}

/** Strip trailing slash; ensure http(s). */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

/**
 * Soft hint when the URL looks like the Vite web UI (5173) instead of the API (8787).
 */
export function looksLikeWebUiPort(url: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(url));
    return u.port === "5173";
  } catch {
    return /:5173\b/.test(url);
  }
}
