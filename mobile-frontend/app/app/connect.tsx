import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useConnection } from "@/lib/connection";
import { checkHealth, claimPairingCode, ApiError, ProtocolError } from "@/lib/api";
import { looksLikeWebUiPort } from "@/lib/storage";
import { font, radius } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { Button, Body, Title, Label, Card } from "@/components/ui";
import { UpdateRequired } from "@/components/update-required";

/**
 * First-run (and re-auth) screen. Only two fields: server URL + API token.
 * Login with username/password is gone (POST /auth/login → 410).
 */
export default function ConnectScreen() {
  const t = useTokens();
  const { connectWithToken, baseUrl } = useConnection();
  const router = useRouter();
  const [url, setUrl] = useState(baseUrl ?? "http://192.168.1.1:8787");
  const webUiPort = looksLikeWebUiPort(url);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthNote, setHealthNote] = useState<string | null>(null);
  /** Set when the server turns out to speak a protocol this build cannot read. */
  const [outdated, setOutdated] = useState<ProtocolError | null>(null);
  /** A code typed in by hand, when the deep link did not fire. */
  const [pairCode, setPairCode] = useState("");

  /**
   * Finish a pairing: trade the code for the real token and connect.
   *
   * The token never travelled in the QR or the deep link — only this
   * short-lived code did, and the server burns it as it hands the token over.
   */
  const pair = useCallback(
    async (serverUrl: string, code: string) => {
      setError(null);
      setBusy(true);
      try {
        const claimed = await claimPairingCode(serverUrl, code);
        await connectWithToken(claimed.baseUrl, claimed.token);
        router.replace("/(tabs)");
      } catch (e) {
        if (e instanceof ProtocolError) setOutdated(e);
        else setError(e instanceof Error ? e.message : "Pairing failed");
      } finally {
        setBusy(false);
      }
    },
    [connectWithToken, router],
  );

  /**
   * `lifeos://connect?code=…&url=…`, from the page the QR opened.
   *
   * Handled both ways round on purpose: `getInitialURL` covers a cold start
   * (the tap launched the app) and the listener covers a warm one (the app was
   * already backgrounded). Handling only one of the two is the classic way a
   * deep link works for the developer and nobody else.
   */
  useEffect(() => {
    let cancelled = false;

    const handle = (incoming: string | null) => {
      if (!incoming || cancelled) return;
      const parsed = Linking.parse(incoming);
      const code = String(parsed.queryParams?.code ?? "");
      const serverUrl = String(parsed.queryParams?.url ?? "");
      if (!code || !serverUrl) return;
      setUrl(serverUrl);
      void pair(serverUrl, code);
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [pair]);

  async function onTest() {
    setError(null);
    setHealthNote(null);
    setBusy(true);
    try {
      const h = await checkHealth(url);
      let note = h.ok
        ? `Reachable · storage=${h.storage}${h.lan ? " · LAN" : " · loopback only"}`
        : "Unexpected health response";
      if (h.lan === false) {
        note +=
          "\nTip: set API_HOST=0.0.0.0 on the server so your phone can connect.";
      }
      setHealthNote(note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unreachable");
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    setError(null);
    setBusy(true);
    try {
      if (!token.trim()) throw new Error("Paste your API_TOKEN from .env");
      await connectWithToken(url, token.trim());
      router.replace("/(tabs)");
    } catch (e) {
      /*
       * A version gap is caught here, on the first authenticated call, rather
       * than after setup completes and every screen quietly fails. Nothing in
       * this screen can fix it, so it takes over the screen entirely.
       */
      if (e instanceof ProtocolError) {
        setOutdated(e);
      } else if (e instanceof ApiError && e.status === 401) {
        setError("Wrong API token — check API_TOKEN in your Life OS .env");
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    } finally {
      setBusy(false);
    }
  }

  /* Nothing on this screen can fix a version gap, so it takes the screen over. */
  if (outdated) return <UpdateRequired error={outdated} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingTop: 72,
          gap: 16,
          flexGrow: 1,
          // A token field has no business being 1300pt wide on an iPad.
          width: "100%",
          maxWidth: 520,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 44, color: t.accent }}>◈</Text>
          <Title>Connect to Life OS</Title>
          <Body>
            One credential: the API token from your machine&apos;s Life OS{" "}
            <Text
              style={{
                fontFamily: font.mono,
                color: t.text,
              }}
            >
              .env
            </Text>{" "}
            (
            <Text
              style={{
                fontFamily: font.mono,
                color: t.text,
              }}
            >
              API_TOKEN
            </Text>
            ). There is no username or password.
          </Body>
        </View>

        <Card style={{ gap: 12 }}>
          <Label>Server address</Label>
          <Field
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.x.x:8787"
            keyboardType="url"
          />
          {webUiPort ? (
            <Text
              style={{
                color: t.warning,
                fontFamily: font.bodyMedium,
                fontSize: 13,
              }}
            >
              Port 5173 is the web UI, not the API. Use{" "}
              <Text style={{ fontFamily: font.mono }}>
                8787
              </Text>
              .
            </Text>
          ) : null}
          <Button
            title="Test connection"
            variant="soft"
            onPress={onTest}
            disabled={busy}
          />
          {healthNote ? (
            <Text
              selectable
              style={{
                color: t.positive,
                fontFamily: font.body,
                fontSize: 13,
              }}
            >
              {healthNote}
            </Text>
          ) : null}
        </Card>

        {/*
          The pairing card comes first because it is the path that works. The
          token is 43 characters of base64url; typing it on a phone keyboard is
          miserable, and what people actually do instead is email the only
          credential this app has to themselves.
        */}
        <Card style={{ gap: 12 }}>
          <Label>Pairing code</Label>
          <Body>
            Open Life OS on your computer, go to Settings, and scan the QR with
            this phone&apos;s camera. If the app did not open by itself, type
            the code here.
          </Body>
          <Field
            value={pairCode}
            onChangeText={setPairCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABCD2345WXYZ"
            style={{ fontFamily: font.mono, letterSpacing: 2, textAlign: "center" }}
          />
          <Button
            title="Pair"
            onPress={() => void pair(url, pairCode)}
            disabled={busy || pairCode.trim().length < 6}
          />
        </Card>

        <Card style={{ gap: 12 }}>
          <Label>API_TOKEN</Label>
          <Field
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste token from .env"
            secureTextEntry
            autoComplete="off"
            textContentType="password"
          />
          <Body>
            Stored in the device secure store (Keystore). Never logged. Same
            token agents use. Validated with{" "}
            <Text style={{ fontFamily: font.mono }}>
              GET /api/v1/auth/me
            </Text>
            .
          </Body>
        </Card>

        {error ? (
          <Text
            selectable
            style={{
              color: t.warning,
              fontFamily: font.bodyMedium,
              fontSize: 14,
            }}
          >
            {error}
          </Text>
        ) : null}

        <Button
          title={busy ? "Connecting…" : "Connect"}
          onPress={onConnect}
          disabled={busy}
        />

        <Body style={{ marginTop: 8 }}>
          Need LAN access? On the PC: set API_HOST=0.0.0.0, restart the API,
          then use the address it prints.
        </Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: ComponentProps<typeof TextInput>) {
  const t = useTokens();
  return (
    <TextInput
      placeholderTextColor={t.faint}
      style={{
        backgroundColor: t.surface2,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.border,
        color: t.text,
        fontFamily: font.mono,
        fontSize: 14,
        paddingHorizontal: 14,
        paddingVertical: 13,
      }}
      {...props}
    />
  );
}
