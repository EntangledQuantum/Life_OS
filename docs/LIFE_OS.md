# LIFE OS — Complete Specification & Implementation Guide

**Version:** 1.3  
**Date:** 2026-08-02  
**Status:** Ready for implementation by any agent  
**Owner:** Sunny (Entropy Lapse)  
**Primary companion system:** Hermes Agent + Obsidian Learning Vault  
**Key updates:**  
- 1.1 → Full ADHD-optimized gamification (streaks, XP, levels, achievements) enabled by default, fully toggleable.  
- 1.2 → Personal day-over-day comparison (vs yesterday only) + continuous “am I improving?” signals. All XP/points/achievement rules are fully editable by Hermes or any agent via API.  
- 1.3 → Deep context section for implementing agents (who the user is, why Hermes exists, purpose of Life OS, open-source intent).

This document is the single source of truth. Any agent implementing or extending Life OS must read and follow it. It is deliberately detailed so that implementation can begin without further clarification on vision, scope, data model, or agent integration points.

---

## 0. Context for Implementing Agents (Read This First)

This section exists so that any coding agent (or human) can understand **why** this system is being built, who it is for right now, and how it fits into an already-running personal AI setup. The detailed `AGENTS.md` of the Learning Vault will **not** be provided to the coding agent, so the essential context is captured here.

### Who this is primarily for right now

The primary user is a 20-year-old male with ADHD (all classic signs present). He is a night owl with irregular sleep patterns. He is currently working in someone else’s startup while trying to find and build his own path. He is actively searching for meaning and wants to contribute to something larger than himself — civilization-scale impact, understanding the universe, climbing Kardashev levels, posthuman possibilities. He is heavily influenced by *Dune*, *Project Hail Mary*, simulation hypothesis thinking, and first-principles learning.

He strongly prefers active, generative learning (Feynman technique, elaborative interrogation, retrieval practice, spaced repetition) over passive consumption or pure AI summarization. He is wary of cognitive offloading. He wants systems that help him *think better* and *execute more consistently*, not systems that think for him.

He experiences motivation dips and procrastination, especially under intensity. He responds well to clear structure, immediate feedback, visible progress, and a sense that the system is on his side rather than judging him.

### Existing setup the coding agent must respect

He already runs a **Hermes agent** (personal AI agent with cron jobs, skills, memory, and self-improvement loops) tightly integrated with an **Obsidian Learning Vault**. 

The vault is a sophisticated, agent-maintained personal wiki:
- `wiki/concepts/` — one page per durable idea, with frontmatter for mastery, spaced repetition (`ease`, `review_due`, `gaps`), and active learning prompts (Feynman, edge-case, contrast, etc.).
- `wiki/books/` — long-form reading with strict separation between global concepts and book-local topics.
- `wiki/maps/` — domain hub pages.
- `state/` — live dashboard (goals, current reading, focus, daily logs, dated review queues).
- `raw/` — immutable source material.
- Hermes does the bookkeeping: summarizing, cross-linking, updating review schedules, writing daily state, etc.

**Current pain this app solves:**
Hermes currently tries to handle life tracking (wake/sleep, habits, study logging, daily review) through chat reminders and by writing dated text files into Obsidian. This creates:
- Noisy, unorganized daily notes for mundane completions.
- Friction and token cost for routine reminders.
- Lack of visual dashboard, streaks, points, or clean analytics.
- Difficulty seeing personal improvement day-over-day.

Life OS is the missing **execution and measurement layer**. It takes over the structured, repetitive tracking so Hermes can stay focused on higher-order work: reflection, meaning, special memories, dynamic adjustment of the system, and deep learning support.

### Relationship between the three layers

| Layer | System | What it owns |
|-------|--------|--------------|
| Permanent Brain | Obsidian Learning Vault (maintained by Hermes) | Durable knowledge, concepts, books, maps, spaced repetition of ideas, special memories, meaning |
| Execution OS | **Life OS** (this application) | Habits, schedule fidelity, study *sessions*, streaks, XP, personal progress vs yesterday, low-friction logging, dashboard |
| Intelligence | Hermes (or any MCP-compatible agent) | Decides what is “special”, writes only exceptions into the vault, adjusts Life OS rules and quests, generates next-day learning prompts, runs end-of-day review |

