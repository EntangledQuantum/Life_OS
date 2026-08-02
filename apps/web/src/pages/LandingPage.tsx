import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Bot, Flame, LineChart, Sparkles } from "lucide-react";

export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -20%, oklch(50% 0.2 224 / 0.35), transparent),
            radial-gradient(ellipse 40% 40% at 80% 60%, oklch(40% 0.15 296 / 0.2), transparent),
            var(--bg)
          `,
        }}
      />
      {/* grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 20%, transparent 75%)",
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" className="h-10 w-10" />
          <span className="text-xl font-bold tracking-tight">LIFE OS</span>
        </div>
        <Link to="/login" className="btn btn-primary">
          Enter <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <img
            src="/icon.png"
            alt="Life OS"
            className="mx-auto mb-8 h-40 w-40 drop-shadow-[0_0_48px_var(--accent-glow)] sm:h-48 sm:w-48"
          />
          <h1 className="text-4xl font-extrabold leading-[1.15] tracking-tight md:text-5xl lg:text-6xl">
            Your execution layer.
            <br />
            <span className="text-[var(--accent)]">Not another guilt app.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--muted)]">
            ADHD-friendly habits, study tracking, forgiving streaks, and{" "}
            <strong className="text-[var(--text)]">you vs yesterday</strong>{" "}
            progress — fully controllable by Hermes or any agent via API & MCP.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/login" className="btn btn-primary px-6 py-3 text-base">
              Open dashboard
            </Link>
            <a href="#features" className="btn px-6 py-3 text-base">
              See features
            </a>
          </div>
        </motion.div>

        <div
          id="features"
          className="mt-24 grid gap-4 text-left md:grid-cols-2 lg:grid-cols-4"
        >
          {[
            {
              icon: Flame,
              title: "One-tap dopamine",
              body: "Instant XP, calm streaks, celebrations you can dial down.",
            },
            {
              icon: LineChart,
              title: "You vs yesterday",
              body: "The only comparison that matters — personal improvement pulse.",
            },
            {
              icon: Bot,
              title: "Agent-native",
              body: "HTTP + MCP. Hermes can add habits, quests, themes, XP rules.",
            },
            {
              icon: Sparkles,
              title: "Local-first",
              body: "SQLite by default. Optional Supabase for remote data storage.",
            },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              className="card p-5"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
            >
              <f.icon className="mb-3 h-5 w-5 text-[var(--accent)]" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
