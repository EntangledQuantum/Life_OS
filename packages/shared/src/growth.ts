/**
 * The geometry behind the day graphic, so web and phone draw the same picture.
 *
 * The old meters — a stem that grew, a circle that filled — encoded exactly one
 * number between them: the XP ratio. A bar would have carried as much
 * information, and neither changed at all as weeks of consistency accumulated,
 * so there was nothing to grow *into*. They were decoration standing where a
 * status display should be.
 *
 * These carry three things at once: what is done today, which of *your* habits
 * did it, and how long you have been keeping it up. The maths lives here rather
 * than in either client because two implementations of the same drawing drift,
 * and a graphic that means something slightly different on the phone than on
 * the desktop is worse than one that means nothing.
 *
 * Pure geometry — no colours, no components, no framework. Both renderers take
 * these numbers and draw them with their own primitives.
 */

export interface GrowthInput {
  /** Today against today's target, 0–100. Values above 100 are kept. */
  efficiencyPct: number;
  /** One per active habit, in a stable order. */
  petals: { id: string; done: boolean; color: string }[];
  /**
   * Consistency behind today, oldest first — one entry per day, 0–100.
   * Drives the rings: the history the day is standing on.
   */
  history: number[];
}

export interface Petal {
  id: string;
  done: boolean;
  color: string;
  /** Degrees clockwise from twelve o'clock. */
  angle: number;
  /** Tip distance from the centre, in viewBox units. */
  reach: number;
  /** Half-width of the petal at its widest, in degrees. */
  spread: number;
}

export interface Ring {
  /** Radius in viewBox units. */
  r: number;
  /** How complete that week was, 0–1. Drawn as opacity and stroke weight. */
  strength: number;
}

export interface GrowthGeometry {
  /** Square viewBox both renderers use, so proportions match exactly. */
  size: number;
  centre: number;
  /** 0–1, clamped. What the core fills to. */
  fill: number;
  /** True once the day's target is met — both renderers mark this. */
  complete: boolean;
  coreRadius: number;
  petals: Petal[];
  rings: Ring[];
  /** How many of the petals are filled, and out of how many. */
  done: number;
  total: number;
}

/** The square both clients draw into. Sized so 1 unit ≈ 1px at natural scale. */
export const GROWTH_SIZE = 240;

const CENTRE = GROWTH_SIZE / 2;
const CORE_MIN = 26;
const CORE_MAX = 44;
const PETAL_INNER = 52;
const PETAL_OUTER = 104;

/** Cap the ring stack — past eight weeks it is a smudge, not a history. */
const MAX_RINGS = 8;

export function growthGeometry(input: GrowthInput): GrowthGeometry {
  const pct = Number.isFinite(input.efficiencyPct) ? input.efficiencyPct : 0;
  const fill = Math.max(0, Math.min(1, pct / 100));

  const total = input.petals.length;
  const done = input.petals.filter((p) => p.done).length;

  /*
   * The core grows a little as the day fills, so the whole figure opens up
   * rather than only changing colour. Bounded, so an empty day still reads as a
   * shape and a full one does not swallow the petals.
   */
  const coreRadius = CORE_MIN + (CORE_MAX - CORE_MIN) * fill;

  /*
   * Petals are spaced evenly regardless of count, so three habits look
   * deliberate rather than like a broken twelve. A single habit sits at the
   * top rather than being a lone spike at some arbitrary angle.
   */
  const step = total > 0 ? 360 / total : 0;
  const spread = total > 0 ? Math.min(26, Math.max(9, step * 0.34)) : 0;

  const petals: Petal[] = input.petals.map((p, i) => ({
    id: p.id,
    done: p.done,
    color: p.color,
    angle: i * step,
    /*
     * A done petal reaches full length; an open one stops short. The shape
     * carries the state on its own, so it still reads with the colour stripped
     * out — which matters for colour-blind readers and for a glance from
     * across the room.
     *
     * Half length rather than a stub: at 18% the open ones were specks and the
     * figure looked broken rather than partly done.
     */
    reach: p.done ? PETAL_OUTER : PETAL_INNER + (PETAL_OUTER - PETAL_INNER) * 0.5,
    spread,
  }));

  return {
    size: GROWTH_SIZE,
    centre: CENTRE,
    fill,
    complete: pct >= 100,
    coreRadius,
    petals,
    rings: buildRings(input.history),
    done,
    total,
  };
}

