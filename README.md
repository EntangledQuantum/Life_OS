<div align="center">

<img src="docs/icon.png" alt="" width="112" />

# Life OS

### Let AI agent manage your **life** · **habits** · **health** · **study** · **goals** · **sleep**

Your agent designs the system and keeps it up to date. You just tap to complete.

[**🌐 Website**](https://entangledquantum.github.io/Life_OS/) &nbsp;·&nbsp;
[**📱 Android app**](https://github.com/EntangledQuantum/Life_OS/releases) &nbsp;·&nbsp;
[**📖 Docs**](docs/)

<sub>Runs on your machine · no account · Node 22.5+ · SQLite · MIT</sub>

</div>

<br />

![The Life OS dashboard](docs/screenshots/dashboard.png?v=2)

<p align="center">
  <img src="docs/screenshots/mobile-1.jpeg" alt="Life OS mobile — overview" width="270" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-2.jpeg" alt="Life OS mobile — day and habits" width="270" />
</p>

<br />

## Set it up

Paste this at any agent that can read a URL and run commands:

```
Fetch https://raw.githubusercontent.com/EntangledQuantum/Life_OS/master/docs/AGENT_SETUP.md and set Life OS up for me
```

It will install it, run it as a service, connect over MCP, interview you about
your actual day, and schedule its own nightly check-in. Prefer to do it
yourself? [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md) is readable by humans
too, and `pnpm setup && pnpm dev` is the short version.

<br />

## What it is, and why you'd want it

Most habit apps assume the hard part is *doing* the thing. For a lot of people
it isn't. The hard part is **designing and maintaining the system** — deciding
what to track, noticing a habit has quietly died, re-slicing the day when
something stops working, remembering to review any of it. That is the part that
collapses first, and once it does, the app becomes another thing you're failing
at.

So Life OS splits the job in two:

- **You do the doing.** Tap to complete. That is the entire interface.
- **Your agent does the designing.** It creates the habits, schedules the day,
  writes the goals, watches what actually happened, and adjusts.

Everything lives in one SQLite file on your own machine. There is no account,
no cloud, no sync, and no way for anyone to see your data — including us.

Two nouns, and that's the whole model:

- **Habits** — recur, scored daily.
- **Tasks** — everything else: scheduled work, reminders, reviews, study
  blocks, the cards on your front page. One kind of thing with optional parts.

A few deliberate refusals: no levels, no ranks, no leaderboards, no streak
guilt, and nothing on the screen ever turns red because you had a bad day.
XP measures today against today's target and nothing else.

<br />

## What it looks like in use

**Your agent notices a pattern.**
> "You've skipped the 07:00 reading block four days running. Moving it to 21:30
> — you finished it every time it was there last month."

**You're studying something.**
Your agent schedules a study task with the chapter, the instructions, and links
to the PDF and a video. All of it shows up on your phone at the right time. You
read it, you tap done, the minutes are recorded.

**Something happens on the agent's side.**
It finishes processing a book you read, increments `books_read`, and the goal
you set in January — *read 20 books* — ticks forward on its own. When it
completes, the dashboard plays the celebration. The goal isn't finished until
you've seen it.

**You want to be told when something is done.**
Your agent subscribes to a webhook and hears about every completion the moment
it happens, instead of asking every five minutes.

<br />

## Contributing

Issues and PRs welcome. It is a pnpm workspace: `apps/api` (Hono),
`apps/web` (React), `packages/{db,shared,mcp}`, and `mobile-frontend/app`
(Expo), which is deliberately isolated and must not import from the monorepo.

```bash
pnpm install
pnpm setup      # .env, database, seed data
pnpm dev        # api + web
pnpm test       # every package
pnpm typecheck
```

Before opening a PR: `pnpm typecheck && pnpm test`, and `npx tsc --noEmit` in
`mobile-frontend/app` if you touched the app. Database changes go in
`packages/db/src/migrations.ts` as a **new numbered migration** — never edit a
shipped one.

Full docs, the API reference and the agent skill are on the
[website](https://entangledquantum.github.io/Life_OS/) and under
[`docs/`](docs/).

<br />

## License

MIT — do what you like with it.

<div align="center">
<br />
<sub>Built for a brain that does the work but hates maintaining the system.</sub>
</div>
