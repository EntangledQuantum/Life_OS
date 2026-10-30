# Life OS sync protocol

**Protocol 4.** This document is the contract. A client can be built against it
without reading any server code; where this file and the running code disagree,
the code wins and please fix this file.

| | |
|--|--|
| Endpoint reference | [`API.md`](API.md) |
| What to render, and which behaviours are contracts | [`../mobile-frontend/CLIENT_GUIDE.md`](../mobile-frontend/CLIENT_GUIDE.md) |
| Android sync architecture | [`../mobile-frontend/native-android/docs/UI_SPEC.md`](../mobile-frontend/native-android/docs/UI_SPEC.md) §7 |
| Server implementation | `apps/api/src/services/sync.ts`, `push.ts`, `assets.ts` |
| Wire types | `packages/shared/src/sync.ts` |

---

## 1. Why this exists

`GET /api/v1/dashboard/today` returned the whole day in one payload and the
clients asked for it every eight seconds. Measured on the user's real data:

| | |
|--|--|
| Response body | **2,263,618 bytes** (2.16 MiB) |
| Of which inline base64 artwork | **2,205,542 bytes — 97.4%**, in 40 blobs |
| Body without the artwork | 58,076 bytes |
| Time per poll, phone → real server over a Tailscale Funnel | **14.6 s** |
| Time for the same bytes on loopback | 0.31 s |
| `ETag` / `Cache-Control` on the route | none |
| gzip | offered, returned the same bytes, and measured *slower* — likely proxy buffering |

At 14.6 s a poll on an 8 s interval, polls overlapped permanently and the app
never reached a steady state. The server was never the problem: the same work
took 0.31 s locally. The protocol was the problem.

The artwork was not merely wasteful, it was fatal. 2.26 MB in a single SQLite
row exceeds Android's 2 MB `CursorWindow` limit, so the app threw
`SQLiteBlobTooBigException` and died permanently after its first *successful*
fetch. That is patched client-side; the payload size was the cause.

And the art was never needed. Both clients cache pictures by hash and discard
the duplicate on arrival. The server was sending 2.21 MB every eight seconds for
the client to throw away.

### The user's own description of the fix

> "How do other apps do it? You just check with the server if something is
> changed. If nothing is changed, then you do not need to refresh it every time.
> And when you want to push, you can just push in the background without the
> user knowing. Everything has to be seamless. Initially the app fetches
> everything, and then it checks with the server if something changed. If
> nothing changed, no need. If something changed, you change from here, and that
> change goes into the server."

That is incremental sync, described correctly. What follows is that, built the
way the products that do it well build it.

### Measured, after

| | before | after |
|--|--|--|
| Unchanged poll | 2,263,618 B | **314 B** — or **0 B** with `If-None-Match` (`304`) |
| Unchanged poll, server time | 254 ms | **7–13 ms** |
| Cold sync (everything) | 2,263,618 B | 303,815 B |
| Cold sync, server time | 254 ms | 296 ms |
| Inline base64 in any response | 2,205,542 B | **0 B** |
| One art asset, first fetch | — | 3,334 B, then `304`/cache forever |
| Write + the delta it caused | 2.26 MB refetch | **17,022 B** in the write's own response (397 B for a no-op) |

Method and the exact commands are in §12.

---

## 2. The shape, in one page

```
         ┌─────────────────────────────────────────────────────────┐
         │  client                                                 │
         │                                                         │
  cold   │  GET /api/v1/sync                   ← no cursor         │
  sync   │  ← { reset: true, cursor: "e.41", changed: {...},       │
         │      docs: {...} }                                      │
         │                                                         │
  poll   │  GET /api/v1/sync?since=e.41                            │
         │  ← { cursor: "e.41", upToDate: true, changed: {},       │
         │      docs: {} }                       314 bytes         │
         │                                                         │
         │  GET /api/v1/sync?since=e.41                            │
         │      If-None-Match: "ab021a8b…"                         │
         │  ← 304, no body                       0 bytes           │
         │                                                         │
  change │  GET /api/v1/sync?since=e.41                            │
         │  ← { cursor: "e.44", changed: { tasks: [ … ] },         │
         │      deleted: { habits: ["x"] }, docs: { agenda: … } }  │
         │                                                         │
  write  │  POST /api/v1/sync/push                                 │
         │      { clientId, since: "e.44", mutations: [ … ] }      │
         │  ← { lastMutationId, results: [ … ],                    │
         │      sync: { cursor: "e.45", changed: { … } } }         │
         │                                        ↑ already current │
  art    │  GET /api/v1/assets/<sha256>                            │
         │  ← bytes, max-age=31536000, immutable  once, ever       │
         └─────────────────────────────────────────────────────────┘
```

