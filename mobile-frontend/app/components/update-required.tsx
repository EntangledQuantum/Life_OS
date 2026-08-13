import { Linking, Pressable, Text, View } from "react-native";
import type { ProtocolError } from "@/lib/api";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

/**
 * The server has moved past what this build can read.
 *
 * This is deliberately not the generic "can't reach the server" screen. The
 * failure looks identical from the inside — requests come back non-200 — but
 * the fix is completely different, and someone shown "check your connection"
 * will spend an evening on their router instead of installing an APK. So the
 * server says which protocol it needs, and the app says so plainly and hands
 * over the download link.
 */
export function UpdateRequired({ error }: { error: ProtocolError }) {
  const t = useTokens();
  const d = error.detail;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        padding: 24,
        justifyContent: "center",
        gap: 14,
      }}
    >
      <Text style={{ fontSize: 34 }}>⬆</Text>
      <Text style={{ color: t.text, fontFamily: font.display, fontSize: 26 }}>
        Update Life OS
      </Text>
      <Text
        style={{ color: t.muted, fontFamily: font.body, fontSize: 15, lineHeight: 22 }}
      >
        {d.hint}
      </Text>

      <View
        style={{
          flexDirection: "row",
          gap: 16,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          backgroundColor: t.surface,
          borderCurve: "continuous",
        }}
      >
        <Field label="this app" value={`v${d.clientProtocol}`} />
        <Field label="server needs" value={`v${d.minProtocol}`} />
      </View>

      <Pressable
        onPress={() => Linking.openURL(d.downloadUrl)}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          backgroundColor: rgba(t.accent, pressed ? 0.34 : 0.2),
          borderWidth: 1,
          borderColor: rgba(t.accent, 0.5),
          borderRadius: radius.sm,
          paddingVertical: 12,
          paddingHorizontal: 18,
          borderCurve: "continuous",
        })}
      >
        <Text style={{ color: t.accent, fontFamily: font.bodySemi, fontSize: 15 }}>
          Get the latest build
        </Text>
      </Pressable>

      <Text style={{ color: t.faint, fontFamily: font.body, fontSize: 12 }}>
        Your data is safe — this only affects the app on this device.
      </Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const t = useTokens();
  return (
    <View style={{ gap: 2 }}>
      <Text
        style={{
          color: t.faint,
          fontFamily: font.bodySemi,
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text style={{ color: t.text, fontFamily: font.mono, fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}
