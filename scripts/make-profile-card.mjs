#!/usr/bin/env node
/**
 * Generate the Life OS card for a GitHub profile README.
 *
 *   node scripts/make-profile-card.mjs
 *
 * Writes docs/life-os-card.svg with the brand icon inlined as a data URI, so
 * the card is a single self-contained file that renders anywhere — GitHub
 * proxies README images and blocks external references, so nothing may be
 * fetched at render time.
 *
 * Needs Playwright only to downscale the 1024px icon (1.5 MB) to something
 * sane to embed. Run `npm i -D playwright` first if it is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconPath = path.join(root, "docs", "icon.png");
const outPath = path.join(root, "docs", "life-os-card.svg");

const LIVE_URL = "https://entangledquantum.github.io/Life_OS/";
const REPO_URL = "github.com/EntangledQuantum/Life_OS";

// ------------------------------------------------------- shrink + inline icon
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const iconDataUri = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, 128, 128);
  return c.toDataURL("image/png");
}, fs.readFileSync(iconPath).toString("base64"));
await browser.close();

// ------------------------------------------------------------------ the card
const W = 850;
const H = 268;

/** The continuous day ribbon — the app's most recognisable element. */
const RIBBON = [
  { w: 96, c: "#6366F1" }, // Sleep
  { w: 74, c: "#5B8CFF" }, // Life
  { w: 132, c: "#A78BFA" }, // Deep Work
  { w: 68, c: "#34D399" }, // Health
  { w: 148, c: "#C084FC" }, // Study
  { w: 58, c: "#94A3B8" }, // Break
  { w: 110, c: "#FBBF24" }, // Startup
  { w: 84, c: "#5B8CFF" }, // Life
];

const ribbonX = 40;
const ribbonW = W - 80;
const ribbonTotal = RIBBON.reduce((a, s) => a + s.w, 0);
let cursor = ribbonX;
const ribbonSegments = RIBBON.map((s) => {
  const w = (s.w / ribbonTotal) * ribbonW;
  const seg = `<rect x="${cursor.toFixed(1)}" y="214" width="${(w + 0.6).toFixed(1)}" height="9" fill="${s.c}"/>`;
  cursor += w;
  return seg;
}).join("");
const nowX = (ribbonX + ribbonW * 0.62).toFixed(1);