**Hard rule the coding agent must never violate:**  
Mundane completions, times, streaks, and volume live only in Life OS (local SQLite).  
Only exceptional moments (inspiration, emotional charge, real insight, major goal inflection) are escalated by Hermes into Obsidian. The app itself never writes to the vault.

### Purpose of building Life OS

1. Give the user a clean, ADHD-friendly, gamified (but non-shaming) daily operating system.
2. Stop polluting the knowledge vault with ordinary daily noise.
3. Make personal improvement visible (“Am I better than yesterday?”).
4. Give Hermes a structured API/MCP surface so it can read reality and adjust the system intelligently instead of relying on unstructured chat.
5. Create something that can eventually be open-sourced so other people can self-host their own version and adapt the personal context section to themselves.

### Open source intent

Life OS will be open source. Anyone should be able to self-host it. The personal context in this section is specific to the original user; other people are expected to replace or adapt Section 0 and the seed habits/goals to their own life. The architecture, data model, agent integration patterns, and ADHD-friendly design principles are meant to be generally useful.

For now, the running instance and the Hermes integration are built for the primary user described above.

### What the coding agent should optimize for

- Extremely low friction logging (one-tap is sacred).
- Instant, positive, non-shaming feedback (points, forgiving streaks, celebrations).
- Clear personal progress visibility (especially vs yesterday).
- Clean separation of concerns with the existing Hermes + Obsidian system.
- Full agent controllability of rules, XP, achievements, and quests.
- Local-first, private, self-hostable design.

You now have enough context to implement without the full Learning Vault documentation.

---

## 1. Purpose & Positioning

Life OS is the **execution and measurement layer** of a personal operating system.

| Layer | System | Responsibility |
|-------|--------|----------------|
| Permanent Brain | Obsidian Learning Vault (`wiki/`, `state/`, concepts, maps, books, SR) | Deep knowledge, durable concepts, spaced repetition of ideas, special memories, meaning |
| Execution OS | **Life OS** (this app) | What actually happened today, habit consistency, schedule fidelity, study volume & quality, goal trajectory, low-friction logging |
| Intelligence | Hermes (or any MCP-compatible agent) | Reflection, exception handling, dynamic adjustment of habits/schedules, deciding what is “special”, writing to Obsidian, generating next-day learning prompts |

**Critical rule:**  
Mundane completions, times, streaks, and volume live **only** in Life OS (SQLite).  
Only exceptional moments (inspiration, emotional charge, insight, major goal inflection, “this changed me”) are escalated by Hermes into Obsidian (`state/days/YYYY-MM-DD.md` or `log.md`).

This eliminates the current noise of daily dated text files for ordinary activity while preserving the vault’s role as the compounding knowledge base.

---

## 2. Research Foundations (Do Not Ignore)

### 2.1 Habit Science (must be implemented)

- **BJ Fogg – Tiny Habits (B = MAP)**: Behavior = Motivation × Ability × Prompt. Start *impossibly small*. Anchor to an existing behavior. Celebrate immediately (creates positive emotion → automaticity).
- **James Clear – Atomic Habits**: Make it Obvious, Attractive, Easy, Satisfying. Habit stacking. Tracking itself is a powerful habit.
- **ADHD-specific realities (2026 research & product evidence)**:
  - Harsh “broken streak” mechanics cause abandonment and shame spirals.
  - Prefer *forgiving* or *gentle reappearance* models (habit simply reappears tomorrow; streaks are informative, not moral).
  - Low cognitive load UI is non-negotiable.
  - **Instant visual + dopamine feedback is critical** — this is why controlled gamification works extremely well for ADHD brains when designed correctly.
  - Goal-linked habits outperform isolated ones.
  - Time-of-day and energy-aware prompts outperform fixed clock times for night-owl / irregular schedules.
  - Micro-wins and visible progress compounds motivation far better than pure willpower.

