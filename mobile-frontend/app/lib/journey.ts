/**
 * The journey geometry — the phone's copy.
 *
 * Duplicated from `packages/shared/src/journey.ts` **on purpose**: this app is
 * deliberately isolated from the workspace and must not import across it. The
 * two files have to stay identical below the header, or the same day looks like
 * a different figure on each device.
 *
 * Everything here is filter-free by design. react-native-svg's filter support
 * varies by version and a missing one renders a black rectangle rather than
 * degrading, so every glow is a gradient or a layered stroke.
 */

/** Must match `GROWTH_SIZE` in the web copy, or the two draw different pictures. */
const GROWTH_SIZE = 240;

/* ------------------------------------------------------------- the journey */

/**
 * Where the day is, as a state rather than a number.
 *
 * Every graphic reads this so "nearly there" and "there" look different in all
 * of them. Without it a finished day was a slightly brighter unfinished one,
 * which is the least interesting possible way to end.
 */
export type DayPhase = "early" | "underway" | "nearing" | "complete";

export function dayPhase(efficiencyPct: number): DayPhase {
  if (efficiencyPct >= 100) return "complete";
  if (efficiencyPct >= 80) return "nearing";
  if (efficiencyPct >= 25) return "underway";
  return "early";
}

export interface JourneyFeel {
  phase: DayPhase;
  /** 0–1, clamped. The raw fill everything scales from. */
  fill: number;
  /**
   * How strongly to light the figure, 0–1.
   *
   * Deliberately not linear with `fill`. It stays low through the middle of the
   * day and lifts sharply over the last stretch, so the final push *feels*
   * like one — a linear glow means the difference between 60% and 80% looks
   * like the difference between 80% and 100%, and it should not.
   */
  glow: number;
  /** Extra halo radius in viewBox units, on top of the figure. */
  halo: number;
  /** True from 80% — renderers may add anticipation here. */
  nearing: boolean;
  complete: boolean;
}

export function journeyFeel(efficiencyPct: number): JourneyFeel {
  const pct = Number.isFinite(efficiencyPct) ? efficiencyPct : 0;
  const fill = Math.max(0, Math.min(1, pct / 100));
  const phase = dayPhase(pct);

  // Quartic: flat for most of the day, then it runs away with itself.
  const glow = Math.min(1, fill * fill * fill * fill * 0.55 + fill * 0.35);

  return {
    phase,
    fill,
    glow,
    halo: 6 + glow * 26,
    nearing: phase === "nearing" || phase === "complete",
    complete: phase === "complete",
  };
}

/* ------------------------------------------------------- deterministic noise */

/**
 * A tiny seeded PRNG (mulberry32).
 *
 * The star field and the ridge have to be the *same* every render, or the sky
 * reshuffles itself on every eight-second poll and the graphic flickers. Seeded
 * from the data, so it is stable for a given day and different between users.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from a string, so a user's sky is their own and does not move. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------ constellation */

export interface Star {
  id: string;
  x: number;
  y: number;
  /** Radius in viewBox units. Bigger habits get bigger stars. */
  r: number;
  lit: boolean;
  color: string;
}

export interface ConstellationGeometry {
  size: number;
  centre: number;
  stars: Star[];
  /** Polyline through the lit stars, in the order they sit on the spiral. */
  trail: { x: number; y: number }[];
  /** Closing segment back to the first star. Only on a finished day. */
  closes: boolean;
  /** Background dust, one entry per week already kept. */
  field: { x: number; y: number; r: number; o: number }[];
  feel: JourneyFeel;
  done: number;
  total: number;
}

/** The angle that makes a spiral look scattered rather than spoked. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function constellationGeometry(input: {
  efficiencyPct: number;
  habits: { id: string; done: boolean; color: string; weight?: number }[];
  /** Consistency per day, oldest first, 0–100. Drives the star field. */
  history: number[];
  seed?: number;
}): ConstellationGeometry {
  const centre = GROWTH_SIZE / 2;
  const feel = journeyFeel(input.efficiencyPct);
  const total = input.habits.length;

  /*
   * A golden-angle spiral rather than a ring: a ring of eight habits reads as a
   * clock face, and the whole point is that this should look like a sky. The
   * radius grows as sqrt(i) so the density stays even from centre to edge.
   */
  const maxR = GROWTH_SIZE * 0.38;
  const stars: Star[] = input.habits.map((h, i) => {
    const t = total <= 1 ? 0 : i / (total - 1);
    const radius = maxR * Math.sqrt(0.18 + t * 0.82);
    const angle = i * GOLDEN;
    return {
      id: h.id,
      x: centre + Math.cos(angle) * radius,
      y: centre + Math.sin(angle) * radius,
      r: 2.2 + Math.min(2.4, (h.weight ?? 1) * 0.9) + (h.done ? 1.6 : 0),
      lit: h.done,
      color: h.color,
    };
  });

  const litInOrder = stars.filter((s) => s.lit);
  const trail = litInOrder.map((s) => ({ x: s.x, y: s.y }));

  /*
   * Dust, one scatter per week kept, so a long-running instance has a deeper
   * sky than a fresh one. It is the only part of the picture that rewards
   * months rather than hours.
   */
  const weeks = Math.min(10, Math.floor(input.history.length / 7));
  const random = rng(input.seed ?? seedFrom(input.habits.map((h) => h.id).join("")));
  const field: ConstellationGeometry["field"] = [];
  for (let w = 0; w < weeks; w++) {
    const strength =
      input.history
        .slice(w * 7, w * 7 + 7)
        .reduce((a, b) => a + b, 0) /
      7 /
      100;
    for (let i = 0; i < 9; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * GROWTH_SIZE * 0.47;
      field.push({
        x: centre + Math.cos(angle) * radius,
        y: centre + Math.sin(angle) * radius,
        r: 0.5 + random() * 1.1,
        o: 0.06 + Math.max(0, Math.min(1, strength)) * 0.22,
      });
    }
  }

  return {
    size: GROWTH_SIZE,
    centre,
    stars,
    trail,
    // The figure only closes on a finished day. That is the arrival.
    closes: feel.complete && trail.length >= 3,
    field,
    feel,
    done: litInOrder.length,
    total,
  };
}

