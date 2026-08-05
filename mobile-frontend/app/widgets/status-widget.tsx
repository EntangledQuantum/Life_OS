/**
 * Android home-screen widget — status board that fills whatever cell it is given.
 *
 * Sizing rule: nothing here may use a fixed pixel width for something that
 * should span the widget. The launcher hands out a different dp box on every
 * device, every cell count, and again after each resize — a hardcoded width
 * leaves a gap on a wide widget and overflows a narrow one. Anything that
 * spans uses `match_parent` or `flex` weights, and the tiers below come from
 * the real `widgetInfo` dimensions rather than a guess.
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

export function StatusWidget({
  data,
  width = 320,
  height = 200,
}: {
  data: WidgetSnapshot | null;
  /** Real widget size in dp, from `widgetInfo`. Defaults suit a 4x2 cell. */
  width?: number;
  height?: number;
}) {
  const d = data;

  /*
   * Three tiers. A 2x1 widget cannot hold a ribbon and five chips without
   * clipping, and a 5x3 looks half-empty if we only draw the small version.
   */
  const tall = height >= 200;
  const medium = height >= 150;
  const wide = width >= 280;

  const pad = tall ? 16 : 12;
  const gap = tall ? 10 : 6;

  const pulse = d?.pulse ?? "—";
  const eff = d ? Math.round(d.efficiencyPct) : 0;
  const fill = Math.min(100, Math.max(0, Math.round(d?.efficiencyPct ?? 0)));
  const rest = 100 - fill;

  const xpLine = d ? `${d.dailyXp} / ${d.dailyXpTarget} XP` : "— XP";
  const habitLine =
    d && d.habitsTotal > 0 ? `${d.habitsDone}/${d.habitsTotal} habits` : "— habits";
  const delta =
    d != null
      ? `${d.improvementPct > 0 ? "+" : ""}${Math.round(d.improvementPct)}pp`
      : "";
  const activity = d?.activity ?? "Idle";

  const segs = d?.timeline ?? [];
  const totalSpan = segs.reduce(
    (s, t) => s + Math.max(0.05, t.endHour - t.startHour),
    0,
  );

  const barHeight = tall ? 10 : 8;
  const ribbonHeight = tall ? 12 : 10;

  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: BG,
        borderRadius: 18,
        padding: pad,
        flexDirection: "column",
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
          marginTop: 2,
        }}
      >
        <TextWidget
          text={pulse}
          style={{
            color: pulseColor(pulse),
            fontSize: tall ? 30 : 22,
            fontWeight: "700",
          }}
        />
        <TextWidget
          text={`${eff}%`}
          style={{ color: TEXT, fontSize: tall ? 32 : 24, fontWeight: "700" }}
        />
      </FlexWidget>

      {/*
        Progress bar as two flex weights. This was a fixed `fillPct/100 * 360`
        dp width, which only lined up on a widget that happened to be 360dp
        wide — the visible gap on every other size.
      */}
      <FlexWidget
        style={{
          width: "match_parent",
          height: barHeight,
          backgroundColor: SURFACE2,
          borderRadius: 5,
          marginTop: gap,
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        {fill > 0 ? (
          <FlexWidget
            style={{ flex: fill, height: barHeight, backgroundColor: ACCENT }}
          >
            <TextWidget text=" " style={{ fontSize: 1, color: ACCENT }} />
          </FlexWidget>
        ) : null}
        {rest > 0 ? (
          <FlexWidget
            style={{ flex: rest, height: barHeight, backgroundColor: SURFACE2 }}
          >
            <TextWidget text=" " style={{ fontSize: 1, color: SURFACE2 }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>

      {/* Compact stats */}
      <FlexWidget style={{ width: "match_parent", marginTop: gap }}>
        <TextWidget
          text={`${xpLine}  ·  ${habitLine}${delta ? `  ·  ${delta}` : ""}`}
          style={{ color: MUTED, fontSize: 12 }}
          truncate="END"
          maxLines={1}
        />
      </FlexWidget>

      {/* Day ribbon — proportional flex children, so it always spans exactly */}
      {medium ? (
        <FlexWidget
          style={{
            width: "match_parent",
            height: ribbonHeight,
            flexDirection: "row",
            borderRadius: 4,
            overflow: "hidden",
            marginTop: gap,
            backgroundColor: SURFACE2,
          }}
        >
          {segs.length === 0 ? (
            <FlexWidget
              style={{ flex: 1, height: ribbonHeight, backgroundColor: SURFACE2 }}
            >
              <TextWidget text=" " style={{ fontSize: 1 }} />
            </FlexWidget>
          ) : (
            segs.map((seg, i) => {
              const span = Math.max(0.05, seg.endHour - seg.startHour);
              const weight = totalSpan > 0 ? span / totalSpan : 1 / segs.length;
              const dim = seg.status === "done";
              return (
                <FlexWidget
                  key={`${seg.category}-${i}`}
                  style={{
                    flex: Math.max(1, Math.round(weight * 100)),
                    height: ribbonHeight,
                    backgroundColor: dim ? ("#334155" as Hex) : asHex(seg.color),
                  }}
                >
                  <TextWidget text=" " style={{ fontSize: 1 }} />
                </FlexWidget>
              );
            })
          )}
        </FlexWidget>
      ) : null}

      {/*
        The one flexible block. It absorbs whatever vertical space is left, so
        the chips stay pinned to the bottom edge instead of leaving a dead gap
        under them on a tall widget.
      */}
      <FlexWidget
        style={{
          width: "match_parent",
          backgroundColor: SURFACE,
          borderRadius: 14,
          padding: tall ? 12 : 10,
          marginTop: gap,
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
          style={{ color: TEXT, fontSize: tall ? 22 : 17, fontWeight: "700" }}
          truncate="END"
          maxLines={1}
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

      {/* Focus chips — drop the last two when there is not width for five */}
      {medium ? (
        <FlexWidget
          style={{
            width: "match_parent",
            flexDirection: "row",
            marginTop: gap,
          }}
        >
          {(wide ? PICKER : PICKER.slice(0, 3)).map((a, idx) => {
            const active = d?.activity === a.id;
            return (
              <FlexWidget
                key={a.id}
                clickAction="SET_ACTIVITY"
                clickActionData={{ activity: a.id }}
                style={{
                  flex: 1,
                  height: tall ? 40 : 32,
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
      ) : null}
    </FlexWidget>
  );
}