**Design consequences for Life OS:**
- Default to tiny / stackable habits.
- **Gamification is enabled by default** (streaks, points, levels, achievements) because it provides the dopamine scaffolding ADHD brains often need. It can be completely turned off in Settings.
- Streaks are **forgiving and informative**, never shaming. Missing a day does not destroy the visual chain or remove points already earned.
- Every habit has a strong emoji/icon identity.
- One-tap complete is sacred.
- Immediate celebration micro-feedback on every complete (visual pop, optional sound/haptic, points awarded instantly).
- Points and levels exist to create a sense of progression and “aura”, not to create anxiety.

### 2.2 Evidence-Based Learning Techniques (must be supported)

The Learning Vault already implements a sophisticated spaced-repetition + active-learning system for *concepts* (ease, gaps, prompt rotation: Feynman / elaborative / edge-case / contrast / connect / generation / interleaving, dated review queues in `state/reviews/`).

Life OS does **not** replace that system. It complements it by tracking the *sessions and volume* that feed the vault, and by providing a lightweight daily review surface that Hermes can populate.

Core techniques Life OS must enable or surface:

| Technique | How Life OS supports it |
|-----------|-------------------------|
| **Spaced Repetition** | Study sessions can be linked to concepts. Hermes can mark a concept as reviewed when a strong session is logged. Life OS can surface “due light reviews” that Hermes injects. |
| **Active Recall / Retrieval** | One-tap “I did a retrieval session” + quality flag. Hermes can push specific recall prompts into the next day’s Life OS queue. |
| **Elaborative Interrogation & Feynman** | Quality flags + optional note. Special “inspired” or “I explained this from scratch” flags escalate to Obsidian. |
| **Interleaving** | Dashboard and end-of-day review can show mixed domains. |
| **Generation Effect** | User can log predictions / self-generated summaries before checking sources. |
| **Desirable Difficulty** | Hermes can schedule slightly harder prompts when consistency is high. |

**Key innovation:** Hermes runs an end-of-day cron that:
1. Reads today’s Life OS data.
2. Decides which study sessions were ordinary vs special.
3. Updates or creates light review items *inside Life OS* for tomorrow.
4. Escalates only the special ones into the vault’s review system or daily log.

### 2.3 Existing Habit Trackers – What Works in 2026

Strong patterns observed:
- Visual identity (emoji, icons, color) is extremely important.
- Heatmaps / calendar dots + streak numbers.
- Goal linking (habits serve larger goals).
- Analytics that answer “am I becoming more consistent?” rather than vanity metrics.
- AI-assisted recommendations (Pattrn, Habitify) – but in our case the AI lives *outside* the app (Hermes).
- ADHD-friendly: no guilt spirals, gentle prompts, micro-wins.

Life OS must be better than these for *this specific user* by being:
- Fully agent-controllable.
- Deeply integrated with a real knowledge vault and personal meaning system.
- Extremely low friction for irregular sleep and high-intensity periods.
- Local-first and private.
- **ADHD-optimized gamification** that is powerful when wanted and invisible when not.

### 2.4 ADHD-Optimized Gamification Layer (Enabled by Default)

Gamification is a first-class feature, not an afterthought. It is **turned on by default** because it supplies the external structure and dopamine feedback many ADHD brains need to maintain consistency. Every element can be disabled individually or the entire layer can be switched off in Settings.

**Core gamification systems (all default ON):**

| System | Description | ADHD Design Rules |
|--------|-------------|-------------------|
| **Streaks** | Current + longest streak per habit and overall | Forgiving. Missing a day pauses the streak counter but does not erase history or punish. Visual treatment stays calm. “Streak recovery” celebration when you restart. |
| **Points (XP)** | Points awarded on every completion | Instant award on one-tap. Bonus multipliers for quality flags (`inspired`, `feynman`, `retrieval`), tiny habits completed, or completing a full planned block. Points never decrease. |
| **Levels** | Global level derived from total lifetime XP | Slow, satisfying progression. Level-up produces a strong but non-overwhelming celebration. Level is visible on dashboard. |
| **Achievements / Badges** | Unlockable milestones | Examples: “7-day wake consistency”, “First inspired study session”, “10 deep work blocks”, “Night owl who still studied”, “Tiny Habit Master”. Achievements are permanent once unlocked. |
| **Daily / Weekly Quests** | Optional light challenges | Hermes or the user can inject simple quests (“Complete 3 study sessions this week”, “Protect sleep 5 nights”). Completing them gives bonus XP. |
| **Visual Aura / Progress Ring** | Dashboard identity element | A subtle evolving visual (ring, aura, or emblem) that reflects overall consistency and level. Purely aesthetic dopamine. |