/* ------------------------------------------------------------------ ascent */

export interface AscentGeometry {
  size: number;
  /** Filled silhouette of the ridge, closed along the bottom. */
  ridge: string;
  /** The near ridge, darker and lower, for depth. */
  foreRidge: string;
  /** The path up it, as an SVG path. */
  trail: string;
  /** One per scheduled thing, in time order, placed along the trail. */
  waypoints: { x: number; y: number; done: boolean; color: string }[];
  /** Where you are on the trail right now — driven by the score, not the clock. */
  marker: { x: number; y: number };
  summit: { x: number; y: number };
  /** Sun or moon, on its own arc, driven by the clock. */
  light: { x: number; y: number; night: boolean };
  feel: JourneyFeel;
}

export function ascentGeometry(input: {
  efficiencyPct: number;
  items: { done: boolean; color: string }[];
  /** How far through the life-day, 0–1. Moves the sun, nothing else. */
  dayProgress: number;
  seed?: number;
}): AscentGeometry {
  const size = GROWTH_SIZE;
  const feel = journeyFeel(input.efficiencyPct);
  const base = size * 0.82;
  const summit = { x: size * 0.72, y: size * 0.24 };

  /*
   * The trail is one cubic curve from the bottom-left to the summit. Every
   * waypoint and the marker are sampled from it, so nothing can drift off the
   * path — placing them independently is how you end up with a flag hovering
   * beside a mountain.
   */
  const start = { x: size * 0.12, y: base };
  const c1 = { x: size * 0.3, y: base - size * 0.06 };
  const c2 = { x: size * 0.44, y: summit.y + size * 0.26 };
  const trail = `M ${r2(start.x)} ${r2(start.y)} C ${r2(c1.x)} ${r2(c1.y)}, ${r2(c2.x)} ${r2(c2.y)}, ${r2(summit.x)} ${r2(summit.y)}`;

  const at = (t: number) => cubicAt(t, start, c1, c2, summit);

  const waypoints = input.items.map((item, i) => {
    const t = input.items.length <= 1 ? 0.5 : 0.08 + (i / (input.items.length - 1)) * 0.84;
    const p = at(t);
    return { x: p.x, y: p.y, done: item.done, color: item.color };
  });

  const random = rng(input.seed ?? 1337);
  return {
    size,
    ridge: ridgePath(size, base, 7, 0.34, random),
    foreRidge: ridgePath(size, base + size * 0.07, 5, 0.2, rng((input.seed ?? 1337) + 99)),
    trail,
    waypoints,
    marker: at(feel.fill),
    summit,
    light: sunAt(input.dayProgress, size),
    feel,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function cubicAt(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** A jagged skyline, closed along the bottom so it fills as a silhouette. */
function ridgePath(
  size: number,
  base: number,
  peaks: number,
  height: number,
  random: () => number,
): string {
  const points: string[] = [`M -4 ${r2(base)}`];
  const step = (size + 8) / peaks;
  for (let i = 0; i <= peaks; i++) {
    const x = -4 + i * step;
    const lift = size * height * (0.42 + random() * 0.58);
    const y = base - lift;
    // Quadratic between peaks: a mountain, not a sawtooth.
    const cx = x - step / 2;
    const cy = base - lift * (0.3 + random() * 0.4);
    points.push(i === 0 ? `L ${r2(x)} ${r2(y)}` : `Q ${r2(cx)} ${r2(cy)}, ${r2(x)} ${r2(y)}`);
  }
  points.push(`L ${r2(size + 4)} ${r2(size + 4)}`, `L -4 ${r2(size + 4)}`, "Z");
  return points.join(" ");
}

/** The sun's place on its own arc, and whether it has set. */
function sunAt(dayProgress: number, size: number): { x: number; y: number; night: boolean } {
  const f = Math.max(0, Math.min(1, dayProgress));
  /*
   * The life-day starts at 04:00, so the sun is up for roughly the middle
   * three-quarters of it. Outside that it is the moon, on the same arc — the
   * graphic should look different at 2am, because it *is* different.
   */
  const dayStart = 0.12;
  const dayEnd = 0.86;
  const night = f < dayStart || f > dayEnd;
  const local = night
    ? f < dayStart
      ? f / dayStart
      : (f - dayEnd) / (1 - dayEnd)
    : (f - dayStart) / (dayEnd - dayStart);

  const angle = Math.PI * (1 - Math.max(0, Math.min(1, local)));
  const radius = size * 0.42;
  return {
    x: size / 2 + Math.cos(angle) * radius,
    y: size * 0.62 - Math.sin(angle) * radius * 0.78,
    night,
  };
}
