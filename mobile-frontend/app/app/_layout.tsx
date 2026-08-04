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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
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
    </Stack>
  );
}
