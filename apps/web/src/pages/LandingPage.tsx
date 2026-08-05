import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  Database,
  Download,
  Github,
  HardDrive,
  Layers,
  Moon,
  Plug,
  Smartphone,
  Sparkles,
  Terminal,
  Webhook,
  Zap,
} from "lucide-react";
import { GROWTH_STYLES, type GrowthStyle } from "@life-os/shared";
import { GrowthMeter } from "@/components/graphics/GrowthMeter";
import {
  CodeBlock,
  Reveal,
  SectionHeading,
} from "@/components/landing/Reveal";
import { LayersStack } from "@/components/landing/LayersStack";
import {
  AgentFlowDiagram,
  DashboardMock,
  QuickLogArt,
  TimelineArt,
  VsYesterdayArt,
  XpPoolDiagram,
} from "@/components/landing/illustrations";
import {
  ANDROID_APK_URL,
  asset,
  IS_PAGES,
  RELEASES_URL,
  REPO_URL,
} from "@/lib/deploy";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#start", label: "Quick start" },
  { href: "#features", label: "Features" },
  { href: "#xp", label: "XP" },
];

export function LandingPage() {
  return (
    <div className="relative min-h-screen">
      <Background />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <HowItWorks />
        {/* Getting running is one story — start the server, hand it the brief.
            It sits here rather than at the bottom because it is what someone
            who has just decided they want this actually needs next. */}
        <QuickStart />
        <Features />
        <GrowthSection />
        <XpSection />
        <DatabaseSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------- background */

function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="app-aurora app-aurora-a" />
      <div className="app-aurora app-aurora-b" />
      <div className="app-aurora app-aurora-c" />
      <div className="app-grid-lines" />
      <div className="app-grain" />
      <div className="app-vignette" />
    </div>
  );
}

/* -------------------------------------------------------------------- nav */

/**
 * One call to action, everywhere: Get started, pointing at the quick start.
 * There used to be a second "See the agent setup" button beside it, back when
 * running the server and briefing the agent were two separate sections. They
 * are one section now, so it is one button.
 */
function PrimaryCta({ className }: { className?: string }) {
  return (
    <a href="#start" className={cn("btn btn-primary", className)}>
      Get started <ArrowRight className="h-4 w-4" />
    </a>
  );
}

/**
 * Direct APK download. Points at `releases/latest/...`, so publishing a new
 * build updates it without touching this page.
 */
function AndroidDownload({ className }: { className?: string }) {
  return (
    <a href={ANDROID_APK_URL} className={cn("btn", className)}>
      <Download className="h-4 w-4" /> Android app
      <span className="text-[11px] text-[var(--faint)]">beta</span>
    </a>
  );
}

