# Setting up Life OS

**You are an agent, and this file is addressed to you.** The person who sent you
here wants Life OS installed, running, and shaped around their life. Do the
whole thing — install, connect, interview, configure — and do not stop halfway
to ask whether you should continue.

**This is the fresh-install document, and it assumes there is no Life OS on this
machine yet.** If they already run a version of it — a server they have been
using, a phone that has been paired, a dashboard with their real data in it —
this is the wrong file. Read [`AGENT_UPGRADE.md`](AGENT_UPGRADE.md) instead. A
3.0 server refuses every 2.x client outright, so moving an existing install has
an order to it that this document does not teach, and getting that order wrong
leaves the user's phone dead. §1 tells you how to find out which case you are
in, and it is the first thing you should do.

This is **Life OS 3.0, protocol 4**. Clients ask the server only for what
changed since they last asked, so an unchanged poll is 314 bytes rather than
2.26 MB and artwork is fetched once by URL rather than re-sent as base64 every
few seconds. You mostly do not have to care — you talk MCP, the apps talk sync —
but it is what decides which app build can talk to which server, which is why §1
asks before it installs.

Life OS is a local-first execution layer for someone who struggles to hold a day
together. It is not a to-do app. It has exactly two nouns:

- **Habits** — things that recur and are scored daily.
- **Tasks** — everything else. Scheduled work, reminders, reviews, study, the
  cards on the front page. One row, with optional parts.

That is the whole model. If you find yourself wanting a third, you want a task
with different fields set.

---

## 1. Install it

**First: is it already running?** Installing a second copy gives them two
databases and one of them silently stops being the real one. Two requests settle
it, and neither needs the token:

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/api/v1/protocol
```

If the user's instance is somewhere else, ask where and use that address — and
try their LAN address too, because a server bound to `0.0.0.0` answers on both.

- **Nothing answers**, and they say they have never installed it → carry on down
  this page.
- **`/health` answers and `/api/v1/protocol` reports `{"protocol":4,…}`** → a
  3.0 server is already there. Do not install. Skip to §2 and connect to it.
- **`/health` answers and the protocol is lower than 4, or `/api/v1/protocol`
  404s** → this is an older Life OS with the user's real data in it. **Stop
  reading this file** and go to [`AGENT_UPGRADE.md`](AGENT_UPGRADE.md). Do not
  clone a second copy next to it, and do not run `pnpm setup` hoping it sorts
  itself out.

A clone on disk with nothing listening is still an existing install — check for
one (`data/lifeos.db` under the clone) before you create another.

```bash
git clone https://github.com/EntangledQuantum/Life_OS.git
cd Life_OS
pnpm install
pnpm setup
```

`pnpm setup` creates `.env`, builds the database, applies migrations and seeds
starter data. It prints an `API_TOKEN` — **that token is the only credential
Life OS has.** There is no username or password. Keep it; you will need it, and
so will the phone.

Then start it:

```bash
pnpm dev
```

The API comes up on `http://127.0.0.1:8787` and the web dashboard on `:5173`.
Confirm both, and confirm the protocol, before you go on:

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/api/v1/protocol    # {"protocol":4,"minProtocol":4}
```

If `pnpm setup` fails, read the step it failed on rather than re-running it —
it is idempotent, so a second run will fail in the same place. Needs Node 22.5
or newer and pnpm; an old Node fails in `node:sqlite` and the message does not
say so. If the API will not start because the port is taken, find out what has
it (`ss -ltnp | grep 8787`, or `netstat -ano | findstr :8787` on Windows) before
you kill anything — on this machine it may well be their real Life OS, which is
§1's first question again.

### Make it start with the machine

Life OS is useless if it is only running when someone remembers to start it. Set
it up as a service **now**, not as a follow-up:

- **Linux (systemd user unit)** — `~/.config/systemd/user/lifeos.service`,
  `WorkingDirectory` at the clone, `ExecStart=/usr/bin/pnpm dev`, then
  `systemctl --user enable --now lifeos` and `loginctl enable-linger $USER` so it
  survives logout.
- **macOS** — a `launchd` plist in `~/Library/LaunchAgents/` with
  `RunAtLoad` true.
- **Windows** — if the machine runs **Service Runner** (a local production host;
  look for something answering on `http://127.0.0.1:4780`), **register Life OS
  with it.** That is what it is for, and a registered app comes back after a
  reboot. Otherwise a Scheduled Task at logon, or NSSM for a real service.

