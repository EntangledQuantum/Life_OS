import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";
import { colors } from "@/lib/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops" }} />
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontFamily: "Figtree_700Bold",
            fontSize: 20,
          }}
        >
          This screen doesn&apos;t exist.
        </Text>
        <Link href="/" style={{ marginTop: 16 }}>
          <Text style={{ color: colors.muted }}>Go home</Text>
        </Link>
      </View>
    </>
  );
}
