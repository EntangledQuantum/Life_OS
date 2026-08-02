import { ArrowUp } from "lucide-react";
import { asset } from "@/lib/deploy";
import { Reveal } from "@/components/landing/Reveal";

/**
 * The three-layer architecture, built as real cards rather than one flat SVG:
 * each layer gets a proper mark, its own colour, and room for a plain-English
 * "owns / never does" line.
 */

function ObsidianMark() {
  // Simplified faceted crystal — reads as Obsidian without copying the logo.
  return (
    <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden>
      <defs>
        <linearGradient id="obs-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="obs-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>
      </defs>
      <path d="M24 3 L41 17 L33 44 L15 44 L7 17 Z" fill="url(#obs-b)" />
      <path d="M24 3 L41 17 L24 24 Z" fill="url(#obs-a)" opacity="0.95" />
      <path d="M24 3 L7 17 L24 24 Z" fill="#DDD6FE" opacity="0.55" />
      <path d="M24 24 L33 44 L15 44 Z" fill="#8B5CF6" opacity="0.6" />
    </svg>
  );
}

function AgentMark() {
  // An orbiting core: a mind with things circling it.
  return (
    <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden>
      <circle cx="24" cy="24" r="7" fill="#34D399" />
      <circle cx="24" cy="24" r="7" fill="none" stroke="#A7F3D0" strokeWidth="1.5" />
      <ellipse
        cx="24"
        cy="24"
        rx="20"
        ry="9"
        fill="none"
        stroke="#34D399"
        strokeWidth="2"
        opacity="0.75"
        transform="rotate(-28 24 24)"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="20"
        ry="9"
        fill="none"
        stroke="#34D399"
        strokeWidth="2"
        opacity="0.4"
        transform="rotate(32 24 24)"
      />
      <circle cx="41" cy="15" r="3" fill="#6EE7B7" />
      <circle cx="8" cy="32" r="2.5" fill="#6EE7B7" opacity="0.8" />
    </svg>
  );
}

interface Layer {
  key: string;
  mark: React.ReactNode;
  name: string;
  role: string;
  owns: string;
  tags: string[];
  color: string;
  highlight?: boolean;
}

const LAYERS: Layer[] = [
  {
    key: "vault",
    mark: <ObsidianMark />,
    name: "Obsidian vault",
    role: "Your permanent brain",
    owns: "Notes, knowledge, and the handful of moments worth keeping forever.",
    tags: ["knowledge", "written by your agent only"],
    color: "#A78BFA",
  },
  {
    key: "lifeos",
    mark: (
      <img src={asset("icon.png?v=3")} alt="" className="h-8 w-8" />
    ),
    name: "Life OS",
    role: "Where the doing happens",
    owns:
      "Every habit tick, study timer, schedule block, and XP award. The day you actually lived.",
    tags: ["this app", "local SQLite"],
    color: "var(--accent)",
    highlight: true,
  },
  {
    key: "agents",
    mark: <AgentMark />,
    name: "Your AI agent",
    role: "The one doing the thinking",
    owns:
      "Designs your habits, plans the day, sets XP weights, injects reviews, and adjusts when you drift.",
    tags: ["Hermes", "OpenClaw", "Claude Code", "any HTTP agent"],
    color: "#34D399",
  },
];

export function LayersStack() {
  return (
    <div className="space-y-3">
      {LAYERS.map((layer, i) => (
        <div key={layer.key}>
          <Reveal delay={i * 90}>
            <article
              className="relative overflow-hidden rounded-2xl border p-5 sm:p-6"
              style={{
                borderColor: layer.highlight
                  ? "color-mix(in oklch, var(--accent) 45%, transparent)"
                  : "rgba(255,255,255,0.08)",
                background: layer.highlight
                  ? "linear-gradient(135deg, color-mix(in oklch, var(--accent) 14%, transparent), transparent 65%)"
                  : "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.012))",
              }}
            >
              <span
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: layer.color }}
              />

              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: layer.highlight
                      ? "color-mix(in oklch, var(--accent) 18%, transparent)"
                      : "rgba(255,255,255,0.05)",
                  }}
                >
                  {layer.mark}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-lg font-bold tracking-tight">
                      {layer.name}
                    </h3>
                    <span
                      className="font-mono text-[11px] uppercase tracking-[0.14em]"
                      style={{ color: layer.color }}
                    >
                      {layer.role}
                    </span>
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {layer.owns}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {layer.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-white/[0.08] px-2.5 py-0.5 font-mono text-[10px] text-[var(--faint)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          </Reveal>

          {/* connector between layers */}
          {i < LAYERS.length - 1 && (
            <Reveal delay={i * 90 + 45}>
              <div className="flex items-center justify-center gap-2 py-2.5">
                <ArrowUp
                  className="h-3.5 w-3.5"
                  style={{ color: LAYERS[i + 1]!.color }}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--faint)]">
                  {i === 0
                    ? "escalates only what is genuinely special"
                    : "reads the day, writes the structure"}
                </span>
              </div>
            </Reveal>
          )}
        </div>
      ))}

      <Reveal delay={300}>
        <p className="pt-2 text-center font-mono text-[11px] text-[var(--faint)]">
          Life OS never writes to your vault. Only your agent does, and only
          when something is worth keeping.
        </p>
      </Reveal>
    </div>
  );
}