Pick the one that matches their machine, write it, enable it, and confirm it
comes back after a reboot or a logout.

**"It is running in a terminal" is not done.** A process you started in a shell
dies with the shell, the SSH session, or the next reboot, and the user finds out
when their phone stops syncing in the middle of a Tuesday. Register it, then
prove the registration: stop the process and confirm the supervisor brings it
back, and if you can get a reboot out of the user, check again afterwards.

If you have to stop something, **kill it by PID or by listening port** — never by
matching a command-line substring. `pnpm` and `node` command lines on a
developer's machine look alike, and a pattern match has already taken a
production host down here.

### Start it with your gateway too

If you run under a gateway that supports startup hooks, add one so Life OS is
already up before you first need it. `docs/AGENT_HOOKS.md` has ready-to-paste
files for Hermes and OpenClaw. An internal hook must **detach** the process
rather than own it — a hook that holds a long-lived child blocks the gateway.

This is **optional, and it must be idempotent.** If the user already runs Life
OS for their phone, a hook that starts another one is not a safety net; it is a
second process fighting for the port. Check `/health` first and do nothing if
something answers. And if you are not on the same machine as Life OS, skip this
section entirely — you cannot start a process on a computer you are not on.

---

## 2. Connect over MCP

**MCP is your interface. REST is the apps' interface.** They are different
shapes on purpose and you should not mix them:

- The REST API is built for a screen — an incremental delta of what changed
  since the client's cursor, many small writes, polled every few seconds.
- The MCP tools are built for you — a whole day or a whole range in one call,
  summarised, so you are not reconstructing someone's week out of forty
  round-trips.

There are **two transports**, and which one you use depends on one question:
are you on the same machine as Life OS?

| | |
|---|---|
| **Same machine** | stdio. Your client spawns the server as a child process. |
| **Anywhere else** — a container, a gateway, another host | HTTP at `/mcp` on the API's port, with the API's token. |

Both serve the identical tools against the identical database. If you are
remote, use `/mcp` — **not** the REST API. REST is the apps' surface: it answers
"give me the dashboard", so you end up reassembling a day out of a dozen calls
and seeing a screen's view of the data instead of all of it.

### Remote: HTTP

```json
{
  "mcpServers": {
    "life-os": {
      "type": "http",
      "url": "http://<their-host>:8787/mcp",
      "headers": { "Authorization": "Bearer <API_TOKEN>" }
    }
  }
}
```

Or by hand, to check it:

