import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";
import { font } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";

export default function NotFoundScreen() {
  const t = useTokens();
  return (
    <>
      <Stack.Screen options={{ title: "Oops" }} />
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ color: t.text, fontFamily: font.display, fontSize: 22 }}>
          This screen doesn&apos;t exist.
        </Text>
        <Link href="/" style={{ marginTop: 16 }}>
          <Text style={{ color: t.accent, fontFamily: font.bodySemi }}>Go home</Text>
        </Link>
      </View>
    </>
  );
}
