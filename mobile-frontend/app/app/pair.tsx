import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, ProtocolError, claimPairingCode } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { Body, Button, Title } from "@/components/ui";
import { UpdateRequired } from "@/components/update-required";

/**
 * Finish a QR pairing.
 *
 * Its own route, and that is the point. This used to live on the connect
 * screen, which the root layout redirects **away from** the moment you are
 * authenticated — so tapping the link on an already-connected phone opened the
 * app, landed on `/connect`, and bounced straight to Today before the code was
 * ever read. From the outside the link did nothing at all.
 *
 * Expo Router turns `lifeos://pair?code=…&url=…` into this screen with those
 * query params, for a cold start and a warm one alike. There is no
 * `Linking.getInitialURL` here because the router has already done that work.
 */
export default function PairScreen() {
  const t = useTokens();
  const router = useRouter();
  const { connectWithToken } = useConnection();
  const params = useLocalSearchParams<{ code?: string; url?: string }>();

  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState<string | null>(null);
  const [outdated, setOutdated] = useState<ProtocolError | null>(null);
  /** Guards against the effect running twice — the code burns on first use. */
  const attempted = useRef(false);

  const code = typeof params.code === "string" ? params.code : "";
  const url = typeof params.url === "string" ? params.url : "";

  const run = useCallback(async () => {
    if (!code || !url) {
      setState("failed");
      setMessage(
        "This link is missing its code. Open Life OS on your computer, go to Settings, and scan the QR again.",
      );
      return;
    }

    setState("working");
    setMessage(null);
    try {
      const claimed = await claimPairingCode(url, code);
      await connectWithToken(claimed.baseUrl, claimed.token);
      setState("done");
      router.replace("/(tabs)");
    } catch (e) {
      if (e instanceof ProtocolError) {
        setOutdated(e);
        return;
      }
      setState("failed");
      setMessage(
        e instanceof ApiError && e.status === 0
          ? `Could not reach ${url}. Is your phone on the same Wi-Fi, and is Life OS running?`
          : e instanceof Error
            ? e.message
            : "Pairing failed",
      );
    }
  }, [code, url, connectWithToken, router]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void run();
  }, [run]);

  if (outdated) return <UpdateRequired error={outdated} />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        padding: 24,
        gap: 18,
        flexGrow: 1,
        justifyContent: "center",
        width: "100%",
        maxWidth: 520,
        alignSelf: "center",
      }}
    >
      <Text style={{ fontSize: 44, color: t.accent }}>◈</Text>

      {state === "working" && (
        <>
          <Title>Connecting…</Title>
          <Body>Trading your code for this instance&apos;s access token.</Body>
          <ActivityIndicator color={t.accent} style={{ alignSelf: "flex-start" }} />
        </>
      )}

      {state === "done" && (
        <>
          <Title>Connected</Title>
          <Body>Taking you to today.</Body>
        </>
      )}

      {state === "failed" && (
        <>
          <Title>That didn&apos;t work</Title>
          {/*
            Say what went wrong, in the words of the thing that failed. A
            spinner that stops and a screen that looks unchanged is the worst
            possible answer — it leaves you with nothing to act on.
          */}
          <View
            style={{
              backgroundColor: rgba(t.warning, 0.1),
              borderColor: rgba(t.warning, 0.35),
              borderWidth: 1,
              borderRadius: radius.md,
              padding: 14,
            }}
          >
            <Text
              selectable
              style={{
                color: t.warning,
                fontFamily: font.bodyMedium,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              {message}
            </Text>
          </View>

          {url ? (
            <Text
              selectable
              style={{ color: t.faint, fontFamily: font.mono, fontSize: 12 }}
            >
              server: {url}
            </Text>
          ) : null}

          <View style={{ gap: 10 }}>
            <Button
              title="Try again"
              onPress={() => {
                attempted.current = true;
                void run();
              }}
            />
            <Button
              title="Enter details by hand"
              variant="ghost"
              onPress={() => router.replace("/connect")}
            />
          </View>

          <Body>
            Codes are single-use and expire after five minutes. If you tried it
            once already, show a new QR.
          </Body>
        </>
      )}
    </ScrollView>
  );
}
