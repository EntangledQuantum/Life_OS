/**
 * Hand-built SVG illustrations for the landing page.
 * No external images, no icon fonts, no network requests — everything here is
 * inline vector that inherits the active accent theme.
 */

/* --------------------------------------------------------------- hero mock */

/** A stylised Life OS dashboard: masthead, metric rail, timeline, growth, log. */
export function DashboardMock({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 340"
      className={className}
      role="img"
      aria-label="Life OS dashboard preview"
    >
      <defs>
        <linearGradient id="mock-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(14% 0.016 260)" />
          <stop offset="100%" stopColor="oklch(9% 0.012 260)" />
        </linearGradient>
        <linearGradient id="mock-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect
        x="1"
        y="1"
        width="518"
        height="338"
        rx="16"
        fill="url(#mock-bg)"
        stroke="rgba(255,255,255,0.09)"
      />

      {/* window chrome */}
      <circle cx="22" cy="20" r="3.5" fill="#FB7185" opacity="0.7" />
      <circle cx="34" cy="20" r="3.5" fill="#FBBF24" opacity="0.7" />
      <circle cx="46" cy="20" r="3.5" fill="#34D399" opacity="0.7" />
      <line x1="1" y1="38" x2="519" y2="38" stroke="rgba(255,255,255,0.07)" />

      {/* masthead */}
      <text
        x="24"
        y="70"
        fill="var(--accent)"
        fontSize="22"
        fontWeight="700"
        fontFamily="Figtree, sans-serif"
      >
        Improving
      </text>
      <rect x="24" y="80" width="180" height="5" rx="2.5" fill="rgba(255,255,255,0.09)" />
      <rect x="24" y="92" width="126" height="5" rx="2.5" fill="rgba(255,255,255,0.06)" />

      <text
        x="496"
        y="66"
        textAnchor="end"
        fill="var(--accent)"
        fontSize="24"
        fontWeight="700"
        fontFamily="JetBrains Mono, monospace"
      >
        01:24:08
      </text>
      <text
        x="496"
        y="84"
        textAnchor="end"
        fill="rgba(255,255,255,0.35)"
        fontSize="9"
        fontFamily="Figtree, sans-serif"
      >
        Doing · Deep Work
      </text>

      {/* metric rail */}
      {[
        { x: 24, v: "6", l: "habits", d: "+2" },
        { x: 118, v: "184", l: "xp", d: "+41" },
        { x: 212, v: "92%", l: "efficiency", d: "+18" },
        { x: 306, v: "95m", l: "study", d: "+30" },
        { x: 400, v: "80", l: "sleep", d: "+5" },
      ].map((m) => (
        <g key={m.l}>
          <text
            x={m.x}
            y="132"
            fill="rgba(255,255,255,0.92)"
            fontSize="17"
            fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >
            {m.v}
          </text>
          <text
            x={m.x}
            y="145"
            fill="#34D399"
            fontSize="8"
            fontFamily="JetBrains Mono, monospace"
          >
            {m.d}
          </text>
          <text
            x={m.x}
            y="158"
            fill="rgba(255,255,255,0.3)"
            fontSize="8"
            fontFamily="Figtree, sans-serif"
            letterSpacing="1"
          >
            {m.l.toUpperCase()}
          </text>
        </g>
      ))}

      {/* continuous day ribbon */}
      <g>
        {[
          { x: 24, w: 84, c: "#6366F1" },
          { x: 108, w: 62, c: "#5B8CFF" },
          { x: 170, w: 96, c: "#A78BFA" },
          { x: 266, w: 54, c: "#34D399" },
          { x: 320, w: 108, c: "#C084FC" },
          { x: 428, w: 68, c: "#5B8CFF" },
        ].map((s) => (
          <rect key={s.x} x={s.x} y="178" width={s.w} height="11" fill={s.c} />
        ))}
        <rect x="24" y="178" width="472" height="11" rx="5.5" fill="none" />
        <line x1="318" y1="174" x2="318" y2="193" stroke="white" strokeWidth="1.5" />
      </g>

      {/* growth meter + sparkline */}
      <g transform="translate(24, 208)">
        <circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
        <path
          d="M42 76 A34 34 0 1 0 12 25"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <text
          x="42"
          y="47"
          textAnchor="middle"
          fill="rgba(255,255,255,0.9)"
          fontSize="15"
          fontWeight="600"
          fontFamily="JetBrains Mono, monospace"
        >
          92%
        </text>
      </g>

      <g transform="translate(130, 208)">
        <path
          d="M0 68 L44 52 L88 58 L132 30 L176 38 L220 14 L264 6 L264 84 L0 84 Z"
          fill="url(#mock-fill)"
        />
        <path
          d="M0 68 L44 52 L88 58 L132 30 L176 38 L220 14 L264 6"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M0 46 L264 46"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </g>

      {/* quick log rows */}
      <g transform="translate(410, 208)">
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(0, ${i * 26})`}>
            <circle cx="6" cy="8" r="4" fill={i === 0 ? "var(--accent)" : "rgba(255,255,255,0.16)"} />
            <rect
              x="18"
              y="5"
              width={i === 0 ? 66 : 54}
              height="5"
              rx="2.5"
              fill="rgba(255,255,255,0.14)"
            />
            <rect x="18" y="14" width="40" height="4" rx="2" fill="rgba(255,255,255,0.07)" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------- three layers */

export function LayersDiagram({ className }: { className?: string }) {
  const layers = [
    {
      y: 14,
      title: "Obsidian vault",
      sub: "permanent brain · knowledge & special memories",
      color: "#A78BFA",
    },
    {
      y: 96,
      title: "Life OS",
      sub: "execution layer · completions, streaks, XP, timeline",
      color: "var(--accent)",
      highlight: true,
    },
    {
      y: 178,
      title: "Hermes · OpenClaw · any agent",
      sub: "intelligence · designs habits, blocks, quests, XP rules",
      color: "#34D399",
    },
  ];

  return (
    <svg
      viewBox="0 0 460 260"
      className={className}
      role="img"
      aria-label="Three layers: Obsidian vault, Life OS, and agents"
    >
      {layers.map((l) => (
        <g key={l.title}>
          <rect
            x="60"
            y={l.y}
            width="340"
            height="62"
            rx="14"
            fill={l.highlight ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "rgba(255,255,255,0.03)"}
            stroke={l.highlight ? "var(--accent)" : "rgba(255,255,255,0.1)"}
            strokeWidth={l.highlight ? 1.6 : 1}
          />
          <rect x="60" y={l.y} width="4" height="62" rx="2" fill={l.color} />
          <text
            x="84"
            y={l.y + 27}
            fill="rgba(255,255,255,0.94)"
            fontSize="14"
            fontWeight="600"
            fontFamily="Figtree, sans-serif"
          >
            {l.title}
          </text>
          <text
            x="84"
            y={l.y + 44}
            fill="rgba(255,255,255,0.42)"
            fontSize="10"
            fontFamily="Figtree, sans-serif"
          >
            {l.sub}
          </text>
        </g>
      ))}

      {/* agent reads up into Life OS, and escalates into the vault */}
      <g>
        <path
          d="M230 178 L230 158"
          stroke="#34D399"
          strokeWidth="1.6"
          className="flow-line"
        />
        <path d="M230 152 l-4 8 h8 z" fill="#34D399" />
        <path
          d="M410 120 Q440 120 440 76 Q440 45 410 45"
          fill="none"
          stroke="#A78BFA"
          strokeWidth="1.4"
          className="flow-line"
        />
        <path d="M414 45 l8 -4 v8 z" fill="#A78BFA" transform="rotate(180 414 45)" />
        <text
          x="452"
          y="86"
          fill="rgba(255,255,255,0.34)"
          fontSize="8"
          fontFamily="JetBrains Mono, monospace"
          textAnchor="end"
        >
          escalate only
        </text>
        <text
          x="452"
          y="98"
          fill="rgba(255,255,255,0.34)"
          fontSize="8"
          fontFamily="JetBrains Mono, monospace"
          textAnchor="end"
        >
          what is special
        </text>
      </g>

      <text
        x="230"
        y="248"
        textAnchor="middle"
        fill="rgba(255,255,255,0.3)"
        fontSize="9"
        fontFamily="JetBrains Mono, monospace"
      >
        the app never writes to your vault
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------- XP diagram */

/** Shows a fixed pool being re-sliced across habits rather than growing. */
export function XpPoolDiagram({ className }: { className?: string }) {
  const before = [
    { label: "Wake", w: 3, color: "#FBBF24" },
    { label: "Water", w: 2, color: "#22D3EE" },
    { label: "Study", w: 4, color: "#A78BFA" },
    { label: "Move", w: 3, color: "#34D399" },
  ];
  const after = [
    { label: "Wake", w: 3, color: "#FBBF24" },
    { label: "Water", w: 2, color: "#22D3EE" },
    { label: "Study", w: 4, color: "#A78BFA" },
    { label: "Move", w: 3, color: "#34D399" },
    { label: "Read", w: 2, color: "#F472B6" },
  ];

  const bar = (
    items: typeof before,
    y: number,
    caption: string,
    sub: string,
  ) => {
    const total = items.reduce((a, i) => a + i.w, 0);
    let x = 0;
    return (
      <g key={caption}>
        <text
          x="0"
          y={y - 12}
          fill="rgba(255,255,255,0.5)"
          fontSize="10"
          fontFamily="Figtree, sans-serif"
        >
          {caption}
        </text>
        <text
          x="420"
          y={y - 12}
          textAnchor="end"
          fill="var(--accent)"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          {sub}
        </text>
        {items.map((i) => {
          const w = (i.w / total) * 420;
          const el = (
            <g key={i.label}>
              <rect
                x={x}
                y={y}
                width={w - 2}
                height="34"
                rx="5"
                fill={i.color}
                opacity="0.85"
              />
              <text
                x={x + (w - 2) / 2}
                y={y + 21}
                textAnchor="middle"
                fill="oklch(16% 0.02 260)"
                fontSize="9"
                fontWeight="700"
                fontFamily="Figtree, sans-serif"
              >
                {Math.floor((i.w / total) * 200)}
              </text>
            </g>
          );
          x += w;
          return el;
        })}
      </g>
    );
  };

  return (
    <svg
      viewBox="0 0 440 190"
      className={className}
      role="img"
      aria-label="A fixed daily XP pool re-sliced when a habit is added"
    >
      <g transform="translate(10, 30)">
        {bar(before, 0, "4 habits", "pool = 200 XP")}
        {bar(after, 92, "5 habits — pool unchanged", "still 200 XP")}
        <path
          d="M210 44 L210 70"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="1.4"
          className="flow-line"
        />
        <path d="M210 76 l-4 -8 h8 z" fill="rgba(255,255,255,0.35)" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------- agent flow loop */

export function AgentFlowDiagram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 250"
      className={className}
      role="img"
      aria-label="Agent writes structure, user completes, webhook notifies the agent"
    >
      {/* agent */}
      <g>
        <rect
          x="16"
          y="88"
          width="132"
          height="74"
          rx="14"
          fill="rgba(52,211,153,0.08)"
          stroke="#34D399"
          strokeWidth="1.4"
        />
        <text x="82" y="116" textAnchor="middle" fill="#34D399" fontSize="13" fontWeight="600" fontFamily="Figtree, sans-serif">
          Your agent
        </text>
        <text x="82" y="133" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="Figtree, sans-serif">
          Hermes · OpenClaw
        </text>
        <text x="82" y="147" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="Figtree, sans-serif">
          Claude Code · cron
        </text>
      </g>

      {/* life os */}
      <g>
        <rect
          x="186"
          y="78"
          width="126"
          height="94"
          rx="14"
          fill="color-mix(in oklch, var(--accent) 12%, transparent)"
          stroke="var(--accent)"
          strokeWidth="1.6"
        />
        <text x="249" y="108" textAnchor="middle" fill="var(--accent)" fontSize="13" fontWeight="700" fontFamily="Figtree, sans-serif">
          LIFE OS
        </text>
        <text x="249" y="126" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="JetBrains Mono, monospace">
          /api/v1
        </text>
        <text x="249" y="141" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="JetBrains Mono, monospace">
          + MCP stdio
        </text>
        <text x="249" y="158" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="Figtree, sans-serif">
          local SQLite
        </text>
      </g>

      {/* user */}
      <g>
        <rect
          x="350"
          y="88"
          width="114"
          height="74"
          rx="14"
          fill="rgba(255,255,255,0.03)"
          stroke="rgba(255,255,255,0.14)"
        />
        <text x="407" y="118" textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="13" fontWeight="600" fontFamily="Figtree, sans-serif">
          You
        </text>
        <text x="407" y="136" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="Figtree, sans-serif">
          one tap to complete
        </text>
      </g>

      {/* agent → life os */}
      <path d="M150 116 L182 116" stroke="#34D399" strokeWidth="1.6" className="flow-line" />
      <path d="M188 116 l-8 -4 v8 z" fill="#34D399" />
      <text x="166" y="104" textAnchor="middle" fill="rgba(255,255,255,0.36)" fontSize="8" fontFamily="JetBrains Mono, monospace">
        writes
      </text>

      {/* life os → user */}
      <path d="M314 116 L346 116" stroke="var(--accent)" strokeWidth="1.6" className="flow-line" />
      <path d="M352 116 l-8 -4 v8 z" fill="var(--accent)" />
      <text x="330" y="104" textAnchor="middle" fill="rgba(255,255,255,0.36)" fontSize="8" fontFamily="JetBrains Mono, monospace">
        shows
      </text>

      {/* webhook loop back to agent */}
      <path
        d="M407 168 Q407 214 249 214 Q82 214 82 168"
        fill="none"
        stroke="#FBBF24"
        strokeWidth="1.5"
        className="flow-line"
      />
      <path d="M82 162 l-4 8 h8 z" fill="#FBBF24" />
      <text x="249" y="232" textAnchor="middle" fill="#FBBF24" fontSize="9" fontFamily="JetBrains Mono, monospace">
        webhook · habit.complete · card.complete
      </text>

      <text x="240" y="34" textAnchor="middle" fill="rgba(255,255,255,0.88)" fontSize="12" fontWeight="600" fontFamily="Figtree, sans-serif">
        The agent customizes. You complete.
      </text>
      <text x="240" y="52" textAnchor="middle" fill="rgba(255,255,255,0.38)" fontSize="9.5" fontFamily="Figtree, sans-serif">
        No forms to fill in. No structure to maintain by hand.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------- feature vignettes */

export function TimelineArt({ className }: { className?: string }) {
  const segs = [
    { w: 74, c: "#6366F1" },
    { w: 52, c: "#5B8CFF" },
    { w: 88, c: "#A78BFA" },
    { w: 44, c: "#34D399" },
    { w: 76, c: "#C084FC" },
    { w: 46, c: "#5B8CFF" },
  ];
  let x = 0;
  return (
    <svg viewBox="0 0 380 120" className={className} role="img" aria-label="Continuous day timeline">
      <text x="0" y="22" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="JetBrains Mono, monospace">
        00:00
      </text>
      <text x="380" y="22" textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="JetBrains Mono, monospace">
        24:00
      </text>
      {segs.map((s, i) => {
        const el = <rect key={i} x={x} y="38" width={s.w} height="18" fill={s.c} />;
        x += s.w;
        return el;
      })}
      <line x1="228" y1="32" x2="228" y2="62" stroke="white" strokeWidth="2" />
      <text x="228" y="78" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="8" fontFamily="JetBrains Mono, monospace">
        now
      </text>
      <text x="0" y="104" fill="rgba(255,255,255,0.34)" fontSize="9" fontFamily="Figtree, sans-serif">
        One solid ribbon — no black holes where the day went unplanned.
      </text>
    </svg>
  );
}

export function QuickLogArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 380 140" className={className} role="img" aria-label="Quick log with agent items on top">
      <rect x="0" y="6" width="380" height="38" rx="9" fill="color-mix(in oklch, var(--accent) 13%, transparent)" stroke="var(--accent)" strokeWidth="1.2" />
      <circle cx="20" cy="25" r="4.5" fill="var(--accent)">
        <animate attributeName="opacity" values="1;0.25;1" dur="1.7s" repeatCount="indefinite" />
      </circle>
      <text x="36" y="22" fill="var(--accent)" fontSize="8" fontFamily="JetBrains Mono, monospace" letterSpacing="1">
        REVIEW
      </text>
      <text x="36" y="35" fill="rgba(255,255,255,0.88)" fontSize="11" fontFamily="Figtree, sans-serif">
        Feynman one concept from yesterday
      </text>
      <rect x="300" y="14" width="66" height="21" rx="7" fill="var(--accent)" />
      <text x="333" y="28" textAnchor="middle" fill="oklch(14% 0.02 260)" fontSize="9" fontWeight="700" fontFamily="Figtree, sans-serif">
        Complete
      </text>

      {[58, 92].map((y, i) => (
        <g key={y} opacity={0.45}>
          <circle cx="20" cy={y + 14} r="4.5" fill="rgba(255,255,255,0.2)" />
          <rect x="36" y={y + 9} width={i === 0 ? 150 : 118} height="6" rx="3" fill="rgba(255,255,255,0.13)" />
          <rect x="36" y={y + 21} width="86" height="5" rx="2.5" fill="rgba(255,255,255,0.07)" />
        </g>
      ))}
      <text x="0" y="136" fill="rgba(255,255,255,0.34)" fontSize="9" fontFamily="Figtree, sans-serif">
        Agent work flashes on top; habits step aside until the queue is clear.
      </text>
    </svg>
  );
}

export function VsYesterdayArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 380 140" className={className} role="img" aria-label="Today compared with yesterday">
      {[
        { x: 0, label: "yesterday", h: 46, fill: "rgba(255,255,255,0.13)", v: "74%" },
        { x: 132, label: "today", h: 78, fill: "var(--accent)", v: "92%" },
      ].map((b) => (
        <g key={b.label}>
          <rect x={b.x + 18} y={100 - b.h} width="72" height={b.h} rx="8" fill={b.fill} />
          <text x={b.x + 54} y={94 - b.h} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="12" fontWeight="600" fontFamily="JetBrains Mono, monospace">
            {b.v}
          </text>
          <text x={b.x + 54} y="118" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="Figtree, sans-serif">
            {b.label}
          </text>
        </g>
      ))}
      <g transform="translate(258, 40)">
        <path d="M0 30 L20 6 L40 18 L62 0" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M56 0 h8 v8" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" />
        <text x="32" y="52" textAnchor="middle" fill="#34D399" fontSize="15" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          +18
        </text>
        <text x="32" y="66" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8.5" fontFamily="Figtree, sans-serif">
          points of improvement
        </text>
      </g>
      <text x="0" y="136" fill="rgba(255,255,255,0.34)" fontSize="9" fontFamily="Figtree, sans-serif">
        The only comparison in the product. No leaderboards, no streak shaming.
      </text>
    </svg>
  );
}
