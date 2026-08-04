import { useState, type ComponentProps } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useConnection } from "@/lib/connection";
import { checkHealth, ApiError } from "@/lib/api";
import { looksLikeWebUiPort } from "@/lib/storage";
import { colors, accentColor } from "@/lib/theme";
import { Button, Body, Title, Label, Card } from "@/components/ui";

type Mode = "token" | "login";

export default function ConnectScreen() {
  const { connectWithToken, connectWithLogin, baseUrl } = useConnection();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("token");
  const [url, setUrl] = useState(baseUrl ?? "http://192.168.1.1:8787");
  const webUiPort = looksLikeWebUiPort(url);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("lifeos");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const accent = accentColor("nebula");

  async function onTest() {
    setError(null);
    setHealthNote(null);
    setBusy(true);
    try {
      const h = await checkHealth(url);
      setHealthNote(
        h.ok
          ? `Reachable · storage=${h.storage}${h.lan ? " · LAN" : " · loopback only"}`
          : "Unexpected health response",
      );
      if (h.lan === false) {
        setHealthNote(
          (n) =>
            `${n}\nTip: set API_HOST=0.0.0.0 on the server so your phone can connect.`,
        );
      }
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
      if (mode === "token") {
        if (!token.trim()) throw new Error("Paste your API_TOKEN");
        await connectWithToken(url, token.trim());
      } else {
        await connectWithLogin(url, username.trim(), password);
      }
      router.replace("/(tabs)");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("Wrong token or credentials");
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingTop: 72,
          gap: 16,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 40 }}>◈</Text>
          <Title>Connect to Life OS</Title>
          <Body>
            This app talks to the Life OS server on your machine. Enter the LAN
            address printed when the API starts, and your API token from{" "}
            <Text style={{ fontFamily: "JetBrainsMono_500Medium", color: colors.text }}>
              .env
            </Text>
            .
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
                color: colors.warning,
                fontFamily: "Figtree_500Medium",
                fontSize: 13,
              }}
            >
              Port 5173 is the web UI (Vite), not the API. Use port{" "}
              <Text style={{ fontFamily: "JetBrainsMono_500Medium" }}>8787</Text>{" "}
              — e.g. http://192.168.29.131:8787
            </Text>
          ) : null}
          <Button title="Test connection" variant="soft" onPress={onTest} disabled={busy} />
          {healthNote ? (
            <Text
              selectable
              style={{
                color: colors.positive,
                fontFamily: "Figtree_400Regular",
                fontSize: 13,
              }}
            >
              {healthNote}
            </Text>
          ) : null}
        </Card>

        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["token", "login"] as Mode[]).map((m) => (
            <Button
              key={m}
              title={m === "token" ? "API token" : "Login"}
              variant={mode === m ? "primary" : "soft"}
              accent={accent}
              onPress={() => setMode(m)}
              style={{ flex: 1 }}
            />
          ))}
        </View>

        <Card style={{ gap: 12 }}>
          {mode === "token" ? (
            <>
              <Label>API_TOKEN</Label>
              <Field
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="lifeos-local-agent-token"
                secureTextEntry
              />
              <Body>
                Stored in the device secure store. Never logged. This is the same
                token agents use.
              </Body>
            </>
          ) : (
            <>
              <Label>Username</Label>
              <Field
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Label>Password</Label>
              <Field
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </>
          )}
        </Card>

        {error ? (
          <Text
            selectable
            style={{
              color: colors.warning,
              fontFamily: "Figtree_500Medium",
              fontSize: 14,
            }}
          >
            {error}
          </Text>
        ) : null}

        <Button
          title={busy ? "Connecting…" : "Connect"}
          accent={accent}
          onPress={onConnect}
          disabled={busy}
        />

        <Body style={{ marginTop: 8 }}>
          Need LAN access? On the PC: set API_HOST=0.0.0.0, restart the API, then
          use the address it prints.
        </Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      style={{
        backgroundColor: colors.surface2,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.text,
        fontFamily: "JetBrainsMono_500Medium",
        fontSize: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
      {...props}
    />
  );
}
