# Life OS — Expo mobile app (Android-first)

Native client for Life OS. Lives entirely under `mobile-frontend/app/` and talks
to the API over HTTP only. See `../CLIENT_GUIDE.md` for product contracts and
`../README.md` for the isolation rules.

## Stack

- Expo SDK 57 · React Native · Expo Router (tabs)
- TanStack Query · SecureStore · expo-notifications
- `react-native-android-widget` — large home-screen status widget
- Dark mode only · Figtree + JetBrains Mono

## Screens

| Tab | What |
|-----|------|
| **Today** | Pulse, vs-yesterday, agent cards, right-now activity, day ribbon, growth meter, quick log, up next (15 min) |
| **Timeline** | Full day shape + every scheduled card grouped by day |
| **Goals** | Read-only goals + agent properties |
| **Settings** | Connection, DND, sounds, accent, surfaces |
| **Connect** | Server URL + API token only (validated via `/auth/me`) |

## Contracts implemented

- Token in SecureStore (never logged)
- `dashboard/today` as the primary read (8s poll; back off when backgrounded)
- Habit `409` treated as success
- `source: "user"` on human actions
- Growth meter ghosted 100% state
- Timeline from `timeline[]` (not recomputed)
- `upcoming` vs `scheduled` split
- XP as green indicator, not a button
- Reminders fire once → POST `/notified` **even under DND**
- DND / quiet hours silence the interruption, not the card
- Silence visible (DND / quiet chip)
- Celebration full-screen; `celebration-seen` only on dismiss
- Offline: last cached dashboard, marked stale

## Run (Expo Go — UI only)

```bash
cd mobile-frontend/app
npm install
npx expo start
```

On the Life OS server machine, set `API_HOST=0.0.0.0` and restart so the phone
can reach `http://<lan-ip>:8787`. Paste that URL + your `API_TOKEN` on the
Connect screen.

> **Widgets and reliable local notifications require a native Android build**,
> not Expo Go. Expo Go is fine for iterating on screens.

## Android build (when you're ready)

When the app is finished and you want the widget + production notifications:

```bash
cd mobile-frontend/app
npx eas-cli login          # once
npx eas build:configure   # once
npx eas build --platform android --profile preview
```

Or local:

```bash
npx expo prebuild --platform android
npx expo run:android
```

## Widget

**Life OS Status** — large resizable widget:

- Pulse + efficiency % + XP + habits
- Day timeline ribbon
- Current activity
- Tap activity chips to switch session (calls API with stored token)

Refreshes when the app loads `dashboard/today` and on the system 30-minute
widget update period.

## Isolation

Do **not** import from `packages/*` or `apps/*`. Types are copied into
`lib/types.ts`. Do **not** add this folder to the root pnpm workspace.
