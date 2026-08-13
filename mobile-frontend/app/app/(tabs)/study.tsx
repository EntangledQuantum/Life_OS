import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { font, radius } from "@/lib/theme";
import { useTokens } from "@/lib/theme-provider";
import { useLayout } from "@/lib/responsive";
import { Body, Loading, PageBody, SectionHeader } from "@/components/ui";
import { TaskRow } from "@/components/task-row";
import { SwipeTabs } from "@/components/swipe-tabs";

/**
 * Study, on the phone. There was no such screen before this: the app could show
 * you that a study block existed, but not the chapter, the instructions, or the
 * links — and those are the only parts of a study block anyone wants on a
 * phone. A study task carries all of it, so this screen just draws it expanded.
 *
 * You complete it; there is nothing to start. The duration recorded is the
 * window the agent planned, not a stopwatch.
 */
export default function StudyScreen() {
  const qc = useQueryClient();
  const t = useTokens();
  const { gutter } = useLayout();

  const openQ = useQuery({
    queryKey: ["tasks", "study", "active"],
    queryFn: () => api.tasks({ kind: "study", status: "active" }),
    refetchInterval: 15_000,
  });

  const doneQ = useQuery({
    queryKey: ["tasks", "study", "done"],
    queryFn: () => api.tasks({ kind: "study", status: "done" }),
    refetchInterval: 60_000,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (openQ.isLoading && !openQ.data) return <Loading />;

  const open = openQ.data ?? [];
  const recent = (doneQ.data ?? [])
    .slice()
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 8);

  return (
    <SwipeTabs index={2}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ padding: gutter, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={openQ.isFetching && !openQ.isLoading}
            onRefresh={() => void openQ.refetch()}
            tintColor={t.accent}
          />
        }
      >
        <PageBody>
          <View style={{ gap: 10 }}>
            <SectionHeader title="To study" />
            {open.length === 0 ? (
              <Body>
                Nothing to study right now. Ask your agent to schedule a reading
                block — it can attach the chapter and the links along with it.
              </Body>
            ) : (
              open.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  expanded
                  onComplete={() => complete.mutate(task.id)}
                />
              ))
            )}
          </View>

          {recent.length > 0 ? (
            <View style={{ gap: 8 }}>
              <SectionHeader title="Recently done" />
              {recent.map((task) => (
                <View
                  key={task.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    borderRadius: radius.md,
                    backgroundColor: t.surface,
                    opacity: 0.7,
                    borderCurve: "continuous",
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{task.emoji || "📖"}</Text>
                  <Text
                    style={{
                      color: t.muted,
                      fontFamily: font.bodyMedium,
                      fontSize: 14,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {task.title}
                  </Text>
                  {task.durationMinutes ? (
                    <Text
                      style={{ color: t.faint, fontFamily: font.mono, fontSize: 12 }}
                    >
                      {task.durationMinutes}m
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </PageBody>
      </ScrollView>
    </SwipeTabs>
  );
}