**Important constraints:**
- No negative points, no “lives”, no punishment mechanics.
- **No social comparison of any kind.** The only comparison that exists is **you vs your own yesterday** (and longer personal history).
- Streaks and points are private and local.
- The user (or Hermes via API) can mute any individual system or turn the entire gamification layer off. When off, the app becomes a clean, non-gamified tracker.
- Celebration animations must be fast and optional (can be reduced to minimal feedback).

**Agent-controllable rules (critical):**  
All XP values, multipliers, level curve, achievement definitions, quest templates, and bonus rules are **not hard-coded forever**. Hermes (or any other agent) can change them at any time through the API. Examples of what an agent can do:
- Raise or lower base XP for a habit.
- Add a temporary “deep work multiplier” for a week.
- Create a new achievement on the fly.
- Adjust the level curve if progression feels too fast or too slow.
- Inject or remove quests.
This keeps the system alive and personalized instead of frozen.

This layer is inspired by the best ADHD-friendly trackers (Habitica-style dopamine + forgiving modern designs) but stays grounded in Tiny Habits celebration + real progress toward meaning rather than pure RPG escapism.

### 2.5 Personal Progress & Day-over-Day Comparison (You vs Yesterday)

One of the most powerful ADHD-friendly signals is simple, non-judgmental visibility of **personal improvement**.

**Core rule:** The only comparison that exists in Life OS is **you against your own past self** — primarily yesterday, then rolling windows (7/30/90 days). There is never any comparison to other people.

**Required signals (visible on Dashboard and in Analytics):**

| Signal | What it shows | Design note |
|--------|---------------|-------------|
| **Today vs Yesterday** | Side-by-side or delta view of completions, XP earned, study minutes, sleep regularity, planned blocks hit | Calm language: “+2 habits vs yesterday”, “Study volume ↑”, “Sleep more consistent”. Never “you failed yesterday”. |
| **Improvement Pulse** | Simple indicator: “Improving”, “Stable”, “Recovering”, “Drifting” based on recent trend | Based on rolling consistency + XP trajectory + streak recoveries. Hermes can refine the logic. |
| **Daily XP Delta** | XP earned today compared to XP earned yesterday | Instant feedback on whether today was a higher-output day. |
| **Consistency Trend** | Sparkline or small chart of last 7–14 days consistency % | Shows direction, not just absolute number. |
| **Streak Recovery Count** | How many times you successfully restarted a streak recently | Celebrates resilience instead of only perfect chains. |
| **Quality Trend** | % of study sessions marked inspired / retrieval / feynman over time | Shows whether depth is increasing, not just volume. |

These signals exist to answer the real question an ADHD brain often asks:  
**“Am I actually getting better, or am I just spinning?”**

Hermes can use the same data in the end-of-day cron to generate a short, honest personal note (“You protected sleep better than yesterday and earned more deep-work XP”) that can optionally be written as a special memory if it carries emotional weight.

---

## 3. Core User & Context (for personalization)

See **Section 0** for the full picture. Short reminder for implementers:

- Primary user has ADHD and an irregular night-owl schedule.
- He is building toward long-term meaning and high-impact work while currently in a transitional phase.
- He already runs a sophisticated Hermes + Obsidian Learning Vault system; Life OS must complement it, never fight it.
- The system must feel like a serious, slightly playful ally on the path to meaning — not another productivity toy that creates guilt.

When this project is open-sourced, other users should replace or adapt Section 0 and this short reminder with their own context.

---