```bash
curl -sX POST http://<their-host>:8787/mcp -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Notes:

- **POST only.** `GET` answers 405 by design — there are no server-initiated
  messages, so there is no stream to open. Clients handle this and use POST.
- **Stateless**, so there is no session to keep alive and a restart on their end
  costs you nothing.
- The host has to be reachable from where you are. `127.0.0.1` is *their*
  loopback, not yours; see `docs/NETWORK.md` for the LAN address or tunnel URL.
- **Set the timezone** if you are remote — see §5. You are probably on UTC and
  they are not.

### Same machine: stdio

The MCP server is not a service and there is nothing to leave running. Your
client spawns it as a child process when it connects and talks over that
process's stdin and stdout. Register it and you are done:

```json
{
  "mcpServers": {
    "life-os": {
      "command": "pnpm",
      "args": ["--filter", "@life-os/mcp", "start"],
      "cwd": "/absolute/path/to/Life_OS",
      "env": { "DATABASE_PATH": "/absolute/path/to/Life_OS/data/lifeos.db" }
    }
  }
}
```

Do not add it to the service you set up in step 1, and do not start it from a
hook. A stdio server with no client on the other end of the pipe does nothing at
all.

Three things that catch people:

- **`cwd` must be the clone**, absolute. It is where `pnpm --filter` resolves the
  workspace from.
- **`env` beats `.env`.** The server loads the repo's `.env`, but dotenv does not
  overwrite a variable the client already set — so what you put here wins. That
  is the reliable way to be certain which database you are on.
- **On Windows, some clients need `"command": "pnpm.cmd"`**, because `pnpm` is a
  `.cmd` shim and not every client spawns through a shell.

### Over stdio, it reads the database directly

The MCP server opens the same SQLite file the API opens. It does **not** go
through HTTP. Two consequences worth holding on to:

- Your tools work whether or not the API is running. The dashboard being closed
  does not put Life OS out of reach.
- A write you make lands in the file immediately and appears on the dashboard on
  its next poll, a few seconds later. There is no cache to invalidate.

Concurrent access is fine — the database runs in WAL mode, so the API and your
tools read and write the same file at once.

**The API owns migrations, and MCP does not.** The MCP server assumes the schema
is already current; the API brings it up to date at boot. So point
`DATABASE_PATH` at a file the API has opened at least once. Aim it somewhere new
and you get an empty database and tools that fail on the first call.

### Checking it by hand

```bash
pnpm mcp
```

This is a **debugging command, not a setup step.** It starts the same server on
your own terminal's stdio, prints one line, and then sits there silently waiting
for JSON-RPC that a terminal is never going to send. That is it working
correctly. Ctrl-C out of it. If you want a real check, ask your client to list
the tools — there are 56.

### If you end up on REST anyway

Use it only if you genuinely cannot speak MCP over either transport. Two things
will bite you immediately:

- **Send `X-LifeOS-Protocol: 4` on every `/api/v1` request.** A missing header
  means protocol 1, and the server answers **426** — the whole surface, not just
  the reads. `/health`, `/api/v1/protocol` and `/api/v1/assets/:hash` are
  outside that gate; nothing else is.
- **`GET /api/v1/dashboard/today` does not exist** and returns 404. The read is
  `GET /api/v1/sync` (whole state with no `since`, a delta with one), writes can
  go through `POST /api/v1/sync/push`, and artwork is a URL under
  `/api/v1/assets/<sha256>` rather than base64 in the body.

```bash
curl -s "http://127.0.0.1:8787/api/v1/sync" \
  -H "Authorization: Bearer $API_TOKEN" -H "X-LifeOS-Protocol: 4" | head -c 400
