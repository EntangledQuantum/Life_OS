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

---

## 2. Connect over MCP

**MCP is your interface. REST is the apps' interface.** They are different
shapes on purpose and you should not mix them:

- The REST API is built for a screen — one big dashboard payload, many small
  writes, polled every few seconds.
- The MCP tools are built for you — a whole day or a whole range in one call,
  summarised, so you are not reconstructing someone's week out of forty
  round-trips.

Start the MCP server:

```bash
pnpm mcp
```

Then register it with your client. For stdio:

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

Use the REST API only if you genuinely cannot speak MCP.

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
   webhook target so completions reach you without polling. See
   `docs/API.md` → Webhooks.
7. **Their notification lead.** Default is 15 minutes before a scheduled thing.
   Some people want an hour.

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
  (default 04:00), so a 01:00 completion belongs to the day before.
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
- [ ] Their habits are in, and the demo ones are gone.
- [ ] Their goals have real conditions, not just titles.
- [ ] Tomorrow already has a schedule in it.
- [ ] Your recurring check-in is scheduled and you have tested that it fires.
- [ ] They have the token, and the app is connected if they wanted it.

Then tell them what you set up, in plain language, and what you will do at the
check-in tonight.