## 4. Product Principles (Non-Negotiable)

1. **Local-first** — SQLite is the source of truth. Offline capable.
2. **Agent-complementary** — Hermes never does routine bookkeeping. It only reasons about exceptions and adjustments.
3. **Mundane vs Special** — Completions stay in DB. Only exceptional signal → Obsidian via Hermes.
4. **One-tap sacred** — Logging must be faster than opening a chat.
5. **Emoji / icon first** — Visual identity for every habit and category.
6. **ADHD-optimized gamification enabled by default** — Streaks, points (XP), levels, achievements, and light quests. All forgiving. Fully toggleable (individual systems or entire layer).
7. **Forgiving streaks** — Informative and celebratory, never shaming. Missing a day pauses; it does not punish.
8. **You vs Yesterday only** — The sole comparison is personal day-over-day (and personal history). No social comparison ever.
9. **Visible daily improvement** — Dashboard and analytics must answer “Am I improving?” with clear, calm signals.
10. **All gamification rules are agent-editable** — XP values, multipliers, level curve, achievements, and quests can be changed by Hermes or any agent at any time via API.
11. **Night-owl aware** — Quiet hours, flexible time windows, energy-aware suggestions.
12. **Realistic analytics only** — Consistency, regularity, trajectory toward goals. Gamification numbers are secondary to truth.
13. **Flutter single codebase** — Web → Android → iOS.
14. **Fully controllable by agents** via API (then MCP).

---

## 5. Feature Specification

### 5.1 Habits

**Definition fields:**
- `id`, `name`, `emoji` (or icon), `category` (Life | Health | Study | Deep Work | Startup | Custom)
- `frequency_rule` (daily, specific weekdays, every N days, custom cron-like)
- `preferred_time_window` (start–end, or “any”, or “after wake”, “before sleep”)
- `anchor` (optional text: “after I brush teeth”, “when I sit at desk”) — supports Tiny Habits stacking
- `linked_goal_id` (optional)
- `is_tiny` (boolean – for micro-habits)
- `base_xp` (points awarded on normal completion; default sensible value)
- `active`, `created_at`, `updated_at`, `notes`
- `notification_rules` (per-habit quiet hours override, message template)

**Logging:**
- One-tap complete → creates `habit_log` with timestamp, optional short note, `source` (“user” | “agent”).
- Instant XP award + visual celebration (configurable intensity).
- Optional quality / mood / energy slider (later).
- Undo within short window (XP is also reversed on undo).

**Streak logic (forgiving by design):**
- Current streak and longest streak are tracked and displayed.
- Missing a day **pauses** the current streak counter. It does **not** reset history, remove points, or apply any penalty.
- When the user completes the habit again, a “Streak Recovered” micro-celebration can fire and the counter continues from the new run.
- Visual treatment stays calm and informative. No red shame states, no exploding chains.
- Overall “consistency aura” still grows from total completions even if individual streaks break.

**Points & Level integration:**
- Every completion awards `base_xp` immediately.
- Bonus XP multipliers for: quality flags on study sessions, completing a full planned block, tiny habits, or quest completion.
- Total lifetime XP determines global Level.
- Level-ups are celebrated but never interrupt logging flow.

### 5.2 Life Schedule & Rhythms

- **Anchors:** planned_wake, planned_sleep_window, actual_wake, actual_sleep, sleep_quality (1–5 or emoji).
- **Daily blocks / templates:** Study, Deep Work, Startup, Exercise, Free, Admin, etc. Each block has planned start/end + actual logged times.
- Ability to mark a day as “irregular / recovery / high-intensity”.
- Night-owl defaults: late quiet hours, flexible morning start.

### 5.3 Study Tracking (Critical – detailed)

This is the bridge to the Learning Vault.

**Study Session fields:**
- `id`, `title` or free text
- `linked_book_slug` or `linked_concept_slug` (optional – matches vault naming)
- `duration_minutes` **or** `pages` (or both)
- `quality_flag`: `normal` | `struggle` | `inspired` | `feynman` | `retrieval`
- `note` (short)
- `generated_summary_or_prediction` (optional – for generation effect)
- `created_at`, `source`