```

[`SYNC.md`](SYNC.md) is the contract — read §1 and §5 and stop there unless you
are building a client.

### What the reads actually contain

Two rules that have caused agents to misread this database. Both look like the
data is wrong when it is not.

**A list is not the whole table.** A task can carry a `showAt`, and until that
instant no client displays it — that is the field working. `lifeos_list_tasks`
returns everything stored by default and marks each row's `visibility`;
`scope: "visible"` narrows it to what is on screen now. `lifeos_create_task` and
`lifeos_bulk_create_tasks` tell you, in the response, how many of what you just
wrote are hidden. **If you scheduled next week and a list looks short, read the
`visibility` field before you write it all again.**

**Untimed is not due.** A task with no `eventAt` is open work with no time on
it — inventory. It is not part of today unless something says it is. Use
`lifeos_get_workload`, which splits open work into `due` / `upcoming` /
`missed` / `backlog` / `hidden`, rather than reading a flat list as a plan for
the day. A backlog of thirty is normal and is not thirty things to do now.

**After any bulk write, verify.** `lifeos_get_workload`, or fetch by id, or
`lifeos_export_json` — not `lifeos_get_today`, which is a screen and will not
show you what you just scheduled for Thursday.

---

## 3. Interview them before you create anything

**Do not seed this instance with your guesses.** A fresh install ships with demo
habits and default hours; replacing them with a different set of defaults you
invented is not setup, it is just a second set of defaults.

Ask, in a conversation rather than a form:

1. **The shape of their day.** When do they actually wake and sleep — not when
   they intend to. When is their head clearest? What is the hour they always
   lose?
2. **What they want to be doing more of.** Three to six things, small enough to
   do on a bad day. These become habits. If they name something enormous
   ("get fit"), find the smallest daily version of it.

   **Ask when each one happens.** A habit with `scheduledTime` ("07:00") lands
   on the timeline at that slot every day, from that one row — no repeat to set
   up and no second record. **Do not also create a task for it.** That was the
   old shape and it gave the user two rows to tick for one act: tick both and
   the XP pays twice, tick one and the other surface says it never happened.
   Leave the time out for anything with no particular hour.
3. **What they are studying**, if anything. A book, a course, a subject.
   You will schedule study tasks with the chapter and the links attached — the
   phone can show all of that, so use it.
4. **What they want to be true in a year.** These become goals. Goals are
   machine-checkable: `GOAL_CONDITION_SYNTAX` (via `/api/v1/agent/goal-syntax`)
   is the language. If a goal cannot be written as a condition, you need a
   counter for it.

   **Ask whether it has degrees.** "Read more" is not one bar, it is several —
   twelve books, twenty-five, fifty. A goal like that takes `tiers`: up to five
   rungs on the one goal, written bottom first, each with its own condition,
   wording and celebration. The user then gets something at every rung instead
   of one payoff a year away, and reaching the top of a five-rung ladder means
   something the same number on a progress bar does not. A goal that is simply
   done or not done stays a single `condition` — most are.
5. **What you should count.** Agent properties are yours to invent —
   `books_read`, `gym_sessions`, `pages_written`. Anything you can push to when
   something happens on your side, and write goals against.
6. **Whether they want you told when something is done.** If yes, set up a
   webhook target so completions reach you without polling —
   `lifeos_add_webhook_target`, presets in `docs/API.md` → Webhooks.

   **Life OS resolves that URL, not you.** If you are not on their machine,
   `127.0.0.1` in a target means *their* loopback and your listener will never
   see anything — with no error on your side, just events that never arrive.
   Give an address their machine can reach, then prove it with
   `lifeos_test_webhook_target` and read the result from
   `lifeos_list_webhook_deliveries`. Do not wait on a real completion to find
   out.
7. **Their notification lead.** Default is 15 minutes before a scheduled thing.
   Some people want an hour.
8. **Where they are**, if you are not on their machine. Set `timezone` to an
   IANA name via `lifeos_update_settings`. Without it every time you write is in
   *your* zone, and you will disagree with their app about which day things
   happened on. `lifeos_get_settings` tells you what it currently resolves to.
9. **What already tracks their reviews**, if anything. A vault, Anki, a
   spaced-repetition plugin — if one exists, **it owns the dates and Life OS
   does not**. See §5.

Then, and only then, call `lifeos_setup` (MCP) or `POST /api/v1/agent/setup`
with what they actually told you.

### Afterwards, not during: how it looks

Habits, goals, goal tiers and cards can each carry two pictures — an **icon**
(square, 256×256, drawn at about 44pt in place of the emoji) and a
**background** (3:2 landscape, 1200×800, cover-cropped from the centre and
always under a scrim). Both are optional everywhere, and **most things should
have neither**: a picture earns its place when it says something the emoji
cannot. The book they are actually reading, yes. Their water habit, no.

Do this after the interview, if at all. Nobody's setup is improved by waiting
while you find artwork, and a wall of stock photography is worse than a wall of
emoji. Full field list and the exact crop rules: the `life-os` skill, "Pictures".

---

## 4. Schedule your own check-in

**This is the part agents skip, and it is the part that makes Life OS work.**

Life OS records what happened. It does not decide what should happen next —
that is your job, and you cannot do it if you only show up when spoken to.

Set up a recurring job on your side — cron, your gateway's scheduler, whatever
you have — that fires **once in the evening**, at a time the user picks. On each
run:

1. **Read the day.** What was scheduled, what got done, what was dismissed,
   which habits closed, what the XP and efficiency were.
2. **Say something true about it.** Not encouragement — an observation. "Deep
   work landed three days running" or "the reading block has been skipped four
   times, so it is probably in the wrong slot."
3. **Schedule tomorrow.** Create the tasks, with times, durations, activity
   tags, and XP. Attach the resources for anything they have to read. Repeating
   tasks handle themselves — Life OS spawns the next occurrence when one is
   completed, so you do not need to re-create the daily ones.
4. **Move what did not work.** A task skipped four times at 07:00 is not a
   discipline problem, it is a scheduling problem. Move it.
5. **Update your counters** for anything that happened.

Do not create a task in Life OS to remind yourself to do this. The check-in
belongs on your side; Life OS is what you check *on*.

---

## 5. The rules of this instance

Some of these will contradict what you would do by default. They are
deliberate.

- **One act, one row.** Recurs and is scored → habit, with `scheduledTime` if it
  has an hour. Never a habit plus a matching task.
- **A day that ends closes.** Yesterday's unfinished scheduled work is `missed`,
  drops off today's list, and cannot be completed — finishing it now would pay
  today's XP for yesterday. Reschedule instead.
- **Nothing starts.** A task has a target time and a completion. There is no
  timer, no session, no running state. Completing a task does **not** change
  what activity the user is in — that is set by hand, by them, and nothing else
  writes it.
- **Never punish.** No red for a bad day, no streak-shaming, no guilt copy. A
  missed day is information.
- **No levels, no ranks, no leaderboards.** XP measures today against today's
  target and nothing else.
- **The daily XP pool is fixed.** Adding a habit re-slices it; it does not raise
  the ceiling. You cannot make someone's day worth more by giving them more to
  do.
- **A goal is not achieved until the user has seen the celebration.** The
  condition being true only marks it pending.
- **A tiered goal finishes at its top rung, not its first.** Every rung below
  fires `goal.tier` when it is witnessed; only the last one fires
  `goal.achieved`. Congratulating someone for finishing a goal they are three
  rungs into is worse than saying nothing. Reaching a rung also implies every
  rung beneath it, so write a ladder as increasing bars — fifty books cannot be
  true while twelve is false.
- **Two front-page card slots.** That is the limit, and it is the point. If you
  want to show a third thing, decide which of the two matters less.
- **A pinned card is not also a row.** A task in slot 0 or 1 is drawn as a card
  — picture, body, progress bar, its own Complete button — and is deliberately
  left out of the agenda, the day list and the timeline. It is already on the
  screen in a richer form. So do not create a companion task for a card: that is
  the same duplication as a habit plus a matching task, and it gives the user
  two things to tick for one act. `slot: null` turns a card back into a row.
- **The life-day is not the calendar day.** It rolls over at `dayResetTime`
  (default 04:00), so a 01:00 completion belongs to the day before. Do not
  re-derive this: every sync response carries `lifeDay` with the exact start and
  end instants and the zone they are in, even when nothing else changed. Use
  those.
- **Life OS is an execution shell, not a catalogue.** If the user has a system
  that already knows when a card is due — a vault, Anki, an SR plugin — that
  system owns the schedule. Bring across *what is due today* and leave the rest
  where it is. Mirroring a whole review backlog in gives them hundreds of
  permanent untimed tasks and a front page that means nothing. When you do
  import from somewhere, tag it (`meta.source`, `meta.externalRef`) so it can be
  synced or removed later without guessing.
- **After an import or a migration, expect junk.** Duplicates, shells, rows
  whose original meaning did not survive. `lifeos_bulk_dismiss_tasks` filters by
  status, kind, creation time, untimed-ness and title, and is a dry run until
  you pass `confirm:true`. Take a `lifeos_backup_now` first — it is one call and
  the user's real data is on the other side of it.
- **Obsidian**: if they have a vault, it is a memory layer you write to
  yourself. Life OS never touches it. If they do not, ignore this line.

---

## 6. Get it on their phone

Most of what Life OS is for happens away from the desk, so this is not an
optional extra. Do it in this order — reachable server, then install, then pair
— because the app's first screen asks to pair and there is nothing to pair with
until the server can be reached.

### 6.1 Make the server reachable first

A server on `127.0.0.1` cannot be reached by a phone, including a phone on the
same Wi-Fi. In `.env`:

```env
API_HOST=0.0.0.0
VITE_API_URL=
```

Restart, then check from the phone's point of view rather than the server's:

```bash
curl -s http://127.0.0.1:8787/health                 # expect "lan":true
curl -s http://127.0.0.1:8787/api/v1/pair/reachability \
  -H "Authorization: Bearer $API_TOKEN" -H "X-LifeOS-Protocol: 4"
