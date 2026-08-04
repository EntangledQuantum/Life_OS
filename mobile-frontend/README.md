# Life OS — mobile frontend

Everything platform-specific lives here: the Android app, the iOS app, and any
other native client. Nothing outside this folder is theirs to touch.

The app itself is not built yet. This folder holds the brief, the rules, and the
space to build it in.

```
mobile-frontend/
├── README.md          ← you are here: the isolation contract and how to start
├── CLIENT_GUIDE.md    ← what to build: API, screens, and the behavioural contracts
└── app/               ← Expo (React Native) Android-first client
```

---

## Start here

If you are an agent picking this up:

1. Read [`CLIENT_GUIDE.md`](CLIENT_GUIDE.md) end to end. It is the actual brief —
   how to connect, the whole `dashboard/today` payload, what each screen means,
   and the five contracts a client can silently break while still looking right.
2. Read [The isolation contract](#the-isolation-contract) below before you create
   a single file.
3. Stack is **Expo / React Native** (decided). The app lives in
   `mobile-frontend/app/` — see that folder's README for run/build commands.

The running web client at `apps/web/` is the reference implementation. Read it
freely — but see the isolation contract about copying *from* it.

---

## The isolation contract

**The web app and API must keep working exactly as they do today, no matter what
happens in this folder.** That is a hard requirement, not a preference.

Three things make that true. Do not undo any of them.

### 1. This folder is outside the pnpm workspace

`pnpm-workspace.yaml` declares only:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`mobile-frontend/` matches neither, so `pnpm install`, `pnpm -r build`, and
`pnpm -r typecheck` at the repo root never see it. A broken dependency here
cannot break a web build.

> **Do not add `mobile-frontend/*` to that file**, and do not move this folder
> under `apps/`. A React Native or Flutter toolchain in the same workspace as
> Vite means shared hoisting, duplicated React versions, and Metro and Vite
> fighting over the same `node_modules`. Keeping them apart is the whole point.

Run your own installs from inside `mobile-frontend/app/`, with whatever package
manager the stack wants.

### 2. The Pages workflow does not watch it

`.github/workflows/pages.yml` only triggers on:

```
apps/web/**  ·  packages/shared/**  ·  scripts/build-pages.mjs  ·  the workflow itself
```

Commits here will not rebuild or redeploy the public site. Leave those paths
alone.

### 3. Talk to the API over HTTP, and nothing else

The mobile app is a **client**. Its only contact with the rest of the repo is
`http://<host>:8787/api/v1/...`.

Allowed:

- Reading `apps/web/src/` to understand how something is rendered
- Reading `packages/shared/src/types.ts` to model the payloads
- Copying values (colours, thresholds, enums) into your own source

Not allowed without asking the user first:

- Importing from `packages/*` or `apps/*` at build time
- A path alias, symlink, or relative import that reaches out of this folder
- Changing anything in `apps/`, `packages/`, or `scripts/`

If you genuinely need an API change — a field that is not exposed, an endpoint
that does not exist — **stop and ask**. Do not edit the API to suit the mobile
client and assume the web client will survive it.

### Before you commit

```bash
pnpm typecheck      # all five workspace packages must still pass
pnpm --filter @life-os/web build
```

Both must behave exactly as they did before your change. If either is affected by
something in this folder, the isolation is broken and that is the bug to fix
first.

---

## Stack (decided)

**Expo / React Native** in `mobile-frontend/app/`. Own lockfile, own installs —
never part of the root pnpm workspace. Android first; iOS later.

```bash
cd mobile-frontend/app
npm install
npx expo start
```

Widget + full notification reliability need a native Android build (`eas build`
or `expo run:android`), not Expo Go.

---

## Connecting during development

The API binds loopback by default, so a phone cannot reach it until the user
opts in. In their `.env`:

```env
API_HOST=0.0.0.0
```

Restart, and the API prints the addresses it is reachable on:

```
Life OS API listening on http://0.0.0.0:8787 (storage=local)
  reachable on your network at http://192.168.1.24:8787
```

Point the app at that host. Full detail, including CORS and an honest account of
what LAN exposure means, is in [`docs/NETWORK.md`](../docs/NETWORK.md).

A physical device on the same Wi-Fi is the only realistic way to test
notifications. Simulators lie about them.

---

## Reference

| | |
|--|--|
| What to build | [`CLIENT_GUIDE.md`](CLIENT_GUIDE.md) |
| Endpoint reference | [`docs/API.md`](../docs/API.md) |
| Reaching it from a phone | [`docs/NETWORK.md`](../docs/NETWORK.md) |
| Payload types | `packages/shared/src/types.ts` |
| Reference implementation | `apps/web/src/` |