**Special handling of quality flags:**
- `inspired`, `feynman`, or any note containing strong emotional language → Hermes treats as candidate for Obsidian escalation.
- `retrieval` or strong sessions can be used by Hermes to advance the vault’s concept `ease` / `last_reviewed` if the concept is linked.

**Light Review Queue inside Life OS:**
- Hermes (or the user) can inject “tomorrow’s light reviews” — short active-recall or Feynman prompts that appear on the dashboard.
- These are *not* the full vault SR system. They are daily execution prompts that keep the learning flywheel spinning.
- Completing them creates a study session log automatically.

### 5.4 Goals (MVP light version → full hierarchy later)

**MVP:**
- Flat or simple parent–child goals.
- Fields: title, description, status (active/paused/achieved/abandoned), target_date, why_it_matters (meaning link), linked habits.
- Progress is calculated from linked habit consistency + manual check-ins.

**Later (Phase 2):** Full hierarchy (Dream → Long-term Goals → Projects → Habits) with trajectory analysis (“you are drifting”).

### 5.5 Dashboard (Home)

Must answer in < 5 seconds:
- What is the state of today? (completed / remaining / overdue)
- **Today vs Yesterday** delta (habits completed, XP earned, study volume, sleep) — the primary personal comparison
- Current important streaks + total XP / Level (if gamification enabled)
- **Improvement Pulse** (“Improving” / “Stable” / “Recovering” / “Drifting”)
- Sleep regularity pulse
- Active goals progress
- Any light reviews / focus items / active quests Hermes injected
- One-tap log buttons for top habits
- Subtle progress ring / aura visual that reflects overall consistency and level

Secondary views: 30/90-day heatmap, consistency by category, time-of-day patterns, study volume + inspired rate, achievement gallery, streak recovery history, personal trend sparklines.

### 5.6 Notifications

- Fully customisable per habit.
- Respect global quiet hours (night-owl default).
- Browser push on web; native on mobile later.
- Templates support emoji and simple variables (`{habit}`, `{streak}`).
- Hermes can adjust notification rules via API based on observed patterns (e.g., if user consistently completes study after 23:00, shift the prompt).

### 5.7 Analytics (Realistic Only)

Required:
- **Today vs Yesterday** comparison (primary personal benchmark)
- Consistency % (rolling 7/30/90) per habit and per category + trend direction
- Streak health (current, longest, breaks + recoveries) — shown calmly
- Total XP, current Level, XP to next level, **daily XP delta vs yesterday** (when gamification is on)
- Achievement unlock timeline
- Sleep midpoint variance and regularity score + day-over-day change
- Study volume (minutes/pages) + % of sessions marked inspired/retrieval + quality trend
- Goal progress trend
- Time-of-day completion heatmap
- “What went wrong” simple view (missed planned blocks + user notes)
- **Improvement Pulse** history (how often the system judged the user as Improving / Recovering etc.)

Gamification numbers exist to provide dopamine and a sense of progression. They never override the truth of consistency data. When the gamification layer is turned off, these numbers simply disappear from the UI.

**Strict rule:** No social comparison, no public leaderboards, no comparison to any other person. The only comparison is the user against their own yesterday and their own history. No negative points or any mechanic that creates shame or anxiety.

---

## 6. Data Model (SQLite via Drift recommended)

Core entities (high level – implement with proper migrations):

```text
habits
habit_logs               # includes xp_awarded
sleep_logs
schedule_blocks          # planned + actual
study_sessions
goals
goal_habit_links
light_reviews            # injected by Hermes for next day
achievements             # unlocked badges
user_progress            # total_xp, current_level, settings flags
quests                   # optional daily/weekly challenges
settings                 # includes gamification toggles
special_event_candidates # optional lightweight table Hermes can read
```