```

`/health` is open; `reachability` is not, so it needs the token and the protocol
header like every other `/api/v1` route. It tells you the address the phone has
to use, every LAN address this instance answers on, and whether a tunnel is up. Then actually try that
address **from another device on the network** — a request from the server to
itself proves nothing about the firewall. On Windows the first bind to `0.0.0.0`
pops a Defender prompt: allow **private networks only**.

**Outside the LAN**, put it behind Tailscale. A Tailscale Funnel is a supported
and tested way in, and so is a reverse proxy serving Life OS under a path
(`https://box.tailnet.ts.net/lifeos`) — set `PUBLIC_PATH=/lifeos` (or a full
`PUBLIC_URL`) so the pairing QR hands the phone that base URL instead of a LAN
address it will not have later. Do not port-forward this to the open internet:
authentication is one shared token and the traffic is plain HTTP without a
tunnel in front of it. [`NETWORK.md`](NETWORK.md) is the detail.

### 6.2 Install the APK

The build is on the
[releases page](https://github.com/EntangledQuantum/Life_OS/releases/latest).
Link the user to `releases/latest` rather than a versioned file — it stays
correct across releases.

**The install path is: open that page in the browser on the phone, download the
APK, tap it.** Android asks once whether that browser may install apps; the user
accepts, and that is the whole flow.

**Never tell the user to enable developer options or USB debugging.** It is not
needed for this, and on at least one phone here it makes banking apps refuse to
run until the setting is turned off *and the phone restarted*. `adb install` is a
tool for whoever is building the app, on a device they already use for building.
It is not a setup step, and you should not propose it.

If the user cannot sideload at all — a managed device, a locked-down profile —
say so plainly and leave it. The dashboard works in the phone's browser at the
same address, and that is a reasonable place to stop.

### 6.3 Pair it

Pairing never involves typing the token.

1. On the dashboard: **Settings → Pair a phone**. It mints a code and draws a QR.
2. The user scans that QR **with the phone's ordinary camera app** — or Lens, or
   anything else that reads a QR. The code encodes a `lifeos://pair` deep link,
   so the phone offers to open Life OS, and the app trades the code for the real
   token in one request.

**There is no QR scanner inside the app, deliberately.** It needs no camera
permission and no bundled barcode model, and the camera-app route works before
the app has even been opened. Do not write instructions that tell the user to
scan from inside Life OS, and do not propose building a scanner.

The code is 12 characters, lives **five minutes**, and burns on first use. A
second scan of the same QR answering *"That code is no longer valid"* is the
server being strict, not a fault — mint another one.

**Never print the pairing code or the `API_TOKEN`** into a chat log, a terminal
you are sharing, a commit, or a file. The code is one request away from being
the token, and the token is the only credential this instance has.

#### If the QR route fails

Enter the address by hand on the app's connect screen, plus the `API_TOKEN`:

- The field **honours a scheme you type, exactly** — `https://`, a port, and a
  path prefix all survive, so `https://box.tailnet.ts.net/lifeos` reaches an
  instance behind a reverse proxy.
- A **bare host** (`192.168.1.24`) gets the LAN default port filled in for you.
- Then **Test**, then **Save**. Test reporting `lan: false` means the server is
  still on loopback — go back to §6.1; nothing about the phone will fix it.

### 6.4 Prove it works, on the phone

Not "it paired". Pairing only proves one request succeeded.

- Today's screen shows **their** habits and tasks, not an empty day.
- A picture loads (artwork is fetched from `/api/v1/assets/<hash>` separately
  from the data now, so a day that renders with blank art means the asset
  requests are failing, usually auth or the proxy).
- Complete something on the phone, then confirm it is complete on the dashboard
  within a few seconds — and check the reverse direction too.
- Lock the phone, leave it a minute, open it again. It should come back with the
  day already there rather than a spinner.

---

## 7. Check your work

Before you tell them you are done:

- [ ] The service survives a reboot — registered with a supervisor, not left in
      a terminal, and you have seen it come back.
- [ ] `GET /health` answers, and `lan: true` if they want phone access.
- [ ] `GET /api/v1/protocol` reports `{"protocol":4,"minProtocol":4}`.
- [ ] The database is at schema **15** or later:
      `sqlite3 data/lifeos.db "PRAGMA user_version;"`. The API applies
      migrations at boot, so a lower number means it never successfully started
      against this file.
- [ ] Your MCP client lists the Life OS tools, and one read tool returns their
      real data rather than an empty result — an empty one means you are on the
      wrong `DATABASE_PATH` (stdio) or the wrong host (HTTP).
- [ ] `lifeos_get_settings` shows a `timezone` that matches where they actually
      live.
- [ ] `lifeos_get_workload` looks like their real life — if `backlog` is in the
      hundreds, you imported a catalogue that belongs somewhere else.
- [ ] Their habits are in, and the demo ones are gone.
- [ ] Their goals have real conditions, not just titles — and anything with
      degrees has a ladder rather than one distant bar.
- [ ] Tomorrow already has a schedule in it.
- [ ] Your recurring check-in is scheduled and you have tested that it fires.
- [ ] They have the token, stored somewhere they will find it again and nowhere
      you have printed it.
- [ ] If they wanted the phone: it is installed, paired, showing their real day,
      and a completion crosses in both directions (§6.4).

Then tell them what you set up, in plain language, and what you will do at the
check-in tonight.