/**
 * One ring per week behind today, innermost most recent.
 *
 * Weeks rather than days because a ring per day would be a hundred hairlines by
 * spring. A week is also the unit people actually think in when they ask
 * whether something is sticking.
 */
function buildRings(history: number[]): Ring[] {
  const clean = history.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return [];

  const weeks: number[] = [];
  // Newest first, so the innermost ring is the week just gone.
  for (let end = clean.length; end > 0 && weeks.length < MAX_RINGS; end -= 7) {
    const slice = clean.slice(Math.max(0, end - 7), end);
    if (slice.length === 0) break;
    weeks.push(slice.reduce((a, b) => a + b, 0) / slice.length / 100);
  }

  const innermost = PETAL_OUTER + 8;
  const gap = 9;
  return weeks.map((strength, i) => ({
    r: innermost + i * gap,
    strength: Math.max(0, Math.min(1, strength)),
  }));
}

/**
 * A petal as a path, in the coordinate space of `GROWTH_SIZE`.
 *
 * Two quadratic curves meeting at the tip. Built here rather than in each
 * renderer because SVG path syntax is identical in both, and a petal that
 * curves differently on the phone would make the two graphics visibly
 * different objects.
 */
export function petalPath(petal: Petal, centre: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const at = (deg: number, r: number) => ({
    x: centre + Math.cos(rad(deg)) * r,
    y: centre + Math.sin(rad(deg)) * r,
  });

  const base = PETAL_INNER * 0.62;
  const start = at(petal.angle - petal.spread * 0.3, base);
  const end = at(petal.angle + petal.spread * 0.3, base);
  const tip = at(petal.angle, petal.reach);
  const left = at(petal.angle - petal.spread, (base + petal.reach) / 2);
  const right = at(petal.angle + petal.spread, (base + petal.reach) / 2);

  const n = (v: number) => Math.round(v * 100) / 100;
  return [
    `M ${n(start.x)} ${n(start.y)}`,
    `Q ${n(left.x)} ${n(left.y)} ${n(tip.x)} ${n(tip.y)}`,
    `Q ${n(right.x)} ${n(right.y)} ${n(end.x)} ${n(end.y)}`,
    "Z",
  ].join(" ");
}

/** Arc path for the core's fill, starting at twelve and going clockwise. */
export function arcPath(
  centre: number,
  radius: number,
  fraction: number,
): string {
  const f = Math.max(0, Math.min(0.9999, fraction));
  if (f <= 0) return "";
  const end = f * 360;
  const rad = ((end - 90) * Math.PI) / 180;
  const x = centre + Math.cos(rad) * radius;
  const y = centre + Math.sin(rad) * radius;
  const large = end > 180 ? 1 : 0;
  const n = (v: number) => Math.round(v * 100) / 100;
  return `M ${n(centre)} ${n(centre - radius)} A ${n(radius)} ${n(radius)} 0 ${large} 1 ${n(x)} ${n(y)}`;
}

/**
 * Marks along the day for the `arc` style: where each scheduled thing sits
 * between the day's start and its end, and where the clock is now.
 */
export function dayArcPoint(
  fractionOfDay: number,
  centre: number,
  radius: number,
): { x: number; y: number } {
  // A half-circle from left to right: sunrise on the left, sunset on the right.
  const f = Math.max(0, Math.min(1, fractionOfDay));
  const angle = Math.PI * (1 - f);
  return {
    x: centre + Math.cos(angle) * radius,
    y: centre - Math.sin(angle) * radius,
  };
}