**Gamification & progress-related fields (examples):**
- `user_progress`: total_xp, current_level, xp_to_next, gamification_enabled (bool), streaks_enabled, points_enabled, achievements_enabled, quests_enabled, last_improvement_pulse
- `habit_logs`: xp_awarded (int)
- `daily_snapshots`: date, total_xp_earned, habits_completed_count, study_minutes, sleep_score, consistency_pct  ← used for Today vs Yesterday and trends
- `achievements`: id, key, title, description, emoji, unlocked_at, xp_bonus
- `xp_rules` / `gamification_config`: store of current multipliers, base values, level curve — **fully editable by agents**

All timestamps UTC; display in local. Soft deletes preferred over hard deletes for habits.

Export: full SQLite file + JSON dump of key tables at any time.

---

## 7. Agent Integration (Hermes & Future Agents)

This is a first-class requirement, not an afterthought.

### 7.1 Local API (Phase 1)

Simple, well-documented HTTP API (or Unix domain socket / file protocol if preferred for pure local) running on the same machine.

Minimum capabilities Hermes must have:
- CRUD habits, goals, schedule templates
- Log a completion (with note and source=agent)
- Query today’s status, week consistency, sleep regularity, study sessions (especially quality_flag = inspired)
- Query **Today vs Yesterday** deltas and Improvement Pulse
- Inject or clear light_reviews / quests for a given date
- Read settings and update notification rules
- Create a tiny habit from natural language description (Hermes parses → structured create)
- **Full control over gamification rules**: change base XP, multipliers, level curve, create/edit/delete achievements, adjust quest templates. These rules are live data, not frozen constants.

### 7.2 End-of-Day Hermes Cron (Required Pattern)

Every day (suggested ~23:30–01:00 local, adjustable):

1. Pull today’s full state from Life OS API (habits, sleep, blocks, study sessions, XP earned).
2. Compute and store the daily snapshot (used for Tomorrow’s “vs Yesterday” view).
3. Compare planned vs actual schedule. Note major deviations.
4. Calculate Improvement Pulse and Today vs Yesterday deltas.
5. Scan study sessions and notes for special signals (`inspired`, strong emotional language, Feynman, major insight).
6. For special items → write structured entry into Obsidian (`state/days/YYYY-MM-DD.md` or append to `log.md`) using the existing vault conventions.
7. Optionally advance vault concept review state if a linked concept received a strong retrieval/Feynman session.
8. Generate or adjust tomorrow’s light_reviews and quests inside Life OS.
9. Optionally adjust notification timing, habit definitions, **or XP/achievement rules** based on observed patterns.
10. Produce a short, honest personal summary focused on improvement vs yesterday that Hermes can use for morning briefing if desired.

This cron is the key innovation that keeps the two systems in sync without polluting the vault with mundane data.

### 7.3 Future: MCP Server

Once the local API is stable, expose the same capabilities as an MCP server so any MCP-compatible agent can discover and use the tools.

---

## 8. Technical Stack Recommendations

- **UI / Cross-platform:** Flutter (web first, then Android, then iOS). Still the strongest single-codebase option in 2026 for consistent UI + performance.
- **Local database:** Drift (type-safe, excellent migrations, reactive).
- **State management:** Riverpod (or current Flutter consensus).
- **Notifications:** `flutter_local_notifications` + web push where available.
- **Local API:** Lightweight Dart shelf/http server or equivalent that can be started with the app or as a background service.
- **Icons / Emoji:** High-quality emoji picker + support for custom icons later.
- **Theming:** Dark-first, system theme support, high contrast options.

Architecture must remain local-first. Cloud sync is explicitly out of scope for v1.

---

## 9. Phased Roadmap

### Phase 1 — Web MVP (Immediate Target)
- Habits with emoji, categories, frequency, one-tap log, **forgiving streaks + points/XP + levels + achievements** (gamification ON by default, fully toggleable)
- Sleep + basic schedule blocks
- Study sessions with quality flags and optional vault linking
- Dashboard with progress ring / aura, current XP/Level, streaks, **Today vs Yesterday deltas**, and Improvement Pulse
- Local SQLite + export (includes daily_snapshots for personal comparison)
- Simple local API for Hermes (including full control over XP rules, achievements, quests, and ability to read personal progress deltas)
- Browser notifications
- Light review + quest injection surface
- Settings panel to enable/disable the entire gamification layer or individual systems (streaks, points, achievements, quests)

