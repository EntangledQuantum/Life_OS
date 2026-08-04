# Life OS mobile app — agent notes

**Scope:** only `mobile-frontend/app/`. Do not edit `apps/*`, `packages/*`, or
root workspace files. Isolation rules: `../README.md`. Product contracts:
`../CLIENT_GUIDE.md` (read end-to-end before behavioural changes).

## Stack

- Expo SDK 57 · Expo Router · React Native
- Entry: `index.js` (registers Android widget only on `Platform.OS === "android"`)
- Routes: `app/` · UI: `components/` · API/auth: `lib/` · Widget: `widgets/`

## Auth (token only)

- No username/password. `POST /api/v1/auth/login` is **410 Gone**.
- Connect screen: server URL + `API_TOKEN` from Life OS `.env`.
- Validate with `GET /api/v1/auth/me` before entering the app.
- Token in **SecureStore** on native (never log it). On 401 → clear token → connect.
- Implementation: `lib/api.ts`, `lib/connection.tsx`, `lib/storage.ts`, `app/connect.tsx`.

## Contracts you must not break

See CLIENT_GUIDE §4. Highlights: life-day ≠ calendar day; celebrations only after
user dismiss; reminders POST `/notified` even under DND; no levels/leaderboards;
no goal-creation UI; never colour a bad day red.

## Growth meter / animations (likely touch points)

| File | Role |
|------|------|
| `components/growth-meter.tsx` | Sprout + orb visuals; **must** draw ghosted 100% state behind live state |
| `components/growth-hero.tsx` | Centres the meter and hangs the day's four numbers in the corners |
| Leaf thresholds | `0.16 0.32 0.46 0.62 0.78 0.90` then bloom at 1.0 (match web) |
| Web reference | `apps/web/src/components/graphics/GrowthMeter.tsx` (read only — copy patterns, don't import) |
| Settings | `reducedMotion`, `celebrationIntensity`, `progress.growthStyle` |
| `components/celebration-modal.tsx` | Full-screen goal complete — never auto-dismiss |

Prefer `react-native-reanimated` + `react-native-svg` already in the project.
Honour `reducedMotion` from settings **and** the OS (`useTheme().osReducedMotion`).

Two things in the orb are load-bearing and easy to undo by accident:

- The liquid is a **full-height view slid down on `translateY`**, not a view whose
  `height` animates. Height is a layout prop and re-lays-out every frame; the
  transform stays on the UI thread, and the crests ride the surface for free
  because they are children of it.
- Each crest scrolls by **exactly its own period** (`periodA = inner/2`,
  `periodB = inner/3`). Any other distance and the tiled sine visibly jumps once
  per loop. Do not give both waves the same drift distance.

## Swiping and tabs

`components/swipe-tabs.tsx` wraps every tab screen; `index` must match the
screen's position in `TAB_ROUTES` and in `app/(tabs)/_layout.tsx`. It uses
`PanResponder`, not a pager, and only claims the gesture once it is twice as
horizontal as it is vertical — that is what leaves vertical scrolling intact.
`components/tab-bar.tsx` is the custom bar; it types the navigator props
structurally rather than importing `@react-navigation/bottom-tabs`, which this
app does not declare as a dependency.

## Widget

- `widgets/status-widget.tsx` + `task-handler.tsx` + `update.tsx`
- Uses `react-native-android-widget` primitives only (no RN `View`/`Text`)
- Manual activity chips exclude Sleep/Break (schedule/agent can set those)
- Needs a native Android build to test — not Expo Go

## Dashboard

- Single poll: `GET /api/v1/dashboard/today` (~8s on Today screen)
- After writes, invalidate/refetch — don't hand-patch state
- `source: "user"` on human actions; habit complete `409` = success no-op

## Design tokens

Dark only — there is no light theme.

Colour comes from `lib/theme.ts` (`PALETTES`) through `useTokens()` /
`useTheme()` in `lib/theme-provider.tsx`. **Never import `colors` in a new
component** — it is only a static fallback pinned to the default palette, so
anything using it stops responding when the user switches theme.

The palette is **device-local** (AsyncStorage), deliberately richer than the
API's four `accentTheme` hues, and defaults to `bloom` (pink). The server
setting still exists and still drives the web client; Settings exposes it
separately as "Web app accent". Do not write one from the other.

`ACTIVITY_COLORS` gives each of the seven day buckets its own hue so timelines
and cards read without a legend.

Type: **Outfit** for headings and anything with voice, **Figtree** for body,
**JetBrains Mono** for every number, time and ID (tabular, always). Use the
`font` object rather than string literals.

## Do not

- Add telemetry / crash SDKs that leave the device
- Import from monorepo `packages/*` or `apps/*`
- Add goal creation, levels, or leaderboards
- Log the API token
