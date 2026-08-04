/**
 * Android home-screen widget — roomy status board.
 * Fills match_parent; only manual-activity chips (no Sleep/Break — schedule owns those).
 */
import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { WidgetSnapshot } from "@/lib/widget-data";

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

/** Manual activities only — Sleep/Break are agent/schedule-driven. */
const PICKER = [
  { id: "Deep Work", label: "Deep" },
  { id: "Study", label: "Study" },
  { id: "Exercise", label: "Move" },
  { id: "Life Admin", label: "Admin" },
  { id: "Exploration", label: "Explore" },
] as const;

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

export function StatusWidget({ data }: { data: WidgetSnapshot | null }) {
  const d = data;
  const pulse = d?.pulse ?? "—";
  const eff = d ? Math.round(d.efficiencyPct) : 0;
  const fillPct = Math.min(100, Math.max(0, d?.efficiencyPct ?? 0));
  // Wide fill for large widgets (~400dp usable width)
  const barFill = Math.max(6, Math.round((fillPct / 100) * 360));
  const xpLine = d ? `${d.dailyXp} / ${d.dailyXpTarget} XP` : "— XP";
  const habitLine =
    d && d.habitsTotal > 0
      ? `${d.habitsDone}/${d.habitsTotal} habits`
      : "— habits";
  const delta =
    d != null
      ? `${d.improvementPct > 0 ? "+" : ""}${Math.round(d.improvementPct)}pp`
      : "";
  const activity = d?.activity ?? "Idle";

  // Proportional timeline segments that always span full width
  const segs = d?.timeline ?? [];
  const totalSpan = segs.reduce(
    (s, t) => s + Math.max(0.05, t.endHour - t.startHour),
    0,
  );

  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: BG,
        borderRadius: 18,
        padding: 16,
        flexDirection: "column",
        justifyContent: "space-between",
      }}
      clickAction="OPEN_APP"
    >
      {/* Top: brand + date */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <TextWidget
          text="Life OS"
          style={{ color: MUTED, fontSize: 11, fontWeight: "600" }}
        />
        <TextWidget
          text={d?.offline ? "offline" : (d?.date ?? "—")}
          style={{ color: FAINT, fontSize: 11 }}
        />
      </FlexWidget>

      {/* Hero: pulse + efficiency */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginTop: 4,
        }}
      >
        <TextWidget
          text={pulse}
          style={{
            color: pulseColor(pulse),
            fontSize: 30,
            fontWeight: "700",
          }}
        />
        <TextWidget
          text={`${eff}%`}
          style={{ color: TEXT, fontSize: 32, fontWeight: "700" }}
        />
      </FlexWidget>

      {/* Progress bar */}
      <FlexWidget
        style={{
          width: "match_parent",
          height: 10,
          backgroundColor: SURFACE2,
          borderRadius: 5,
          marginTop: 8,
          marginBottom: 4,
        }}
      >
        <FlexWidget
          style={{
            width: barFill,
            height: 10,
            backgroundColor: ACCENT,
            borderRadius: 5,
          }}
        >
          <TextWidget text=" " style={{ fontSize: 1, color: ACCENT }} />
        </FlexWidget>
      </FlexWidget>

      {/* Compact stats */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          marginTop: 4,
        }}
      >
        <TextWidget
          text={`${xpLine}  ·  ${habitLine}${delta ? `  ·  ${delta}` : ""}`}
          style={{ color: MUTED, fontSize: 12 }}
          truncate="END"
          maxLines={1}
        />
      </FlexWidget>

      {/* Day ribbon — full width flex children */}
      <FlexWidget
        style={{
          width: "match_parent",
          height: 12,
          flexDirection: "row",
          borderRadius: 4,
          overflow: "hidden",
          marginTop: 10,
          backgroundColor: SURFACE2,
        }}
      >
        {segs.length === 0 ? (
          <FlexWidget
            style={{
              flex: 1,
              height: 12,
              backgroundColor: SURFACE2,
            }}
          >
            <TextWidget text=" " style={{ fontSize: 1 }} />
          </FlexWidget>
        ) : (
          segs.map((seg, i) => {
            const span = Math.max(0.05, seg.endHour - seg.startHour);
            const weight = totalSpan > 0 ? span / totalSpan : 1 / segs.length;
            // Approximate flex via fixed width weights using flex when available
            const dim = seg.status === "done";
            return (
              <FlexWidget
                key={`${seg.category}-${i}`}
                style={{
                  flex: Math.max(1, Math.round(weight * 100)),
                  height: 12,
                  backgroundColor: dim
                    ? ("#334155" as Hex)
                    : asHex(seg.color),
                }}
              >
                <TextWidget text=" " style={{ fontSize: 1 }} />
              </FlexWidget>
            );
          })
        )}
      </FlexWidget>

      {/* Current activity */}
      <FlexWidget
        style={{
          width: "match_parent",
          backgroundColor: SURFACE,
          borderRadius: 14,
          padding: 12,
          marginTop: 12,
          flex: 1,
          justifyContent: "center",
        }}
      >
        <TextWidget
          text="RIGHT NOW"
          style={{ color: FAINT, fontSize: 10, fontWeight: "600" }}
        />
        <TextWidget
          text={activity}
          style={{ color: TEXT, fontSize: 22, fontWeight: "700" }}
        />
        {d?.upcomingTitle ? (
          <TextWidget
            text={`Next · ${d.upcomingTitle}`}
            style={{ color: MUTED, fontSize: 12 }}
            truncate="END"
            maxLines={1}
          />
        ) : (
          <TextWidget
            text="Tap a focus below"
            style={{ color: FAINT, fontSize: 12 }}
          />
        )}
      </FlexWidget>

      {/* 5 focus chips — no Sleep / Break */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          marginTop: 10,
        }}
      >
        {PICKER.map((a, idx) => {
          const active = d?.activity === a.id;
          return (
            <FlexWidget
              key={a.id}
              clickAction="SET_ACTIVITY"
              clickActionData={{ activity: a.id }}
              style={{
                flex: 1,
                height: 40,
                borderRadius: 10,
                backgroundColor: active ? ACCENT : SURFACE2,
                alignItems: "center",
                justifyContent: "center",
                marginLeft: idx === 0 ? 0 : 6,
              }}
            >
              <TextWidget
                text={a.label}
                style={{
                  color: active ? BG : MUTED,
                  fontSize: 12,
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