/** Only meaningful when the app is actually being served next to the API. */
function DashboardLink({ className }: { className?: string }) {
  if (IS_PAGES) return null;
  return (
    <Link to="/app" className={cn("btn", className)}>
      Open dashboard <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.05] bg-[oklch(7%_0.01_260_/_0.72)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <a href="#top" className="flex shrink-0 items-center gap-2.5">
          <img src={asset("icon.png?v=3")} alt="" className="h-9 w-9" />
          <span className="text-lg font-bold tracking-tight">LIFE OS</span>
        </a>

        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="btn px-3 py-2"
            aria-label="View source on GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <PrimaryCta />
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------- hero */

function Hero() {
  return (
    <section id="top" className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-12">
        <motion.div
          className="lg:col-span-6"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* text-balance keeps the two clauses from breaking on a stray word */}
          <h1 className="text-[2.6rem] font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl lg:text-[3.1rem]">
            An ADHD life manager{" "}
            <span className="text-[var(--accent)]">
              your AI agent runs for you.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
            Track habits, study sessions, sleep, and self-improvement in one
            place. Your agent builds the structure — which habits, what today
            looks like, what they are worth — and keeps adjusting it. You just
            tap to complete.
          </p>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--faint)]">
            Runs on your own machine. Open source, no account, no subscription.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PrimaryCta className="px-6 py-3 text-base" />
            <AndroidDownload className="px-6 py-3 text-base" />
            <DashboardLink className="px-6 py-3 text-base" />
          </div>

          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/[0.06] pt-7">
            {[
              { v: "0", l: "levels · no ranks" },
              { v: "1", l: "file database" },
              { v: "04:00", l: "day reset, night-owl" },
            ].map((s) => (
              <div key={s.l}>
                <dt className="font-mono text-2xl font-semibold tracking-tight text-[var(--accent)]">
                  {s.v}
                </dt>
                <dd className="mt-1 text-[11px] uppercase tracking-wider text-[var(--faint)]">
                  {s.l}
                </dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div
          className="lg:col-span-6"
          initial={{ opacity: 0, y: 28, rotateX: 6 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="float-slow">
            <DashboardMock className="w-full drop-shadow-[0_30px_60px_rgba(0,0,0,0.5)]" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- how it works */

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHeading
        eyebrow="How it fits together"
        title="Three layers, one job each"
        lede="Most systems collapse because one tool tries to be your notes, your tracker, and your planner at once. Life OS only does the doing — your notes stay in Obsidian, and the planning is your agent's job."
      />

      <div className="mt-14 grid items-start gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <LayersStack />
        </div>

        <div className="space-y-5 lg:col-span-5">
          {[
            {
              icon: Layers,
              title: "Separation that actually holds",
              body: "Every habit tick, timer, and XP award lives in Life OS. Your notes never fill up with 'drank water ✓'. Your agent decides what was special enough to write into Obsidian.",
            },
            {
              icon: Bot,
              title: "You are not maintaining a system",
              body: "Habits, schedule blocks, quests, reviews, card content, XP weights, themes — all set through the API. No settings archaeology, no rebuilding your tracker every month.",
            },
            {
              icon: Moon,
              title: "Built for a night-owl day",
              body: "The day boundary is configurable and defaults to 04:00, so a 1am study session counts toward the day you were actually awake for.",
            },
          ].map((item, i) => (
            <Reveal key={item.title} delay={i * 80}>
              <div className="panel flex gap-4 p-5">
                <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                    {item.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- features */

const FEATURE_ROWS = [
  {
    eyebrow: "Day timeline",
    title: "One continuous ribbon, midnight to midnight",
    body: "Your agent lays out the day as coloured blocks. Gaps close automatically, so the timeline reads as a solid band of intent instead of a broken bar full of dead space. Start a block and the Right Now timer takes over.",
    art: TimelineArt,
  },
  {
    eyebrow: "Quick log",
    title: "Agent work first, habits second",
    body: "Reviews and tasks your agent injects sit at the top and pulse until they are done. While that queue has anything in it, habits step out of the way — one decision at a time, which is the whole point.",
    art: QuickLogArt,
    flip: true,
  },
  {
    eyebrow: "Improvement pulse",
    title: "You versus yesterday. Nothing else.",
    body: "Efficiency is today's XP over today's target. Improvement is the difference from yesterday, in plain percentage points. There are no levels, no ranks, and nobody else on the screen.",
    art: VsYesterdayArt,
  },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHeading
        eyebrow="What you actually see"
        title="A dashboard that shows the day, not a scoreboard"
        lede="Open layout, no card clutter, no guilt. Every element answers a question you asked at that moment."
      />

      <div className="mt-16 space-y-20">
        {FEATURE_ROWS.map((row) => (
          <Reveal key={row.title}>
            <div
              className={cn(
                "grid items-center gap-10 lg:grid-cols-2",
                row.flip && "lg:[&>*:first-child]:order-2",
              )}
            >
              <div className="panel p-6 sm:p-8">
                <row.art className="w-full" />
              </div>
              <div>
                <p className="section-eyebrow">{row.eyebrow}</p>
                <h3 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                  {row.title}
                </h3>
                <p className="mt-4 leading-relaxed text-[var(--muted)]">
                  {row.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Zap,
            title: "One-tap complete",
            body: "Tap, get XP, undo if you misfired. Streaks are forgiving — history is preserved, never punished.",
          },
          {
            icon: CalendarClock,
            title: "Real elapsed time",
            body: "Start a study block, complete it, and the actual duration is logged — not the time you planned.",
          },
          {
            icon: Sparkles,
            title: "Celebrations you control",
            body: "Full, minimal, or off. Four accent themes. Reduced-motion respected throughout.",
          },
          {
            icon: HardDrive,
            title: "Yours on disk",
            body: "One SQLite file. No account, no cloud, no telemetry. Export the lot as JSON whenever you like.",
          },
        ].map((f, i) => (
          <Reveal key={f.title} delay={i * 60}>
            <div className="panel h-full p-5">
              <f.icon className="mb-3 h-5 w-5 text-[var(--accent)]" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {f.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- growth meter */

function GrowthSection() {
  const [pct, setPct] = useState(64);
  const [style, setStyle] = useState<GrowthStyle>("sprout");

  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <SectionHeading
        eyebrow="Growth meter"
        title="Progress you can see at a glance"
        lede="Your daily XP target drawn as something that grows. The 100% state is always ghosted behind the live one, so the distance left is visible without reading a single number. Drag the slider."
      />

      <Reveal className="mt-12">
        <div className="panel panel-accent grid items-center gap-10 p-8 lg:grid-cols-2">
          <div className="flex justify-center">
            <GrowthMeter
              efficiencyPct={pct}
              style={style}
              dailyXp={Math.round((pct / 100) * 200)}
              dailyXpTarget={200}
            />
          </div>

          <div className="space-y-6">
            <div>
              <label
                htmlFor="growth-demo"
                className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]"
              >
                Today's efficiency — {Math.round(pct)}%
              </label>
              <input
                id="growth-demo"
                type="range"
                min={0}
                max={100}
                value={pct}
                onChange={(e) => setPct(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
                Style
              </p>
              <div className="flex gap-2">
                {GROWTH_STYLES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyle(s)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm capitalize transition-colors",
                      style === s
                        ? "bg-[var(--accent)] font-medium text-[oklch(12%_0.02_260)]"
                        : "bg-white/[0.05] text-[var(--muted)] hover:bg-white/[0.1]",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Your agent can switch this at any time with a single{" "}
              <code className="font-mono text-xs text-[var(--text)]">
                PATCH /gamification/config
              </code>
              . It is deliberately not called a water meter — that name belongs
              to the habit where you actually drink water.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------------------------------------------------------- agents */

/* -------------------------------------------------------------------- XP */

function XpSection() {
  return (
    <section id="xp" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHeading
        eyebrow="The XP system"
        title="A fixed pool, re-sliced — never inflated"
        lede="Most habit apps let your daily score balloon as you add habits, so 100% stops meaning anything. Life OS fixes the pool and divides it by weight. Adding a habit changes the slices, not the size of the pie."
      />

      <Reveal className="mt-12">
        <div className="panel p-6 sm:p-10">
          <XpPoolDiagram className="mx-auto w-full max-w-2xl" />
        </div>
      </Reveal>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[
          {
            k: "The pool",
            v: "dailyXpTarget",
            body: "Defaults to 200. Only your agent changes it, via the gamification config. Nothing else can inflate it.",
          },
          {
            k: "The slices",
            v: "xpWeight → baseXp",
            body: "Each active habit gets a share proportional to its weight. Create, delete, or reweight a habit and everything rebalances.",
          },
          {
            k: "The bonuses",
            v: "extraXp",
            body: "Cards, quests, achievements, and agent tasks award XP on top of the pool — which is how a great day can pass 100%.",
          },
        ].map((c, i) => (
          <Reveal key={c.k} delay={i * 70}>
            <div className="panel h-full p-5">
              <p className="section-eyebrow">{c.k}</p>
              <p className="mt-2 font-mono text-sm text-[var(--accent)]">{c.v}</p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                {c.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-8">
        <div className="panel p-5 font-mono text-xs leading-relaxed text-[var(--muted)] sm:text-sm">
          <div>
            efficiency<span className="text-[var(--faint)]"> = </span>
            todayXp <span className="text-[var(--faint)]">/</span> dailyXpTarget
          </div>
          <div className="mt-1">
            improvement<span className="text-[var(--faint)]"> = </span>
            todayEfficiency <span className="text-[var(--faint)]">−</span>{" "}
            yesterdayEfficiency
          </div>
          <div className="mt-3 text-[var(--faint)]">
            {"// no levels, no ranks, no other people in the maths"}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------ quick start */

const AGENT_BRIEF = `Set up Life OS for me and then run my day with it.

1. Check whether it is already running:
     curl -s http://127.0.0.1:8787/health

2. If nothing answers, ask me where to put it, then:
     git clone https://github.com/EntangledQuantum/Life_OS.git Life_OS
     cd Life_OS
     pnpm setup
     pnpm dev

   Needs Node 22.5+ and pnpm. Do not clone or install until I say yes.
   Setup prints an API token once — ask me for it, do not guess it.

3. Read the skill so you know the whole API:
     docs/skills/life-os/SKILL.md

4. Authenticate with the API_TOKEN from my .env, on every request:
     Authorization: Bearer <API_TOKEN>

   There is no username/password login; POST /api/v1/auth/login returns 410.
   Never print the token back to me or write it into a file you commit.

5. Learn the XP rules before changing anything:
     GET /api/v1/agent/xp-model

6. Then, from now on:
   - ask me what I want to build into my days, and create those habits
   - block out my day on the timeline each morning
   - put what I am reading or working on into a front-page card
   - inject reviews and tasks into my Quick log
   - each night, read GET /api/v1/dashboard/today and tell me how the day went

If you are Hermes:
  load docs/skills/life-os/SKILL.md as a skill, then ask me before creating
  any scheduled morning/end-of-day jobs.

If you are OpenClaw:
  copy docs/skills/life-os/ into your workspace skills/ root, then invoke it
  with /skill life-os.

If you are Claude Code:
  claude mcp add life-os -- pnpm --filter @life-os/mcp start
  or just use the HTTP API above.

Rules: never write to my Obsidian vault from the app. Never add levels or
compare me to anyone. Ask before installing anything.`;

const CLONE_STEPS = `git clone ${REPO_URL}.git Life_OS
cd Life_OS
pnpm setup
pnpm dev`;

function QuickStart() {
  return (
    <section id="start" className="mx-auto max-w-6xl px-5 py-24">
      <SectionHeading
        eyebrow="Quick start"
        title="Run it, then hand it to your agent"
        lede="Two steps and you are done. Needs Node 22.5 or newer and pnpm. `pnpm setup` writes your .env, generates your API token, installs everything, provisions the database, applies migrations, and seeds starter habits — it is safe to re-run."
      />

      {/* ------------------------------------------------------- step one */}
      <Reveal className="mt-14">
        <Step n={1} title="Start the server" />
      </Reveal>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <Reveal>
          <CodeBlock code={CLONE_STEPS} label="install and run" />
        </Reveal>

        <Reveal delay={100}>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { k: "App", v: "127.0.0.1:5173" },
              { k: "API", v: "127.0.0.1:8787" },
              { k: "Sign-in", v: "API token" },
              { k: "Database", v: "data/lifeos.db" },
            ].map((r) => (
              <div
                key={r.k}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] px-4 py-2.5"
              >
                <span className="text-sm text-[var(--muted)]">{r.k}</span>
                <span className="font-mono text-xs text-[var(--text)]">
                  {r.v}
                </span>
              </div>
            ))}
          </div>
          <div className="panel mt-3 flex flex-wrap items-center gap-4 p-5">
            <Smartphone className="h-5 w-5 shrink-0 text-[var(--accent)]" />
            <div className="min-w-[12rem] flex-1">
              <h4 className="font-semibold">Android app</h4>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                Same token, same day. Install the APK, then point it at this
                machine&apos;s address while you are on the same Wi-Fi. You will
                need to allow installing from unknown sources.{" "}
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  Release notes
                </a>
              </p>
            </div>
            <AndroidDownload className="shrink-0" />
          </div>

          <div className="panel mt-3 p-5">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Setup generates a strong{" "}
              <code className="font-mono text-xs text-[var(--text)]">API_TOKEN</code>{" "}
              and prints it once. Paste it into the app on first load. That token
              is the only credential Life OS has — there is no account, no
              password, and no shipped default.
            </p>
          </div>
        </Reveal>
      </div>

      {/* ------------------------------------------------------- step two */}
      <Reveal className="mt-16">
        <Step n={2} title="Paste this into your agent" />
      </Reveal>

      <Reveal className="mt-6">
        <p className="mb-5 max-w-3xl text-[var(--muted)]">
          You do not configure Life OS by clicking through settings. You tell an
          agent what you want out of your days, and it writes the habits, the
          schedule, and the scoring for you. Works with Hermes, OpenClaw, Claude
          Code, or anything that can run a shell and call an API.
        </p>
        <CodeBlock
          code={AGENT_BRIEF}
          label="paste into your agent"
          previewLines={12}
        />
      </Reveal>

      <Reveal className="mt-10">
        <div className="panel p-6 sm:p-10">
          <AgentFlowDiagram className="mx-auto w-full max-w-2xl" />
        </div>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {[
          {
            icon: Plug,
            title: "HTTP and MCP, same brain",
            body: "A full REST surface under /api/v1, plus an MCP stdio server sharing the same database. Cards, blocks, habits, events, XP rules, and settings are reachable from both.",
          },
          {
            icon: Webhook,
            title: "Webhooks close the loop",
            body: "Complete a habit or a card and Life OS posts to your agent with the entity, the XP awarded, and your note — so it can update its own memory or your vault.",
          },
          {
            icon: Bot,
            title: "Front-page cards, including SVG",
            body: "Two content cards plus a dedicated agent-setup card. Agents can ship their own inline SVG artwork; it is sanitized and rendered sandboxed.",
          },
          {
            icon: Terminal,
            title: "No server? It can offer to install one",
            body: "The skill tells your agent to detect a dead API, ask your permission, then clone the repo and run a single setup command. It never clones behind your back.",
          },
        ].map((f, i) => (
          <Reveal key={f.title} delay={i * 70}>
            <div className="panel flex h-full gap-4 p-5">
              <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
              <div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                  {f.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** Numbered marker for the two quick-start steps. */
function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] font-mono text-sm font-semibold text-[var(--accent)]">
        {n}
      </span>
      <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
    </div>
  );
}

/* -------------------------------------------------------------- database */

function DatabaseSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <SectionHeading
        eyebrow="Your data"
        title="One file. On your machine. Permanent."
        lede="There is nothing to provision and no account to create. The first run creates a SQLite database and it stays there — through restarts, rebuilds, and git pulls."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Database,
            title: "Created automatically",
            body: "pnpm setup builds it, and the API also self-migrates on boot — so a fresh clone works even if you skip the setup step entirely.",
          },
          {
            icon: HardDrive,
            title: "Never overwritten",
            body: "Migrations only add. The seed only fills empty tables. Re-running setup on an existing install cannot delete your history.",
          },
          {
            icon: Github,
            title: "Never committed",
            body: "data/*.db is gitignored, so pushing the repo never pushes your life. Everyone who clones gets their own empty database.",
          },
        ].map((f, i) => (
          <Reveal key={f.title} delay={i * 70}>
            <div className="panel h-full p-5">
              <f.icon className="mb-3 h-5 w-5 text-[var(--accent)]" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {f.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-8">
        <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="text-sm text-[var(--muted)]">
            Back it up by copying one file, or export everything as JSON from
            Settings.
          </p>
          <a
            href={`${REPO_URL}/blob/master/docs/DATABASE.md`}
            target="_blank"
            rel="noreferrer"
            className="btn py-2 text-sm"
          >
            Database docs <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </Reveal>
    </section>
  );
}

/* -------------------------------------------------------------- final CTA */

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <Reveal>
        <div className="panel panel-accent relative overflow-hidden px-6 py-16 text-center sm:px-12">
          <img
            src={asset("icon.png?v=3")}
            alt=""
            className="mx-auto mb-7 h-24 w-24 sm:h-28 sm:w-28"
          />
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Stop rebuilding your system.
            <br />
            <span className="text-[var(--accent)]">Let an agent run it.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[var(--muted)]">
            Clone it, run one command, and point your agent at the skill file.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCta className="px-6 py-3 text-base" />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="btn px-6 py-3 text-base"
            >
              <Github className="h-4 w-4" /> Source
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8">
        <div className="flex items-center gap-2.5">
          <img src={asset("icon.png?v=3")} alt="" className="h-7 w-7" />
          <span className="font-mono text-xs text-[var(--faint)]">
            LIFE OS · an ADHD life manager your agent runs
          </span>
        </div>
        <div className="flex flex-wrap gap-5 font-mono text-xs text-[var(--faint)]">
          <a
            href={`${REPO_URL}/blob/master/docs/skills/life-os/SKILL.md`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--muted)]"
          >
            agent skill
          </a>
          <a
            href={`${REPO_URL}/blob/master/docs/API.md`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--muted)]"
          >
            api
          </a>
          <a
            href={`${REPO_URL}/blob/master/docs/DATABASE.md`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--muted)]"
          >
            database
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-[var(--muted)]">
            github
          </a>
        </div>
      </div>
    </footer>
  );
}
