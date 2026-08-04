/**
 * Android home-screen widget — large status board.
 * Uses react-native-android-widget primitives only (no RN View/Text).
 */
import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { WidgetSnapshot } from "@/lib/widget-data";
import { ACTIVITIES } from "@/lib/types";

type Hex = `#${string}`;

const BG = "#0B0C10" as Hex;
const SURFACE = "#14161C" as Hex;
const SURFACE2 = "#1C1F28" as Hex;
const TEXT = "#F4F5F7" as Hex;
const MUTED = "#A0A6B4" as Hex;
const FAINT = "#6B7280" as Hex;
const ACCENT = "#7C9CFF" as Hex;
const POSITIVE = "#34D399" as Hex;
const WARNING = "#FBBF24" as Hex;
const NEUTRAL = "#94A3B8" as Hex;

function pulseColor(pulse: string): Hex {
  switch (pulse) {
    case "Improving":
      return POSITIVE;
    case "Recovering":
      return WARNING;
    case "Drifting":
      return NEUTRAL;
    default:
      return ACCENT;
  }
}

function asHex(c: string | undefined, fallback: Hex = ACCENT): Hex {
  if (c && /^#[0-9A-Fa-f]{6,8}$/.test(c)) return c as Hex;
  return fallback;
}

const SHORT: Record<string, string> = {
  "Deep Work": "Deep",
  Study: "Study",
  Sleep: "Sleep",
  Exercise: "Move",
  Break: "Break",
  "Life Admin": "Admin",
  Exploration: "Explore",
};

export function StatusWidget({ data }: { data: WidgetSnapshot | null }) {
  const d = data;
  const pulse = d?.pulse ?? "—";
  const eff = d ? Math.round(d.efficiencyPct) : 0;
  const xp = d ? `${d.dailyXp}/${d.dailyXpTarget}` : "—";
  const habits =
    d && d.habitsTotal > 0 ? `${d.habitsDone}/${d.habitsTotal}` : "—";
  const activity = d?.activity ?? "Idle";
  const fillPct = Math.min(100, Math.max(0, d?.efficiencyPct ?? 0));
  // Approximate bar width in dp for a ~320dp content area
  const barFill = Math.max(4, Math.round((fillPct / 100) * 280));

  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: BG,
        borderRadius: 20,
        padding: 14,
        flexDirection: "column",
      }}
      clickAction="OPEN_APP"
    >
      {/* Header */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <TextWidget
          text="Life OS"
          style={{ color: MUTED, fontSize: 12, fontWeight: "600" }}
        />
        <TextWidget
          text={d?.offline ? "offline" : d?.date ?? "—"}
          style={{ color: FAINT, fontSize: 11 }}
        />
      </FlexWidget>

      {/* Pulse + efficiency */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 6,
        }}
      >
        <TextWidget
          text={pulse}
          style={{
            color: pulseColor(pulse),
            fontSize: 26,
            fontWeight: "700",
          }}
        />
        <TextWidget
          text={`${eff}%`}
          style={{ color: TEXT, fontSize: 28, fontWeight: "700" }}
        />
      </FlexWidget>

      {/* Progress bar track */}
      <FlexWidget
        style={{
          width: "match_parent",
          height: 8,
          backgroundColor: SURFACE2,
          borderRadius: 4,
          marginBottom: 10,
        }}
      >
        <FlexWidget
          style={{
            width: barFill,
            height: 8,
            backgroundColor: ACCENT,
            borderRadius: 4,
          }}
        >
          <TextWidget text=" " style={{ fontSize: 1, color: ACCENT }} />
        </FlexWidget>
      </FlexWidget>

      {/* Metrics row */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          marginBottom: 10,
        }}
      >
        <Metric label="XP" value={xp} />
        <Metric label="Habits" value={habits} />
        <Metric
          label="Δ"
          value={
            d
              ? `${d.improvementPct > 0 ? "+" : ""}${d.improvementPct.toFixed(0)}`
              : "—"
          }
          valueColor={
            d && d.improvementPct > 0
              ? POSITIVE
              : d && d.improvementPct < 0
                ? NEUTRAL
                : TEXT
          }
        />
      </FlexWidget>

      {/* Active activity */}
      <FlexWidget
        style={{
          width: "match_parent",
          backgroundColor: SURFACE,
          borderRadius: 12,
          padding: 10,
          marginBottom: 8,
        }}
      >
        <TextWidget
          text="RIGHT NOW"
          style={{ color: FAINT, fontSize: 10, fontWeight: "600" }}
        />
        <TextWidget
          text={activity}
          style={{ color: TEXT, fontSize: 18, fontWeight: "600" }}
        />
        {d?.upcomingTitle ? (
          <TextWidget
            text={`Up next · ${d.upcomingTitle}`}
            style={{ color: MUTED, fontSize: 12 }}
            truncate="END"
            maxLines={1}
          />
        ) : null}
      </FlexWidget>

      {/* Timeline ribbon (simplified segments) */}
      {d && d.timeline.length > 0 ? (
        <FlexWidget
          style={{
            width: "match_parent",
            height: 14,
            flexDirection: "row",
            borderRadius: 4,
            overflow: "hidden",
            marginBottom: 10,
            backgroundColor: SURFACE2,
          }}
        >
          {d.timeline.slice(0, 12).map((seg, i) => {
            const w = Math.max(
              2,
              Math.round(((seg.endHour - seg.startHour) / 24) * 300),
            );
            const dim = seg.status === "done";
            return (
              <FlexWidget
                key={`${seg.category}-${i}`}
                style={{
                  width: w,
                  height: 14,
                  backgroundColor: dim ? ("#334155" as Hex) : asHex(seg.color),
                }}
              >
                <TextWidget text=" " style={{ fontSize: 1 }} />
              </FlexWidget>
            );
          })}
        </FlexWidget>
      ) : null}

      {/* Activity picker */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          flexGap: 4,
        }}
      >
        {ACTIVITIES.map((a) => {
          const active = d?.activity === a;
          return (
            <FlexWidget
              key={a}
              clickAction="SET_ACTIVITY"
              clickActionData={{ activity: a }}
              style={{
                flex: 1,
                height: 34,
                borderRadius: 8,
                backgroundColor: active ? ACCENT : SURFACE2,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TextWidget
                text={SHORT[a] ?? a.slice(0, 5)}
                style={{
                  color: active ? BG : MUTED,
                  fontSize: 9,
                  fontWeight: "600",
                }}
              />
            </FlexWidget>
          );
        })}
      </FlexWidget>
    </FlexWidget>
  );
}

function Metric({
  label,
  value,
  valueColor = TEXT,
}: {
  label: string;
  value: string;
  valueColor?: Hex;
}) {
  return (
    <FlexWidget style={{ flex: 1 }}>
      <TextWidget text={label} style={{ color: FAINT, fontSize: 10 }} />
      <TextWidget
        text={value}
        style={{ color: valueColor, fontSize: 15, fontWeight: "600" }}
      />
    </FlexWidget>
  );
}