const chips = [
  { label: "habits · study · sleep", x: 142 },
  { label: "agent-controlled", x: 316 },
  { label: "local-first", x: 452 },
];
const chipWidths = { 142: 160, 316: 122, 452: 92 };
const chipsSvg = chips
  .map(
    (c) =>
      `<g>
      <rect x="${c.x}" y="152" width="${chipWidths[c.x]}" height="24" rx="12" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.09)"/>
      <text x="${c.x + chipWidths[c.x] / 2}" y="168" text-anchor="middle" class="chip">${c.label}</text>
    </g>`,
  )
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Life OS — an ADHD life manager your AI agent runs for you">
  <title>Life OS — an ADHD life manager your AI agent runs for you</title>

  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0c0e15"/>
      <stop offset="55%" stop-color="#0a0b10"/>
      <stop offset="100%" stop-color="#0e1018"/>
    </linearGradient>
    <linearGradient id="wordmark" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#E9EDF6"/>
      <stop offset="100%" stop-color="#9FB6E8"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22D3EE"/>
      <stop offset="50%" stop-color="#5B8CFF"/>
      <stop offset="100%" stop-color="#A78BFA"/>
    </linearGradient>
    <linearGradient id="stem" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#2F6B4F"/>
      <stop offset="100%" stop-color="#4ADE80"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6EE7B7"/>
      <stop offset="100%" stop-color="#34D399"/>
    </linearGradient>
    <linearGradient id="pot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3A2A22"/>
      <stop offset="100%" stop-color="#241A15"/>
    </linearGradient>
    <radialGradient id="glowA" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#5B8CFF" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#5B8CFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#A78BFA" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#A78BFA" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowC" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#34D399" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#34D399" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0H0V34" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
    </pattern>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="20"/></clipPath>
  </defs>

  <style>
    .wordmark { font: 800 34px 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; letter-spacing: 1.5px; }
    .tag      { font: 600 16px 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; fill: #C6CEDE; }
    .sub      { font: 400 13.5px 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; fill: #79839A; }
    .chip     { font: 500 11px ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace; fill: #93A0B8; letter-spacing: 0.4px; }
    .meta     { font: 500 11.5px ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace; fill: #5E6980; letter-spacing: 0.5px; }
    .metaHi   { font: 600 11.5px ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace; fill: #7FA6F5; letter-spacing: 0.5px; }
    .pct      { font: 700 21px ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace; fill: #E9EDF6; }
    .pctSm    { font: 600 10px ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace; fill: #5E6980; letter-spacing: 0.6px; }

    /* Subtle life — degrades to a static card wherever animation is ignored. */
    @keyframes nowPulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
    @keyframes breathe  { 0%,100% { opacity: .55 } 50% { opacity: .95 } }
    @keyframes drift    { 0% { transform: translateX(0) } 100% { transform: translateX(-34px) } }
    .now   { animation: nowPulse 2.4s ease-in-out infinite; }
    .halo  { animation: breathe 4.5s ease-in-out infinite; }
    .gridA { animation: drift 24s linear infinite; }
    @media (prefers-reduced-motion: reduce) {
      .now, .halo, .gridA { animation: none; }
    }
  </style>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <g class="gridA"><rect x="-40" width="${W + 80}" height="${H}" fill="url(#grid)"/></g>
    <ellipse cx="120" cy="20" rx="300" ry="180" fill="url(#glowA)"/>
    <ellipse cx="700" cy="40" rx="260" ry="170" fill="url(#glowB)"/>
    <ellipse cx="640" cy="230" rx="220" ry="140" fill="url(#glowC)"/>

    <!-- brand -->
    <ellipse class="halo" cx="82" cy="86" rx="52" ry="52" fill="url(#glowA)"/>
    <image href="${iconDataUri}" x="44" y="48" width="76" height="76"/>

    <text x="142" y="76" class="wordmark" fill="url(#wordmark)">LIFE OS</text>
    <text x="143" y="104" class="tag">An ADHD life manager your AI agent runs for you</text>
    <text x="143" y="128" class="sub">Your agent designs the habits and plans the day. You just tap.</text>
    ${chipsSvg}

    <!-- growth meter: the app's signature progress visual.
         Plant on the left of this group, numbers in their own right-hand
         column, so nothing sits on top of the pot. -->
    <g transform="translate(596, 30)">
      <!-- ghosted 100% state sitting behind the live one -->
      <g opacity="0.17">
        <path d="M52 118 C52 102 45 88 52 74 C59 60 52 50 52 40" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
        <circle cx="52" cy="36" r="10" fill="#fff"/>
        <ellipse cx="39" cy="94" rx="11" ry="5" fill="#fff" transform="rotate(-35 39 94)"/>
        <ellipse cx="65" cy="76" rx="11" ry="5" fill="#fff" transform="rotate(35 65 76)"/>
        <ellipse cx="40" cy="60" rx="10" ry="4.6" fill="#fff" transform="rotate(-32 40 60)"/>
      </g>
      <line x1="66" y1="36" x2="86" y2="36" stroke="#ffffff" stroke-opacity="0.20" stroke-width="1"/>
      <text x="90" y="39" class="pctSm">100%</text>

      <!-- live growth at 82% -->
      <path d="M52 118 C52 104 45 92 52 80 C57 71 53 64 52 58" fill="none" stroke="url(#stem)" stroke-width="4.5" stroke-linecap="round"/>
      <ellipse cx="39" cy="94" rx="11" ry="5" fill="url(#leaf)" transform="rotate(-35 39 94)"/>
      <ellipse cx="65" cy="76" rx="11" ry="5" fill="url(#leaf)" transform="rotate(35 65 76)"/>
      <ellipse cx="41" cy="64" rx="9.5" ry="4.4" fill="url(#leaf)" transform="rotate(-32 41 64)"/>

      <path d="M34 118 L38 145 Q52 151 66 145 L70 118 Z" fill="url(#pot)" stroke="rgba(255,255,255,0.08)"/>
      <ellipse cx="52" cy="118" rx="18" ry="4" fill="#413026"/>

      <!-- numbers column, clear of the plant and of each other -->
      <text x="214" y="74" text-anchor="end" class="pctSm">TODAY</text>
      <text x="214" y="108" text-anchor="end" class="pct">82<tspan class="pctSm">%</tspan></text>
      <rect x="132" y="120" width="82" height="5" rx="2.5" fill="rgba(255,255,255,0.08)"/>
      <rect x="132" y="120" width="67" height="5" rx="2.5" fill="url(#accent)"/>
      <text x="214" y="145" text-anchor="end" class="pctSm">163 / 200 XP</text>
    </g>

    <!-- continuous day ribbon -->
    <g>
      <text x="40" y="205" class="meta">DAY TIMELINE</text>
      <text x="${W - 40}" y="205" text-anchor="end" class="meta">00 — 24</text>
      ${ribbonSegments}
      <rect x="${ribbonX}" y="214" width="${ribbonW}" height="9" rx="4.5" fill="none"/>
      <g class="now">
        <rect x="${nowX}" y="210" width="2" height="17" fill="#ffffff"/>
      </g>
    </g>

    <!-- footer -->
    <text x="40" y="250" class="metaHi">${LIVE_URL.replace(/^https:\/\//, "").replace(/\/$/, "")}</text>
    <text x="${W - 40}" y="250" text-anchor="end" class="meta">${REPO_URL}</text>

    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="rgba(255,255,255,0.10)"/>
    <rect x="0" y="0" width="${W}" height="2.5" fill="url(#accent)" opacity="0.9"/>
  </g>
</svg>
`;

fs.writeFileSync(outPath, svg, "utf8");
console.log(
  `Wrote ${outPath} (${(Buffer.byteLength(svg) / 1024).toFixed(0)} KB, icon inlined)`,
);