Two rules decide what may appear in a payload. Everything else follows.

**1. Nothing in a sync response may depend on what time it is.** Not the
now-marker, not which reminders are due, not which task is "current". A payload
that bakes in a clock reading is stale the instant it is written — which is
exactly why the old route had to re-send the whole day to move a marker four
pixels, and why no amount of caching could ever have helped it. The server sends
*instants*; the client compares them against its own clock, which is the only
clock that matters because it is the one next to the screen.

**2. No bytes a client already has.** Artwork is content-addressed and
referenced by URL. The hash *is* the cache key.

---

## 3. Prior art

This is a solved problem and the solutions agree with each other. What each one
contributed:

**Linear's sync engine** — [Rebuilding the delta sync read
path](https://linear.app/blog/rebuilding-delta-sync-read-path). A client holds a
*checkpoint*, "the ID of the last change it applied", and the server keeps "an
immutable ordered sync action log where new sync actions are appended"; a delta
carries the affected model, a change type and the payload. A single
monotonically increasing id per write, returned in mutation responses, is the
whole mechanism. Taken: the counter, and returning the new cursor from a write
so a client that just wrote is already current.

**Replicache / Rocicorp** — [server-pull](https://doc.replicache.dev/reference/server-pull),
[server-push](https://doc.replicache.dev/reference/server-push),
[Global Version](https://doc.replicache.dev/strategies/global-version) and
[Row Versioning](https://doc.replicache.dev/strategies/row-version). The most
precisely specified of the lot. An *orderable, opaque* `cookie`; a `patch` of
`put` / `del` / `clear` ops, where `clear` is the reset channel — so a stale
cursor needs **no error code at all**, because a client must already handle a
reset for its first run. And three normative rules for the write path, one of
which is very easy to get wrong: a mutation that can never succeed **must still
advance `lastMutationID`**, or the queue wedges behind it forever. Taken: all of
it, including the reset-instead-of-error decision and the idempotency rules.

**CouchDB** — [`_changes`](https://docs.couchdb.org/en/stable/api/database/changes.html)
and the [replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html).
`since`, `last_seq`, `_deleted` tombstones, and two sharp warnings: sequences
have been "arbitrary JSON values" since 2.0, so a cursor must be treated as
opaque; and "previously seen changes may reappear, so consumers should be
idempotent". A 404 on the replication log "MUST run a Full Replication". Taken:
opacity of the cursor, and the client-side idempotency requirement.

**Microsoft Graph delta query** —
[overview](https://learn.microsoft.com/en-us/graph/delta-query-overview),
[driveItem: delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta).
The best source on bounding cursor lifetime: seven days for directory objects,
and for Outlook entities an LRU — "after the cache capacity is exceeded, the
older delta tokens are deleted". Also the crucial semantic: "the delta feed
shows the latest state for each item, not each change", and "you should always
track items by id". Taken: **one log row per entity rather than per change**,
which is what keeps the table the size of the world instead of the size of its
history.

**Google Calendar and Gmail** —
[Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync),
[Gmail history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list).
Calendar answers an invalidated `syncToken` with `410` and reason
`fullSyncRequired`; Gmail answers an out-of-date `startHistoryId` with `404` and
says "your application should perform a full sync", with a `historyId`
"typically valid for at least a week". Considered and deliberately *not* taken —
see §9 — because Replicache's reset-in-band approach needs one fewer code path
in the client.

**Google Drive's change feed** —
[Change resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes).
`removed` is documented as "whether the file or shared drive has been removed
from *this list of changes*, for example by deletion or loss of access" — not
"was deleted". Taken: a tombstone here means "no longer yours to show", which is
what lets a soft-deleted habit be tombstoned while its row and its history stay
in the database forever.

**Figma** — [How Figma's multiplayer technology
works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/).
Worth reading for what it *refuses* to do: Figma downloads the whole document on
open and, on reconnect, "the client downloads a fresh copy of the document,
reapplies its offline edits on top". A deliberate choice of full re-bootstrap
over a replayable per-client log, because the simplicity is worth more than the
bytes. The reason Life OS does not follow it is that Figma re-bootstraps on
*reconnect* while this client polls every eight seconds.

**Notion** — [How we made Notion available
offline](https://www.notion.com/blog/how-we-made-notion-available-offline).
Rejected client polling outright as unable to "scale to millions of users and
devices" and emits per-page channel messages instead; on reconnect a client
compares a per-page `lastDownloadedTimestamp` against the server's
`lastUpdatedTime`. Not followed, because this is one user and one server on
their own machine — the thing polling cannot scale to is the thing Life OS does
not have.

**HTTP** — [RFC 9110 §8.8](https://www.rfc-editor.org/rfc/rfc9110.html) for
`ETag` / `If-None-Match` / `304`, [RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html)
for `Cache-Control: immutable`, whose stated intended use is exactly
content-addressed URLs — "versioned URLs, where content changes are published
under a new URL" — and [RFC 9111 §3.5](https://www.rfc-editor.org/rfc/rfc9111.html),
which forbids a shared cache reusing a response to an `Authorization`-bearing
request unless explicitly permitted. Taken: §8.

---

## 4. The cursor

A cursor is an **opaque string**. Store it, send it back, and never parse it,
compare it, or try to order two of them.

Its current form is `<epoch>.<version>`, and knowing that is useful only for
reading logs. `version` is a monotonic counter bumped by a SQLite trigger on
every write to anything a client holds. `epoch` identifies this database's
history.

The epoch is there for one failure the counter alone cannot survive: a **restore
from backup**. The counter legitimately goes backwards, and a client holding a
higher number would otherwise be told "nothing has changed" forever while
showing a day that no longer exists. Comparing epochs turns that into a single
reset, which is survivable.

A counter and not a timestamp, because wall clocks go backwards and two writes
in the same millisecond are indistinguishable. One counter for the whole
database and not one per collection, because a client has exactly one question
to ask.

---

## 5. `GET /api/v1/sync`

**The one read.** Replaces `GET /api/v1/dashboard/today`, which is gone (§13).

```http
GET /api/v1/sync?since=<cursor>
Authorization: Bearer <API_TOKEN>
X-LifeOS-Protocol: 4
If-None-Match: "<etag from the last response>"    (optional, recommended)
```

Omit `since` for a cold sync. `since` is the only parameter; there is nothing
else to tune.

### The envelope

```jsonc
{
  "protocol": 4,
  "cursor": "mvv3o0rz52fk5s.44",   // store this; send as `since` next time
  "reset": false,                  // true → discard everything you hold first
  "upToDate": false,               // true → changed, deleted and docs are all empty
  "lifeDay": {
    "lifeDay": "2026-10-30",       // the life-day, not the calendar day
    "lifeDayStart": "2026-10-29T22:30:00.000Z",
    "lifeDayEnd":   "2026-10-30T22:30:00.000Z",
    "dayResetTime": "04:00",
    "timezone": "Asia/Kolkata"
  },
  "serverTime": "2026-10-30T15:03:57.069Z",
  "changed": {                     // whole rows, keyed by collection
    "tasks":  [ /* SyncedTask */ ],
    "habits": [ /* HabitWithToday */ ]
  },
  "deleted": {                     // ids to forget
    "habits": ["-h7SyQLA8AYgkJ"]
  },
  "docs": {                        // computed documents, replaced whole
    "agenda": { "items": [ … ], "anytime": [ … ] },
    "progress": { … }
  }
}
```

An unchanged poll in full — this is the 314 bytes:

```json
{"protocol":4,"cursor":"mvv3o0rz52fk5s.5","reset":false,
 "lifeDay":{"lifeDay":"2026-10-30","lifeDayStart":"2026-10-29T22:30:00.000Z",
 "lifeDayEnd":"2026-10-30T22:30:00.000Z","dayResetTime":"04:00","timezone":"Asia/Kolkata"},
 "serverTime":"2026-10-30T15:03:57.069Z","changed":{},"deleted":{},"docs":{},"upToDate":true}
```

`lifeDay` rides along even in an empty delta. It is 180 bytes well spent: it is
what every queued write is stamped against, and it is how a client discovers the
day rolled over while the phone was in a pocket.

`serverTime` is the server's clock when it answered. Use it to correct your own
clock offset — a phone whose time is minutes out will get the now-marker and the
due reminders wrong. Do **not** use it for display; the point of §2 rule 1 is
that display uses the local clock.

### Applying a response

```
if (reset)        drop every entity and every doc you hold
for each collection in changed:  upsert each entity by its id
for each collection in deleted:  delete those ids
for each name in docs:           replace that document wholesale
store cursor
```

In that order. `changed` and `deleted` never name the same id in the same
response.

Be idempotent. An entity may arrive again when nothing about it changed — the
daily XP pool is redistributed across habits whenever one is added, so every
habit legitimately moves at once — and CouchDB's warning applies here too:
previously seen changes may reappear.

---

## 6. Collections

Six, each a set of rows keyed by its own id:

| collection | id field | type in `@life-os/shared` |
|---|---|---|
| `habits` | `id` | `HabitWithToday` |
| `tasks` | `id` | `SyncedTask` (`Task` + four window instants) |
| `goals` | `id` | `Goal`, with `tiers` and the three derived tier pointers |
| `properties` | `uid` | `AgentProperty` |
| `quests` | `id` | `Quest` |
| `achievements` | `id` | `Achievement` |

An entity in `changed` is **the whole current row**, never a field-level patch.
A partial row saves a few hundred bytes and buys a merge bug in every client.

There is no scope filter and no pagination: you get every task, including
`done`, `missed` and `dismissed`. That is deliberate — it makes the Timeline and
history screens work with no network — and it is the one thing in this protocol
with an unbounded growth path. See §14.

### `SyncedTask` — the four instants

Each task carries four extra fields that are pure functions of the row and the
user's `reminderLeadMinutes`. **No clock is read to produce them**, so they are
stable between polls and may be cached with the row forever:

| field | meaning |
|---|---|
| `currentFrom` | first instant this task is "current" and belongs on the front page |
| `currentUntil` | last instant it is current; `null` means it has no window of its own |
| `dueFrom` | first instant its notification should fire |
| `dueUntil` | last instant firing it is a nudge rather than an accusation |

They exist so that the policy stays on the server — where it has always been,
with its shelf lives and default windows and edge cases — while the *clock
comparison* moves to the client, which is the part a server cannot do correctly
from a distance. Without them a client would reimplement `isCardImminent` and
`isReminderDue` from scratch, and the phone and the dashboard would drift apart
about which task is urgent.

---

## 7. Tombstones

`deleted` means **"this is no longer yours to show"**, not strictly "a row was
deleted". Drive words its `removed` flag the same way and for the same reason.
Two things produce one:

- a hard delete (`DELETE /api/v1/tasks/:id`)
- an entity leaving scope without leaving the database — a habit with
  `deletedAt` set is physically still there, and its history is never destroyed,
  but a client that kept it would show a habit the user retired

Retention is **30 days**. Longer than any phone is plausibly offline, and
shorter than forever. Past that, tombstones are pruned and the floor below which
the server can no longer say what to delete rises; a cursor below it is answered
with a reset (§9). For comparison, Graph bounds directory delta tokens at seven
days and Gmail guarantees a `historyId` for about a week.

The log holds **one row per entity, not one per change** — a new change
overwrites the entity's previous entry with a higher version. So the table is
bounded by the number of things that exist plus the number ever deleted, and a
client that has been away for a month gets each changed thing once rather than
once per edit.

---

## 8. Derived documents

Nine computed documents. Each is sent **whole** and replaces your copy; each is
**absent when it has not changed**.

| doc | what it is |
|---|---|
| `agenda` | `{ items, anytime }` — today as one ordered list of habits and tasks |
| `ribbon` | the planned day as 0–24h segments, **uncut** |
| `lived` | what actually happened today, as intervals; the open one has `endedAt: null` |
| `progress` | `totalXp`, `dailyXp`, `dailyXpTarget`, `efficiencyPct`, `yesterdayEfficiencyPct`, `lastImprovementPulse`, `growthStyle` |
| `insights` | `vsYesterday`, `pulse`, `pulseExplanation`, `consistency7`, `xpSeries7` |
| `studySessions` | the last 20 |
| `settings` | `AppSettings` |
| `gamification` | `GamificationConfig` |
| `activeSession` | `ActiveSession | null` — **present-but-null is a real value**, meaning cleared |

A document has no row to put a trigger on, so the server recomputes all nine
whenever the counter has moved, hashes each, and sends only those whose bytes
actually changed. Completing a habit moves `agenda`, `progress` and `insights`
and leaves the other six exactly as they were.

### What the client computes, and why

These are the things that used to be in the payload and now are not, because
they depend on the current time. Pure helpers for every one of them are exported
from `@life-os/shared`; a non-TypeScript client reimplements them, and each is
small on purpose. They are not all in one file — `isCurrentAt`,
`isReminderDueAt` and `composeTimeline` are in `packages/shared/src/sync.ts`,
while `paceAdjustedImprovementPct` and `dayFractionAt` are in
`packages/shared/src/xp.ts` (with their cases in `xp.test.ts`, which is what a
port to another language should be tested against). The package barrel exports
all of them, so `@life-os/shared` is the only import a TypeScript client needs.

| was | now | helper |
|---|---|---|
| `current` — tasks on the front page | compare `currentFrom` / `currentUntil` with your clock | `isCurrentAt(task, now)` |
| `dueReminders` — what should chime | compare `dueFrom` / `dueUntil`, and `notifiedAt` | `isReminderDueAt(task, now)` |
| `timeline` — the ribbon, pre-cut at the now-marker | compose `ribbon` + `lived`, cut at your clock | `composeTimeline(ribbon, lived, activityColor, now)` |
| `progress.improvementPct` | `paceAdjustedImprovementPct(efficiencyPct, yesterdayEfficiencyPct, dayFractionAt(lifeDay, now))` | both exported |
| `pendingCelebrations` | `goals.filter(g => g.celebrationPending)` | — |

This is not merely cheaper, it is better. The now-marker advances smoothly
between polls instead of jumping on each one, and a reminder fires when it is due
rather than up to eight seconds later.

`activityColor` / `ACTIVITY_COLORS` are exported too, and are part of the
contract: the server colours the planned half of the ribbon and the client
colours the lived half from the activity name. Two tables would make the same
hour change colour as it crossed the marker.

**`notifiedAt` is still the server's record that a reminder fired.** Post
`task.notified` and the flag comes back in the next delta, so a reminder still
fires exactly once across every device. That contract has not changed.

---

## 9. Reset, errors and resume

### A cursor the server cannot honour

Three cases, one answer:

- no cursor (first run)
- a cursor from a different `epoch` (restored backup, a different instance on
  the same address)
- a cursor older than the pruned tombstones, or newer than the server's own
  counter
- a malformed cursor of any kind

All of them return **`200` with `reset: true`** and the whole current state.

There is deliberately **no `410 fullSyncRequired`**, even though Calendar and
Gmail both have one. A client must already implement the reset path for its
first run; giving it a second entry point to the same behaviour only adds a way
to get it wrong. This is Replicache's `clear`-op argument and it is correct.

### Other statuses

| status | meaning | what to do |
|---|---|---|
| `200` | a delta, possibly empty | apply it |
| `304` | you are current (you sent `If-None-Match`) | nothing; keep your cursor |
| `401` | token wrong or rotated | clear it, go to the connect screen, **do not retry in a loop** |
| `409` | on `/sync/push` only: your mutation numbering has a hole | resend from `lastMutationId + 1` |
| `426` | your protocol is too old | full-screen block, offer `downloadUrl` |
| `5xx` | server fault | retry once with backoff, then surface it |
| timeout / refused | the machine is asleep or unreachable | normal, not a crash; show the cached day marked stale |

### Resume

There is nothing to resume. A delta is a single response, not a stream, and a
failed poll is simply retried with the same `since`. Your cursor only advances
when a response has been fully applied — so apply, *then* store the cursor, in
that order. A crash between the two costs one redundant delta, which is
idempotent.

---

## 10. Artwork

Every picture is content-addressed:

```http
GET /api/v1/assets/<sha256-hex>
Authorization: Bearer <API_TOKEN>
→ 200, Content-Type: image/jpeg
       ETag: "<sha256-hex>"
       Cache-Control: private, max-age=31536000, immutable
```

**This is the change that mattered: 2,205,542 bytes per poll became a URL
fetched once, ever.** A hash cannot describe different bytes, so there is nothing
to revalidate and not even a `304` round trip — RFC 8246 names exactly this as
what `immutable` is for.

### It costs the clients almost nothing

`resolveArt()` already prefers `*ImageData` and falls back to `*ImageUrl`, and
the Android client reads `Art.picture` the same way. So the server writes the
asset URL into the **url** slot and nulls the **data** slot, and both clients
render the same picture through the path they already had. The only new work is a
disk cache, which both clients already have (Cache Storage on the web,
`expo-image`/Coil on the phone).

Fields affected: `iconImageUrl` / `iconImageData` and `backgroundImageUrl` /
`backgroundImageData` on habits, goals and goal tiers; `imageUrl` / `imageData`
and `iconImageUrl` / `iconImageData` on tasks; `iconImage` on an agenda item. An
`*ImageUrl` that was already a real external link is untouched.

### Two things to know

**The URL is absolute**, built from the address the request arrived on. It has to
be: this instance may be published under a path prefix (`…/lifeos`) behind a
gateway, and `/api/v1/assets/…` resolved against that base would silently drop
the prefix. You need no join logic.

**It requires the token.** This is the user's own artwork and their instance may
be on a public Funnel, so the route is authenticated and marked `private` — RFC
9111 §3.5 forbids a shared cache holding it otherwise. Consequences:

- **Native clients**: nothing to do. Your existing auth interceptor covers it.
- **Web clients**: an `<img src>` cannot send an `Authorization` header. Fetch
  the asset and use `URL.createObjectURL`, or add the header in a service
  worker — which also gets you the on-disk cache for free.

The route is deliberately **outside** the `X-LifeOS-Protocol` gate: an image
loader sends no protocol header, and these bytes have no versioned shape to
argue about.

A hash the server does not hold is a `404` with a `hint`. It means the art it
belonged to was replaced; nothing in a current sync response will reference it.

---

## 11. Cache headers

On `/api/v1/sync`:

```
ETag: "c39936f12…"
Cache-Control: private, no-cache
Vary: Authorization, X-LifeOS-Protocol
```

The `ETag` is **strong** and is a function of exactly what decides the body: the
cursor the server would hand back, which life-day it is, and the `since` the
client asked from. `since` is in there because two clients at different cursors
get different bodies from the same URL.

`serverTime` is in the body but **not** in the `ETag`, on purpose. It moves on
every request, so including it would mean no two requests ever matched and `304`
would be dead code.

`private` because this is one person's day and must never be held by a shared
cache on the way through a tunnel. `no-cache` rather than `no-store` so the
client's own HTTP cache may keep the response and revalidate it — that
revalidation *is* the mechanism.

Send `If-None-Match` on every poll. It is the difference between 314 bytes and
zero.

### A browser client needs two CORS entries before any of this works

Neither header is on the CORS safelist: `If-None-Match` is not a safelisted
*request* header, and `ETag` is not a safelisted *response* header. So a web
client on an origin the API does not itself serve — which is every development
setup, and any dashboard hosted apart from its server — can neither send a
validator nor read one back. Nothing fails loudly; the browser drops the request
header, the client never learns the `ETag`, and every poll quietly returns
`200`-with-body while appearing to work. The API therefore names
`If-None-Match` in `allowHeaders` and `ETag` in `exposeHeaders`
(`apps/api/src/app.ts`). A native client has no equivalent to do.

---

## 12. `POST /api/v1/sync/push`

**The one write.** Mutations up, authoritative results and a delta back — so a
client that has just written is current when the response lands and does not
poll to discover what its own tap did.

```http
POST /api/v1/sync/push
Authorization: Bearer <API_TOKEN>
X-LifeOS-Protocol: 4
Content-Type: application/json

{
  "clientId": "a-stable-id-per-installation",
  "since": "mvv3o0rz52fk5s.44",
  "mutations": [
    { "id": 1, "name": "habit.complete",
      "lifeDayDate": "2026-10-30",
      "args": { "habitId": "…", "source": "user" } }
  ]
}
```

```jsonc
{
  "protocol": 4,
  "lastMutationId": 1,
  "results": [ { "id": 1, "status": "applied", "result": { /* what the write returned */ } } ],
  "sync": { /* a full SyncEnvelope, the delta from `since` to now */ }
}
```

### The mutations

A closed set — deliberately not "any REST call, batched", because naming them
makes each one's day-sensitivity explicit.

| name | args | day-bound |
|---|---|---|
| `habit.complete` | `habitId`, `source`, `note?` | yes |
| `habit.undo` | `habitId` | yes |
| `task.complete` | `taskId`, `source`, `note?`, `progress?` | yes |
| `task.interact` | `taskId`, `value?`, `pressed?` | yes |
| `task.dismiss` | `taskId` | no |
| `task.notified` | `taskId` | no |
| `goal.celebrationSeen` | `goalId`, `tier?` | no |
| `session.set` | `activity`, `startedAt?`, `blockId?` | yes |
| `session.clear` | — | yes |
| `study.create` | `title`, `durationMinutes`, `qualityFlag`, … | yes |
| `settings.patch` | any `AppSettings` field | no |

Everything else — creating habits, writing goals, scheduling tasks, changing the
XP pool — belongs to the agent and stays on the REST surface, which is
unchanged. See CLIENT_GUIDE "What not to build".

Set `source: "user"` on anything the human actually did. It is how the user's
agent tells their actions apart from the person's.

### Idempotency

`id` is a counter **your client persists** and increments by exactly one per
mutation. Not a random id, not a timestamp.

- `id <= lastMutationId` → `status: "duplicate"`, not applied again. This is what
  stops an offline queue drained twice from completing a habit twice and paying
  for it twice.
- a gap (`id > lastMutationId + 1`) → **`409` and the whole batch is refused**,
  with `lastMutationId` in the body. A hole means a mutation never arrived;
  half-applying the rest would record a number past the hole and make the loss
  permanent and invisible.
- a mutation that can never succeed → `status: "rejected"` and **`lastMutationId`
  advances anyway**. This is the rule that bites late: a permanently invalid
  mutation that did not advance the counter would block every write queued
  behind it forever and silently kill the client.

### The life-day guard

Enforced here as well as on the client. The client's own check — UI_SPEC §7.5 —
cannot catch a write that was already in flight when the clock passed 04:00.

Every day-bound mutation must carry `lifeDayDate`, the life-day that was current
when the user pressed the thing. If it no longer matches the server's:

```json
{ "id": 1, "status": "staleLifeDay",
  "error": "This was done on 2020-01-01 and the life-day is now 2026-10-30. Saving it would put it on the wrong day." }
```

**Never retryable.** Strand it and tell the user, as UI_SPEC §7.5 already
specifies. A habit completion replayed onto the wrong day corrupts a streak
silently, which is strictly worse than losing the write. A day-bound mutation
with no `lifeDayDate` is `rejected`.

### Statuses

| `status` | meaning | client |
|---|---|---|
| `applied` | done; its effects are in `sync` | drop from the queue |
| `duplicate` | already applied, or a no-op like a habit already done today | **treat as success** — drop from the queue, keep the optimistic tick |
| `staleLifeDay` | the day turned | strand it, surface once, never retry |
| `rejected` | permanently wrong | strand it with its `error` |

`duplicate` covers the `409`-on-habit-complete case that CLIENT_GUIDE already
tells you to treat as success: the tick is on screen and the thing did happen.

---

## 13. Push versus poll — the decision

**Decided: a cheap conditional poll. No SSE, no WebSocket, and no long poll.**

The honest case for each:

**A persistent stream only helps in the foreground.** Android's
[Doze](https://developer.android.com/training/monitoring-device-state/doze-standby)
"suspends network access", "ignores wake locks" and does not let `JobScheduler`
run — which `WorkManager` uses internally — and `setExactAndAllowWhileIdle()`
cannot fire more than once per nine minutes per app. A backgrounded app gets
[several minutes](https://developer.android.com/about/versions/oreo/background)
before its services are stopped "just as if the app had called
`Service.stopSelf()`". So an SSE connection cannot survive backgrounding, and
cannot be rebuilt until a maintenance window. Google's own advice on that page
is to be woken by FCM "rather than polling in the background" — and FCM means a
Google dependency in an app whose pitch is that nothing is watching, for a
server that is a machine in the user's bedroom.

**The foreground case is already cheap.** An unchanged poll is 314 bytes, or
zero with `If-None-Match`, and 7–13 ms of server time. At eight seconds that is
roughly 40 bytes a second. The expensive thing was never the request.

**A relay makes a held connection worse, not better.** The portal proxy speaks
HTTP/1.1, and gzip through it measured *slower* than no gzip, which points at
buffering. A buffering proxy defeats a long poll's entire purpose while still
costing a connection to keep alive. Android's
[`SocketKeepalive`](https://developer.android.com/reference/android/net/SocketKeepalive)
exists precisely because idle connections cost battery — it offloads keepalives
to hardware "to save battery power" — and guarantees only **one** slot on
cellular.

**Server-to-agent push already exists** and is unaffected: webhook targets fire
on completion, which is the case that genuinely needs to be pushed.

I could not find a controlled measurement comparing SSE, long poll and periodic
polling on mobile battery; everything available was vendor copy or forum
argument. The decision above rests on the platform constraints, which are
documented and binding, rather than on a joules-per-hour figure I would be
inventing.

**If a long poll is wanted later**, it can be added as `wait=<seconds>` without
changing this envelope and without bumping the protocol — because a timed-out
wait and an empty delta are the same response. That is a deliberate property of
the design, not a coincidence.

---

## 14. What is not solved

Stated plainly, because the measurements above are easy to over-read.

**The cold sync grows without bound.** 303,815 bytes today, of which 242,661 is
213 tasks. Tasks accumulate forever and nothing prunes them, so at the current
rate this is roughly a megabyte a year — eventually a slow first run on a new
phone. The fix is a retention window on the `tasks` collection, emitting
tombstones for rows that fall out of it; the hook for it already exists, in the
once-a-day `advanceDay` pass in `sync.ts`, because a scope window must move on
the day boundary and never on the clock. Not built, because it is a second
scoping concept and today's number does not justify it.

**Cold sync is not paginated.** One response, 296 ms, ~300 KB. Fine now;
Linear's bootstrap streams NDJSON with a trailing metadata record for a reason,
and that is the shape to copy if this ever gets slow.

**`refreshTodaySnapshot` still writes during a read.** It rewrites
`daily_snapshots` and `user_progress` whenever a derived document is computed.
It is harmless — those two tables deliberately have **no** sync trigger, because
one there would bump the counter on every GET and no poll could ever answer
"nothing changed" — but it is write amplification on a read path and it is why
that trigger must never be added. A test pins the behaviour.

**MCP still serves the whole dashboard.** `getDashboard` is unchanged and the
MCP tool hands an agent the entire day, art included. That is the right shape for
an agent reading once over a local channel and the wrong one for a phone polling
over a relay, but a 2 MB tool response is not free either. Left alone as out of
scope.

**The `assets` table duplicates the art.** 1,670,004 bytes across 24 rows,
alongside the original `*_image_data` columns, which are untouched — migrations
here are additive and never rewrite someone's rows. On a 5 MB personal database
that is an acceptable trade for being able to roll back the release with no data
loss.

**Tombstone pruning runs once a day**, on the first sync after the life-day
turns. A database nobody touches for a month prunes nothing until it is next
read, which is correct but means the floor can lag.

---

## 15. Migrating a client

Short version: the art half is nearly free, the read half is a rewrite of one
function, and four display values move to the client.

1. **Send `X-LifeOS-Protocol: 4`.** A v3 client gets `426` on every `/api/v1`
   route, with a `downloadUrl`. There is no compatibility layer by design.
2. **`GET /api/v1/dashboard/today` is gone** — `404`. Replace it with
   `GET /api/v1/sync`.
3. **Store the cursor** next to your cache and send it as `since`. Store it
   *after* applying a response.
4. **Store entities as rows, not as one blob.** The Android `CursorWindow` crash
   was a 2.26 MB row; six keyed tables plus nine documents cannot reproduce it.
   UI_SPEC §7.1 already describes Room holding "parsed entities" — this is that,
   with the server finally sending the right shape for it.
5. **Handle `reset: true`** by clearing local state before applying.
6. **Send `If-None-Match`** and handle `304` as "nothing changed".
7. **Compute the four clock-dependent things yourself** (§8). Web imports them
   from `@life-os/shared`; Android reimplements five small functions.
8. **Art is a URL.** Add the auth header in your image loader (native) or fetch
   + object URL / service worker (web). Cache by the hash in the last path
   segment, or by the whole URL — both are content-addressed.
9. **Move writes to `POST /api/v1/sync/push`** with a persisted per-client
   mutation counter, and keep the life-day stamp you already attach. The
   response carries the delta, so **stop refetching after a write**.
10. **Keep `task.notified`.** Reminders still fire once, server-recorded.

The REST surface is otherwise unchanged, so an incremental migration works: move
the read to `/sync` first, keep writing over REST — every REST write bumps the
cursor, because the change log lives in SQLite triggers rather than in the
service layer — then move writes to `/sync/push` when convenient.

---

## 16. How the measurements were taken

Against a real instance on real data: the user's production database copied to a
scratch path, served by a second instance on port 8795 with
`TUNNEL=off API_HOST=127.0.0.1`, so the production instance on 8787 was never
touched.

```sh
API_TOKEN=<strong> DATABASE_PATH=<scratch>/lifeos.db API_PORT=8795 TUNNEL=off \
  pnpm --filter @life-os/api start
```

Data: 21 habits, 213 tasks, 14 goals with 19 tiers, 6 properties, 11
achievements, 25 study sessions, 119 activity-log intervals, 74 daily snapshots.

Bodies were measured as the byte length of the response, timings as
wall-clock around `fetch` from the same machine — so they isolate server work
and exclude the network, which is the point: the 14.6 s figure in §1 came from
the phone over the Funnel, and what this change reduces is the bytes that have to
cross it.

The before figures were taken on the same instance before the change, and the
97.4% artwork share by summing every `"data:…"` string longer than 200
characters in the payload.
