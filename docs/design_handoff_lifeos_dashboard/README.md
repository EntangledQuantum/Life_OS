# Handoff: Life OS Dashboard

## Overview
Single-page web dashboard for Life OS — the execution/tracking layer described in `LIFE_OS.md`. Dark, minimal, "techno" aesthetic. Tabbed single page: Overview, Habits, Study, Goals, Analytics. Built with functional (non-decorative) widgets: one-tap habit logging, live "Right Now" activity timer, color-coded 24h timeline, animated consistency visuals, XP/level system, 4 selectable accent themes.

## About the Design Files
The bundled file (`LifeOS.dc.html`) is a **design reference** — a working HTML/JS prototype showing intended look, layout, and interaction, not production code to paste into a codebase. Recreate it in the target app's actual stack (React, Vue, SwiftUI, Flutter per the original spec, etc.) using that stack's normal patterns, or pick the best-fit framework if none exists yet. `LifeOS.dc.html` is self-contained and runnable directly in a browser if you want to click through the live behavior first.

**This design is explicitly a starting point, not a locked spec.** Any implementing agent or developer — human or AI — should feel free to change layout, copy, data shapes, widget choices, animations, or the whole visual system if something better serves the product. Nothing here is precious. Treat colors, spacing, and copy as defaults to adjust as real usage and real data reveal better answers.

## Fidelity
High-fidelity for visual language (color system, type, spacing, motion) — low-fidelity for data: all numbers, sessions, goals, and achievements are mock/demo data standing in for real SQLite-backed content per the spec's data model (Section 6).

## Screens / Views (tabs on one page)

### Overview
- **Today vs Yesterday** hero card: 4-stat delta row (habits completed, XP earned, study minutes, sleep regularity), gradient-filled numbers.
- **Right Now**: activity picker (Deep Work / Study / Sleep / Exercise / Break / Life Admin) + live running timer (updates every second) color-coded to the active category.
- **Today's Timeline**: horizontal 24h bar, segments color-coded by category (Sleep/Life/Deep Work/Study/Health/Break), small ticks marking when habits were logged, vertical "now" marker, hour axis labels, legend.
- **Improvement Pulse**: single-word status (Improving/Stable/Recovering/Drifting) + one-line explanation.
- **Level Progress**: circular XP ring (SVG stroke-dashoffset, animated).
- **Consistency Growth**: abstract animated "growing" stem+leaves visual keyed to level — leaves animate in staggered on mount.
- **Quick Log**: one-tap complete buttons for top habits.
- **7-Day Consistency**: smooth SVG line/area chart (not bars) of daily consistency %.

### Habits
2-column grid of habit cards. Each card: category-colored icon monogram, name, category + streak + XP, one-tap toggle button, 7-day history dot chain (Hydration habit instead gets an animated liquid-fill "glass" bar).

### Study Sessions
List of session cards (title, timestamp, duration, quality-flag chip: normal/struggle/inspired/feynman/retrieval) + "Log Session" button that prepends a new mock entry.

### Goals
3-card grid: title, why-it-matters text, progress bar, % + target date.

### Analytics
Consistency-by-category bars, weekly XP bar chart, achievement gallery (unlocked vs. locked cards).

## Interactions & Behavior
- **Theme switching**: 4 swatches in the header (Nebula/Quantum/Terminal/Ember) — each is the same neutral dark palette with a different accent hue (oklch, same L/C, hue rotated). Switching instantly re-themes every accent-dependent style across all tabs.
- **Habit toggle**: click flips completed state, animates icon (`pop` keyframe), adjusts streak (+1 on complete, -1 floored at 0 on undo) and lifetime XP total, which live-updates the level ring and header level chip.
- **Right Now timer**: `setInterval` tick every 1s while mounted; elapsed time computed from `Date.now() - activityStartedAt`; switching activity resets the timer.
- **Add session**: prepends a new "Retrieval" session card to the Study list.
- Tab switching cross-fades content (`fadeIn` keyframe).
- All buttons/cards have hover states (background lift, no color-cliché left-border accents).

## State Management
State needed in a real implementation (see `LIFE_OS.md` Section 6 for the full data model):
- `activeTab`, `themeIndex` — UI-only state.
- `habits[]` — id, name, category, streak, base_xp, completed (today), 7-day history, last-logged time.
- `xpTotal`, derived `level`/`xpToNextLevel`.
- `currentActivity` + `activityStartedAt` — for the Right Now timer; in production this should be a real "current session" concept, not client-only state.
- `studySessions[]` — title, duration, quality flag, timestamp.
- `goals[]`, `achievements[]`, category consistency %, weekly XP series, 7-day consistency series — all currently mocked; back with `daily_snapshots`/`achievements`/`goals` tables per spec.

## Design Tokens

**Type**
- Headings/UI: `Space Grotesk` (600/700)
- Numbers/data/mono labels: `JetBrains Mono` (500/600/700)

**Neutrals** (oklch, near-black cool base)
- Background: `oklch(6.5% 0.008 260)`
- Card base: `oklch(13% 0.012 260)` → `oklch(17.5% 0.013 260)` gradient
- Track/well: `oklch(21% 0.013 260)`
- Hairline border: `rgba(255,255,255,0.055)`
- Text primary/secondary/tertiary: `oklch(97% 0.005 260)` / `oklch(68% 0.012 260)` / `oklch(46% 0.012 260)`

**Accent themes** (oklch 76% / 0.17 chroma, hue varies)
- Nebula: hue 224 (blue-cyan)
- Quantum: hue 296 (violet)
- Terminal: hue 150 (green)
- Ember: hue 38 (amber)

**Category colors** — derived as hue offsets from the active theme's accent hue (stays coherent with theme switching): Life +0, Study +40, Deep Work +80, Health +150, Sleep +190, Break +230.

**Radius**: cards 22px, chips/buttons 9–14px, icon tiles 11–13px.
**Shadows**: soft elevation via `0 24px 48px -28px rgba(0,0,0,.75)` + inset highlight, plus accent-tinted glow shadows on active/lit elements — no drop shadows on plain text.

## Assets
No external image assets. All icons are single-letter monograms or CSS/SVG shapes (circles, bars, one `<svg>` line chart, one `<svg>` progress ring). Fonts loaded from Google Fonts.

## Files
- `LifeOS.dc.html` — the full design (template + logic), runnable standalone in a browser.