### Phase 2 — Depth & Mobile
- Full goal hierarchy + trajectory signals
- Android build + native notifications + widgets
- Richer end-of-day automation patterns
- MCP server
- Better study ↔ vault bidirectional linking
- “What went wrong” reflection flow that can escalate

### Phase 3 — Polish
- iOS
- Advanced notification intelligence
- Habit experiments (user or Hermes can run tiny A/B tests)
- Optional light encrypted sync if ever desired

---

## 10. Success Criteria (MVP)

- User can maintain 10–20 real habits (including wake, sleep, water, study, deep work, startup) with almost zero chat friction.
- **Gamification layer is active by default** and provides clear, immediate dopamine (points, streak visibility, level progress, achievements) without creating shame when days are missed.
- User can turn the entire gamification layer (or individual parts) off in Settings and the app remains fully usable as a clean tracker.
- Dashboard answers both “What did I do today?” and **“How does today compare to yesterday?”** plus a calm Improvement Pulse in under 5 seconds.
- Hermes (or any agent) can freely change XP rules, multipliers, achievements, and quests via API; the system stays alive and personalized.
- Hermes end-of-day cron successfully distinguishes mundane vs special and only writes the latter to Obsidian.
- Study sessions with `inspired` / `feynman` flags reliably surface for vault escalation.
- No daily dated text files are created for ordinary completions.
- The system feels like a serious, slightly playful ally for an irregular, high-intensity, ADHD, meaning-seeking life that actually shows whether the user is improving.

---

## 11. Implementation Notes for Agents

- Prefer Drift over raw sqflite for safety.
- Make the API documentation part of the repo (OpenAPI or simple Markdown).
- Every habit creation path (UI or API) should encourage a tiny version + anchor text.
- Logging path must be the fastest thing in the app — XP and celebration happen *after* the log is recorded, never blocking it.
- Gamification must be designed as a layer that can be completely disabled without breaking core tracking logic.
- When in doubt about whether something is “special”, leave the decision to Hermes — do not auto-write to Obsidian from the app.
- Preserve the user’s night-owl reality in all defaults and quiet hours.
- The Learning Vault’s `AGENTS.md` remains authoritative for knowledge structures. Life OS only feeds it.
- Default seed should include a few tiny habits so the user immediately experiences points + streak feedback.

---

## 12. Open Questions (Resolve During Implementation)

1. Exact protocol for the local API (HTTP port, auth if any, or pure local socket).
2. How aggressively Hermes should auto-advance vault concept `ease` from Life OS study sessions.
3. Whether light_reviews should themselves become full study_sessions on completion.
4. Visual language for “forgiving streak” and the progress aura / ring (keep it calm and aesthetic, never childish).
5. Minimum set of default habits to seed for this user (wake, sleep, water, deep work, study, movement, etc.).
6. Exact XP values and level curve (should feel rewarding but not inflate too fast).
7. Which achievements to ship in MVP (keep the list small and meaningful).

---

**End of Specification**

This document is intentionally complete. An implementing agent should be able to produce a working Phase 1 web app and the corresponding Hermes skill/cron patterns from this file alone.

**Version history of key additions:**
- **1.1** — Full ADHD-optimized gamification (streaks, points/XP, levels, achievements, light quests). Default ON, fully toggleable, no shame mechanics.
- **1.2** — Personal “Today vs Yesterday” comparison + continuous Improvement Pulse. All XP, points, achievement, and quest rules are live data that Hermes or any agent can change at any time via API. No social comparison of any kind.
- **1.3** — Deep context section (Section 0) for implementing agents: who the primary user is, why the Hermes + Obsidian setup exists, the exact pain Life OS solves, the three-layer architecture, and open-source intent. Coding agents no longer need the full Learning Vault `AGENTS.md`.

When in doubt, optimise for low friction, instant positive feedback, honest personal progress visibility, truthfulness of data, and clean separation between the execution layer (Life OS) and the permanent brain (Obsidian Learning Vault).
