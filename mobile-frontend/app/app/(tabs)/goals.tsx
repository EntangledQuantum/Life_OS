import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/lib/api";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import { Body, Card, Loading, PageBody, SectionHeader } from "@/components/ui";
import { SwipeTabs } from "@/components/swipe-tabs";

/** Read-only. Creating goals is the agent's job — see CLIENT_GUIDE §8. */
export default function GoalsScreen() {
  const t = useTokens();
  const { gutter, twoPane } = useLayout();

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: 20_000,
  });

  if (dashQ.isLoading && !dashQ.data) return <Loading />;

  const goals = dashQ.data?.goals ?? [];
  const props = dashQ.data?.properties ?? [];

  return (
    <SwipeTabs index={2}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ padding: gutter, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dashQ.isFetching && !dashQ.isLoading}
            onRefresh={() => void dashQ.refetch()}
            tintColor={t.accent}
          />
        }
      >
        <PageBody gap={16}>
        <Body>
          Goals are set by your agent. This screen is read-only on purpose —
          deciding what to want is the executive-function tax Life OS removes.
        </Body>

        {goals.length === 0 ? (
          <Card>
            <Body>No goals yet. When your agent sets one, it shows up here.</Body>
          </Card>
        ) : (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
          {goals.map((g) => {
            const pct = Math.min(100, Math.max(0, g.progressPct));
            const tint = g.themeColor || t.accent;
            const done = g.status === "achieved";
            return (
              <View
                key={g.id}
                style={{
                  // Two up when there is room; `flexBasis` rather than a width
                  // so the gap comes out of the row, not out of the last card.
                  flexBasis: twoPane ? "48%" : "100%",
                  flexGrow: 1,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: g.celebrationPending ? tint : t.border,
                  overflow: "hidden",
                  borderCurve: "continuous",
                }}
              >
                <LinearGradient
                  colors={[rgba(tint, done ? 0.16 : 0.08), t.surface]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 16, gap: 12 }}
                >
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <Text style={{ fontSize: 30 }}>{g.emoji || "🎯"}</Text>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{ color: t.text, fontFamily: font.title, fontSize: 17 }}
                      >
                        {g.title}
                      </Text>
                      <Text
                        style={{
                          color: g.celebrationPending ? tint : t.faint,
                          fontFamily: font.bodyMedium,
                          fontSize: 12,
                          textTransform: "capitalize",
                        }}
                      >
                        {g.celebrationPending ? "Ready to celebrate" : g.status}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: tint,
                        fontFamily: font.monoBold,
                        fontSize: 20,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {Math.round(pct)}%
                    </Text>
                  </View>

                  <View
                    style={{
                      height: 7,
                      backgroundColor: rgba(t.text, 0.08),
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        backgroundColor: tint,
                        borderRadius: 4,
                      }}
                    />
                  </View>

                  {g.whyItMatters ? <Body>{g.whyItMatters}</Body> : null}

                  {(g.conditionDetail ?? []).length > 0 ? (
                    <View style={{ gap: 4 }}>
                      {g.conditionDetail.map((line, i) => (
                        <Text
                          key={i}
                          style={{ color: t.faint, fontFamily: font.mono, fontSize: 11 }}
                        >
                          {line}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </LinearGradient>
              </View>
            );
          })}
          </View>
        )}

        {props.length > 0 ? (
          <View>
            <SectionHeader title="Agent properties" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {props.map((p) => (
                <View
                  key={p.uid}
                  style={{
                    backgroundColor: t.surface,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: t.border,
                    padding: 14,
                    minWidth: twoPane ? "22%" : "45%",
                    flexGrow: 1,
                    borderCurve: "continuous",
                  }}
                >
                  <Text
                    style={{ color: t.faint, fontFamily: font.bodyMedium, fontSize: 11 }}
                  >
                    {p.label || p.key}
                  </Text>
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: font.monoBold,
                      fontSize: 22,
                      marginTop: 5,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {p.value ?? p.textValue ?? "—"}
                    {p.unit ? (
                      <Text style={{ fontSize: 12, color: t.muted }}> {p.unit}</Text>
                    ) : null}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        </PageBody>
      </ScrollView>
    </SwipeTabs>
  );
}
