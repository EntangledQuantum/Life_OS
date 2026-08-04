import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  token: "lifeos_token",
  baseUrl: "lifeos_base_url",
  dashboardCache: "lifeos_dashboard_cache",
  palette: "lifeos_palette",
} as const;

/**
 * Token storage: SecureStore on iOS/Android (Keystore-backed).
 * Never store the API token in plain AsyncStorage on native.
 * Web falls back to AsyncStorage only for Expo web UI testing.
 */
const nativeSecure = Platform.OS === "ios" || Platform.OS === "android";

async function tokenGet(): Promise<string | null> {
  if (nativeSecure) {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(KEYS.token);
  }
  return AsyncStorage.getItem(KEYS.token);
}

async function tokenSet(value: string): Promise<void> {
  if (nativeSecure) {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(KEYS.token, value);
    return;
  }
  await AsyncStorage.setItem(KEYS.token, value);
}

async function tokenDelete(): Promise<void> {
  if (nativeSecure) {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(KEYS.token);
    return;
  }
  await AsyncStorage.removeItem(KEYS.token);
}

/** API token — never log it. */
export async function getToken(): Promise<string | null> {
  try {
    return await tokenGet();
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await tokenSet(token);
  else await tokenDelete();
}

export async function getBaseUrl(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.baseUrl);
}

export async function setBaseUrl(url: string | null): Promise<void> {
  if (url) await AsyncStorage.setItem(KEYS.baseUrl, normalizeBaseUrl(url));
  else await AsyncStorage.removeItem(KEYS.baseUrl);
}

/** Palette is a device-local look, not a server setting. */
export async function getPalette(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEYS.palette);
  } catch {
    return null;
  }
}

export async function setPalette(id: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.palette, id);
}

export async function cacheDashboard(json: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.dashboardCache, json);
}

export async function readDashboardCache(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.dashboardCache);
}

/** Clear the API token (and only that). Base URL can stay for re-entry. */
export async function clearSession(): Promise<void> {
  await setToken(null);
}

/** Strip trailing slash; ensure http(s). */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

/** Soft hint when the URL looks like the Vite web UI (5173) instead of the API (8787). */
export function looksLikeWebUiPort(url: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(url));
    return u.port === "5173";
  } catch {
    return /:5173\b/.test(url);
  }
}
