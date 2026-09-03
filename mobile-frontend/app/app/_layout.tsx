import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useFonts,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from "@expo-google-fonts/jetbrains-mono";
import * as SystemUI from "expo-system-ui";
import { ConnectionProvider, useConnection } from "@/lib/connection";
import { ThemeProvider, useTokens } from "@/lib/theme-provider";
import { font } from "@/lib/theme";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

/**
 * `networkMode: "always"` is the important line here.
 *
 * React Query's default is `"online"`: if its `onlineManager` believes the
 * device is offline it does not run the query at all — it *pauses* it, leaving
 * `status: "pending"`, `fetchStatus: "paused"` and `error: null` for as long as
 * that lasts. Every screen then shows its spinner with nothing to report and
 * nothing to retry, which is exactly the "it just keeps loading forever" this
 * app could get stuck in.
 *
 * Two reasons that default is wrong for Life OS specifically:
 *
 * - `onlineManager` is a browser thing. In React Native it is not wired to
 *   NetInfo unless you do it yourself, so what it believes about the network is
 *   not a measurement of anything.
 * - Even a correct answer would be the wrong question. Life OS lives on your
 *   own machine, usually over the LAN. A phone with no internet at all can
 *   reach it perfectly well, and a phone with excellent internet cannot reach it
 *   if the laptop is asleep. "Online" does not predict either case.
 *
 * So: always attempt, and let a real failure be a real error. That is what the
 * timeouts in `lib/api.ts` and the panel in `Loading` are for.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      networkMode: "always",
      refetchOnWindowFocus: true,
    },
    mutations: {
      networkMode: "always",
    },
  },
});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Outfit_600SemiBold,
    Outfit_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ConnectionProvider>
          <StatusBar style="light" />
          <RootNav />
        </ConnectionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootNav() {
  const { ready, authenticated } = useConnection();
  const t = useTokens();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg);
  }, [t.bg]);

  useEffect(() => {
    if (!ready) return;
    const onConnect = segments[0] === "connect";
    /*
     * `/pair` is exempt from both redirects.
     *
     * It is reached from a QR deep link, and the phone is usually *already*
     * connected when that happens — re-pairing to a new address is the whole
     * point. The "authenticated, so go to the tabs" rule was throwing the user
     * out of it before the code could be read, which made the link look
     * completely dead: the app opened, and landed on Today.
     */
    const onPair = segments[0] === "pair";
    if (onPair) return;

    if (!authenticated && !onConnect) {
      router.replace("/connect");
    } else if (authenticated && onConnect) {
      router.replace("/(tabs)");
    }
  }, [ready, authenticated, segments, router]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerTitleStyle: { fontFamily: font.title },
        contentStyle: { backgroundColor: t.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="connect"
        options={{ headerShown: false, animation: "fade" }}
      />
      <Stack.Screen
        name="pair"
        options={{ headerShown: false, animation: "fade" }}
      />
    </Stack>
  );
}
