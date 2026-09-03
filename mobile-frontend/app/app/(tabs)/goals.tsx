import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/lib/api";
import { font, radius, rgba } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import { Body, Card, Loading, PageBody, SectionHeader } from "@/components/ui";
import { ArtBackground, ArtIcon, hasArt, prefetchArt } from "@/components/art";
import { themePalette } from "@/lib/art";
import type { Goal, GoalTier } from "@/lib/types";
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

  if (!dashQ.data)
    return <Loading error={dashQ.error} onRetry={() => void dashQ.refetch()} />;

  const goals = dashQ.data?.goals ?? [];
  const props = dashQ.data?.properties ?? [];

  return (
    <SwipeTabs index={3}>
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
            /*
             * On a tiered goal the rung you are standing on owns the look — its
             * colour, its art, its name. That is what makes a rarity worth
             * having: the card itself changes when you reach it, rather than a
             * label appearing on the card it always was.
             */
            const tier = g.currentTier;
            /*
             * A tier that named no colour takes its *theme's*, not the goal's —
             * otherwise an ember card draws a lavender progress bar and the
             * rarity lives in the pips and nowhere else.
             */
            const tint = tier
              ? tier.themeColor || themePalette(tier.theme).primary
              : g.themeColor || t.accent;
            const done = g.status === "achieved";
            const art = tier && hasArt(tier) ? tier : g;
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
                <ArtBackground art={art} />
                <LinearGradient
                  colors={
                    // A photograph brings its own contrast; the tint wash would
                    // only mute it. Without art the wash is what the card is.
                    hasArt(art)
                      ? ["transparent", "transparent"]
                      : [rgba(tint, done ? 0.16 : 0.08), t.surface]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 16, gap: 12 }}
                >
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <ArtIcon
                      art={art}
                      emoji={tier?.emoji || g.emoji || "🎯"}
                      color={tint}
                      size={44}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{ color: t.text, fontFamily: font.title, fontSize: 17 }}
                      >
                        {tier?.title || g.title}
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

                  {g.tiers.length > 0 ? <TierLadder goal={g} /> : null}

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

/**
 * The rungs, as one row.
 *
 * Reached rungs are lit in their own theme colour, the one being climbed is
 * outlined, the rest are dim. Showing the whole ladder rather than only the
 * next rung is the point: a rarity you cannot see coming is not something to
 * aim at, and one you cannot see behind you is not something you earned.
 *
 * Identical in intent to `TierLadder` in `apps/web/src/pages/GoalsPage.tsx`.
 */
function TierLadder({ goal }: { goal: Goal }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {goal.tiers.map((tier) => (
        <TierPip
          key={tier.id}
          tier={tier}
          reached={Boolean(tier.metAt)}
          current={goal.nextTier?.id === tier.id}
        />
      ))}
    </View>
  );
}

function TierPip({
  tier,
  reached,
  current,
}: {
  tier: GoalTier;
  reached: boolean;
  current: boolean;
}) {
  const t = useTokens();
  const palette = themePalette(tier.theme);
  const color = tier.themeColor || palette.primary;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: reached
          ? rgba(color, 0.55)
          : current
            ? rgba(color, 0.35)
            : t.border,
        backgroundColor: reached ? rgba(color, 0.14) : "transparent",
        borderCurve: "continuous",
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: reached ? color : rgba(t.text, 0.18),
        }}
      />
      <Text
        style={{
          color: reached ? t.text : t.faint,
          fontFamily: font.mono,
          fontSize: 10,
          textTransform: "uppercase",
        }}
      >
        {tier.label}
        {!reached && current ? ` ${Math.round(tier.progressPct)}%` : ""}
      </Text>
    </View>
  );
}
