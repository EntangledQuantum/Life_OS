# Screenshots

These are the images used in the root `README.md`. They are checked in so the
README renders on GitHub without anyone having to run the app.

## Regenerating them

```bash
pnpm dev            # in one terminal
pnpm screenshots    # in another
```

The capture script is [`scripts/screenshots.mjs`](../../scripts/screenshots.mjs).
It renders the real app in headless Chromium at 1440px, with reduced motion so
the aurora and scroll-reveal transitions are frozen and the shots come out the
same every time.

Playwright is **not** a project dependency — it is a fairly large download and
nobody needs it just to run Life OS. Install it only when you want to recapture:

```bash
npm i -D playwright
npx playwright install chromium
```

If your dev server is on a different port:

```bash
WEB_URL=http://localhost:5174 pnpm screenshots
```

## What each one shows

| File | Section | Used in the root README |
|------|---------|:--:|
| `dashboard.png` | Overview — the day as cards with their art, and the agent's two beneath | ✅ |
| `goals.png` | Goals, each with its rarity ladder, and the counters the conditions read | ✅ |
| `mobile-1.png` | Android — today's one list, with the day drawn above it | ✅ |
| `mobile-2.png` | Android — the timeline, today vs yesterday, seven days of XP | ✅ |
| `layers.png` | "Two layers, one job each" | ✅ |
| `growth-meter.png` | The growth meter, with the 100% state ghosted behind | ✅ |
| `agents.png` | The agent integration diagram | ✅ |
| `landing.png` | Landing page hero | — |

Mobile shots are captured on-device (not via Playwright). Drop new ones into this
folder as `mobile-*.jpeg` / `mobile-*.png` when the UI changes.

A note on the dashboard shot: it renders whatever is in **your** local database
at the time, so the numbers will not match the ones committed here. If you want
a presentable shot, complete a few habits and log a study session first.
