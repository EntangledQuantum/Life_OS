# Setting up Life OS

**You are an agent, and this file is addressed to you.** The person who sent you
here wants Life OS installed, running, and shaped around their life. Do the
whole thing — install, connect, interview, configure — and do not stop halfway
to ask whether you should continue.

Life OS is a local-first execution layer for someone who struggles to hold a day
together. It is not a to-do app. It has exactly two nouns:

- **Habits** — things that recur and are scored daily.
- **Tasks** — everything else. Scheduled work, reminders, reviews, study, the
  cards on the front page. One row, with optional parts.

That is the whole model. If you find yourself wanting a third, you want a task
with different fields set.

---

## 1. Install it

**First: is it already running?** If the user has a phone paired or a dashboard
open, it is, and your job here is to connect rather than to install. Try
`GET <their-url>/health`. Installing a second copy gives them two databases and
one of them silently stops being the real one.

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

### Make it start with the machine

Life OS is useless if it is only running when someone remembers to start it. Set
it up as a service **now**, not as a follow-up:

- **Linux (systemd user unit)** — `~/.config/systemd/user/lifeos.service`,
  `WorkingDirectory` at the clone, `ExecStart=/usr/bin/pnpm dev`, then
  `systemctl --user enable --now lifeos` and `loginctl enable-linger $USER` so it
  survives logout.
- **macOS** — a `launchd` plist in `~/Library/LaunchAgents/` with
  `RunAtLoad` true.
- **Windows** — a Scheduled Task at logon, or NSSM if the user wants a real
  service.

Pick the one that matches their machine, write it, enable it, and confirm it
comes back after a reboot or a logout.

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

- The REST API is built for a screen — one big dashboard payload, many small
  writes, polled every few seconds.
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
the tools — there are 55.

Use the REST API only if you genuinely cannot speak MCP over either transport.

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
3. **What they are studying**, if anything. A book, a course, a subject.
   You will schedule study tasks with the chapter and the links attached — the
   phone can show all of that, so use it.
4. **What they want to be true in a year.** These become goals. Goals are
   machine-checkable: `GOAL_CONDITION_SYNTAX` (via `/api/v1/agent/goal-syntax`)
   is the language. If a goal cannot be written as a condition, you need a
   counter for it.
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
- **Two front-page card slots.** That is the limit, and it is the point. If you
  want to show a third thing, decide which of the two matters less.
- **The life-day is not the calendar day.** It rolls over at `dayResetTime`
  (default 04:00), so a 01:00 completion belongs to the day before. Do not
  re-derive this: every day payload carries `lifeDay` with the exact start and
  end instants and the zone they are in. Use those.
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

There is an Android build on the
[releases page](https://github.com/EntangledQuantum/Life_OS/releases). The app
needs the server's URL and the same `API_TOKEN`.

For it to work outside the house the server has to be reachable — see
`docs/NETWORK.md`. Set `API_HOST=0.0.0.0` at minimum so the phone can reach it
over the LAN.

---

## 7. Check your work

Before you tell them you are done:

- [ ] The service survives a reboot.
- [ ] `GET /health` answers, and `lan: true` if they want phone access.
- [ ] Your MCP client lists the Life OS tools, and one read tool returns their
      real data rather than an empty result — an empty one means you are on the
      wrong `DATABASE_PATH` (stdio) or the wrong host (HTTP).
- [ ] `lifeos_get_settings` shows a `timezone` that matches where they actually
      live.
- [ ] `lifeos_get_workload` looks like their real life — if `backlog` is in the
      hundreds, you imported a catalogue that belongs somewhere else.
- [ ] Their habits are in, and the demo ones are gone.
- [ ] Their goals have real conditions, not just titles.
- [ ] Tomorrow already has a schedule in it.
- [ ] Your recurring check-in is scheduled and you have tested that it fires.
- [ ] They have the token, and the app is connected if they wanted it.

Then tell them what you set up, in plain language, and what you will do at the
check-in tonight.
