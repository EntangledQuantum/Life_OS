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
| `android-today.png` | Android Today — the growth meter, the activity line, the day as one list | ✅ |
| `android-day.png` | Android Day — the ribbon, the legend, and "Needs you" | ✅ |
| `android-you.png` | Android You — goals with their rungs, last 7 days, vs. yesterday | ✅ |
| `layers.png` | "Two layers, one job each" | ✅ |
| `growth-meter.png` | The growth meter, with the 100% state ghosted behind | ✅ |
| `agents.png` | The agent integration diagram | ✅ |
| `landing.png` | Landing page hero | — |

Android shots are captured on a real device, not via Playwright — the native
client is a Kotlin/Compose app and Playwright cannot drive it. Capture them with
the phone on wireless adb:

```bash
adb exec-out screencap -p > docs/screenshots/android-today.png
```

Send `adb shell input keyevent KEYCODE_WAKEUP` first: a dozing screen
photographs as a black rectangle rather than failing, so a sleeping phone
quietly produces three identical blank shots.

Point the app at a **seeded sandbox instance**, never your own, so the images
show demo data instead of somebody's real life.

A note on the dashboard shot: it renders whatever is in **your** local database
at the time, so the numbers will not match the ones committed here. If you want
a presentable shot, complete a few habits and log a study session first.
