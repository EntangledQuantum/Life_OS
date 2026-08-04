import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { colors, accentColor } from "@/lib/theme";
import { Body, Card, Loading, SectionHeader } from "@/components/ui";

/** Read-only goals. Creating goals is the agent's job. */
export default function GoalsScreen() {
  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 20_000,
  });

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    staleTime: 30_000,
  });

  if (dashQ.isLoading && !dashQ.data) return <Loading />;

  const goals = dashQ.data?.goals ?? [];
  const props = dashQ.data?.properties ?? [];
  const theme = settingsQ.data?.accentTheme ?? "nebula";
  const accent = accentColor(theme);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={dashQ.isFetching && !dashQ.isLoading}
          onRefresh={() => void dashQ.refetch()}
          tintColor={colors.muted}
        />
      }
    >
      <Body>
        Goals are set by your agent. This screen is read-only on purpose — deciding
        what to want is the executive-function tax Life OS removes.
      </Body>

      {goals.length === 0 ? (
        <Card>
          <Text
            style={{
              color: colors.muted,
              fontFamily: "Figtree_500Medium",
              fontSize: 14,
            }}
          >
            No goals yet. When your agent sets one, it shows up here.
          </Text>
        </Card>
      ) : (
        goals.map((g) => {
          const pct = Math.min(100, Math.max(0, g.progressPct));
          return (
            <Card key={g.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Text style={{ fontSize: 28 }}>{g.emoji || "🎯"}</Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: "Figtree_600SemiBold",
                      fontSize: 17,
                    }}
                  >
                    {g.title}
                  </Text>
                  <Text
                    style={{
                      color: colors.faint,
                      fontFamily: "Figtree_500Medium",
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}
                  >
                    {g.status}
                    {g.celebrationPending ? " · celebration pending" : ""}
                  </Text>
                </View>
                <Text
                  style={{
                    color: accent,
                    fontFamily: "JetBrainsMono_600SemiBold",
                    fontSize: 16,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {Math.round(pct)}%
                </Text>
              </View>

              <View
                style={{
                  height: 6,
                  backgroundColor: colors.surface2,
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    backgroundColor: g.themeColor || accent,
                  }}
                />
              </View>

              {g.whyItMatters ? (
                <Text
                  style={{
                    color: colors.muted,
                    fontFamily: "Figtree_400Regular",
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {g.whyItMatters}
                </Text>
              ) : null}

              {(g.conditionDetail ?? []).length > 0 ? (
                <View style={{ gap: 4 }}>
                  {g.conditionDetail.map((line, i) => (
                    <Text
                      key={i}
                      style={{
                        color: colors.faint,
                        fontFamily: "JetBrainsMono_500Medium",
                        fontSize: 11,
                      }}
                    >
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      {props.length > 0 ? (
        <View style={{ gap: 10 }}>
          <SectionHeader title="Agent properties" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {props.map((p) => (
              <View
                key={p.uid}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 12,
                  minWidth: "45%",
                  flexGrow: 1,
                }}
              >
                <Text
                  style={{
                    color: colors.faint,
                    fontFamily: "Figtree_500Medium",
                    fontSize: 11,
                  }}
                >
                  {p.label || p.key}
                </Text>
                <Text
                  style={{
                    color: colors.text,
                    fontFamily: "JetBrainsMono_600SemiBold",
                    fontSize: 20,
                    marginTop: 4,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {p.value ?? p.textValue ?? "—"}
                  {p.unit ? (
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      {" "}
                      {p.unit}
                    </Text>
                  ) : null}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
