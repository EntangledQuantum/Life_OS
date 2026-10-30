# Upgrading Life OS to 3.0

**You are an agent, and this file is addressed to you.** The person who sent you
here is already running Life OS and wants to be running 3.0 by the time you are
finished — server, your own hooks, and the app on their phone. Do the whole
thing. An upgrade left half done is worse than one not started, because the half
that is done is the half that stops their phone working.

If they have **no** Life OS yet, this is the wrong file: read
[`AGENT_SETUP.md`](AGENT_SETUP.md) instead.

---

## Read this before you touch anything

**The moment you upgrade the server, the app on their phone stops working.** Not
degrades — stops. A 3.0 server speaks protocol 4 and refuses protocol 3
outright: every `/api/v1` route answers **426** with a download link in the body,
and there is no compatibility layer by design. Their phone will show an error,
not a stale day.

So the order is not optional:

1. Find out what they have (§1).
2. Back up (§2).
3. **Get the APK onto the phone first, before the server moves** (§3).
4. Upgrade and restart the server (§4), confirm the migration (§5).
5. Reload the dashboard (§6).
6. Install the app, which is already downloaded and waiting (§7).
7. Update your hooks (§8), then verify the whole thing (§9).

Done in that order the phone is dead for about a minute. Done in the obvious
order — upgrade the server, then go looking for an APK — it is dead for as long
as it takes you to find out that is why.

**Tell the user this before you start**, in one sentence: *"Your phone app will
stop working the moment the server updates, so download the new APK first; it
installs straight over the old one and you will not have to pair again."* Then
do it.

### What they are getting, in one line

An unchanged poll went from 2.26 MB to 314 bytes — or nothing at all — and the
app no longer crashes on launch once they have accumulated enough artwork.

### What does not change

Say these out loud, because a user who has been burned before will assume
otherwise and may talk you into something destructive:

- **The phone does not need to be re-paired.** The signing key is unchanged, so
  the new APK installs over the old one.
- **Nothing on the phone is wiped.** Its database migrates in place from schema
  4 to 5, additively. Queued offline writes survive with their life-day stamps,
  and so does the fire-once reminder set.
- **The server database is not rebuilt.** Migration 15 adds tables; it rewrites
  no rows and deletes no data.
- **The `API_TOKEN` is unchanged**, and so is the dashboard's sign-in.

**Do not uninstall the app, do not clear its data, and do not reset the
database.** None of it is needed, and each one costs the user something real.

---

## 1. Establish what they have, before you change anything

Write the answers down. You will need them in §4 and §9, and if something goes
wrong this is the only record of what "working" looked like.

### Which version is the server on

Both of these are unauthenticated, so you need nothing but the address:

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/api/v1/protocol
```

| What comes back | What it means |
|---|---|
| `{"protocol":4,"minProtocol":4}` | **Already on 3.0.** Stop. There is nothing to upgrade; go to §9 and check it over instead. |
| `{"protocol":3,…}` | A 2.x server. This document. |
| `{"protocol":2,…}` or lower | Older still. This document works — the migrations are cumulative and run in order — but read §5 carefully, because more than one of them will run. |
| `/api/v1/protocol` 404s, `/health` answers | Older than the protocol endpoint. Treat as 2.x or earlier and take the backup in §2 seriously. |
| Nothing answers | The server is not running. Do not conclude it is not installed — find the clone and its database before anything else. |

If their instance is not on `127.0.0.1:8787`, ask. Do not scan ports.

### How it is hosted

You have to know this because §4 ends in "restart it", and the right way to
restart it is whatever is supervising it:

```bash
systemctl --user status lifeos          # Linux
launchctl list | grep -i lifeos         # macOS
```

On **Windows**, check **Service Runner** first — the local production host at
`http://127.0.0.1:4780`. If Life OS is registered there, that is what starts it
and that is what must restart it. Otherwise look for a Scheduled Task or an NSSM
service.

**If nothing is supervising it** — it is running in a terminal somebody opened —
say so, and fix it as part of this upgrade by registering it (see
[`AGENT_SETUP.md`](AGENT_SETUP.md) §1). An upgrade is the natural moment, and an
unsupervised server will be down again the next time the machine reboots.

### Where the database actually is

```bash
grep -E '^(DATABASE_PATH|API_PORT|API_HOST|PUBLIC_PATH|PUBLIC_URL)=' .env
sqlite3 "$DB" "PRAGMA user_version;"     # the schema version you are starting from
```

Do not assume `data/lifeos.db`. `DATABASE_PATH` may point anywhere, and
migrating the wrong file is how you end up with a migrated empty database beside
an untouched real one.

### Whether a phone is paired, and which

Ask. There is no reliable way to tell from the server, and the answer changes
the whole shape of the job: if nothing is paired, §3 and §7 collapse into
"offer them the app", and the 426 window does not matter at all.

If one is paired, find out whether it is on Wi-Fi with the server or reaches it
over a tunnel, because that decides whether the user can download the APK and
pair without being at home.

### Is this the only instance

Ask whether anything else uses this database — a second checkout, a backup job,
an MCP client of their own, another agent. A migration on a file that another
process has open is fine (WAL), but two servers on one database with different
code is not.

---

## 2. Back up, and do not skip this

One call, and the user's real data is on the other side of it:

```
lifeos_backup_now
```

Over REST, on the server that is still running, it is the same thing — snapshots
land in `data/backups/` beside the live database:

```bash
curl -sX POST http://127.0.0.1:8787/api/v1/backups \
  -H "Authorization: Bearer $API_TOKEN" -H "X-LifeOS-Protocol: 3"
```

Send the protocol header the **current** server speaks — 3 on a 2.x server, from
§1. This is the one request in this document you make before the upgrade rather
than after.

Or copy the file yourself — with the server **stopped**, or through SQLite, never
with `cp` while it is running:

```bash
sqlite3 "$DB" ".backup '/path/to/lifeos-pre-3.0.db'"
```

`VACUUM INTO` works too, but **prefer `.backup`**: a `.dump`/restore cycle or a
rebuild can drop the sync triggers, and the server repairs those at boot rather
than noticing they are gone at runtime. Note where you put the backup and tell
the user. Keep it until §9 passes.

---

## 3. Get the APK onto the phone — before the server moves

This is the step that keeps the dead window to a minute, and it is the one
agents do last.

Send the user to
<https://github.com/EntangledQuantum/Life_OS/releases/latest> **in the browser
on their phone** and have them download `life-os.apk`. Use that `releases/latest`
link, not a version-specific one — it stays correct across releases.

Have them **download it and stop there.** Installing now is fine too, but then
the phone is on 3.0 while the server is still on 2.x, and a 3.0 app against a 2.x
server is the same standoff from the other side. Downloaded-and-waiting is the
state you want.

**Never tell the user to enable developer options or USB debugging.** It is not
needed, and on at least one phone here it makes banking apps refuse to run until
the setting is turned off *and the phone restarted*. Downloading the APK in the
phone's browser and tapping it is the install path. `adb` is for whoever builds
the app.

---

## 4. Upgrade the server

```bash
cd /path/to/their/Life_OS
git status                     # stop if it is dirty — ask, do not stash
git pull
pnpm install
```

**Prefer `pnpm install` over `pnpm setup` here.** `setup` is safe — it never
overwrites an existing `.env` or database — but it is written for a fresh
machine and it has a seeding step. `pnpm install` plus the restart below is the
whole upgrade.

Then restart it **the way it is supervised**, as established in §1:

```bash
systemctl --user restart lifeos
```

On Windows with Service Runner, restart the registered app through Service
Runner. If you must stop a process by hand, **find it by listening port and kill
it by PID**:

```bash
ss -ltnp | grep 8787                      # Linux
netstat -ano | findstr :8787              # Windows, then taskkill /PID <pid>
```

**Never kill by matching a command-line substring.** `pkill -f pnpm`,
`pkill -f node`, `Get-Process node | Stop-Process` — every one of these is a
loaded gun on a developer's machine, and one of them has already taken this
user's production host down. Match the port, read the PID, kill that.

**Migrations run automatically at boot.** The API brings the database to the
current schema version when it starts; there is no separate migrate step to
remember. If you want to run it without starting the server, `pnpm db:migrate`
does the same work against `DATABASE_PATH`.

If the server will not start, read the first error rather than restarting it in
a loop. Needs Node 22.5 or newer — an older Node fails inside `node:sqlite` and
the message does not say that is what happened.

---

## 5. Confirm the migration actually ran

Do not assume it. "The server started" and "the schema is current" are different
claims, and the second one is the one the clients depend on.

**Schema version** — migration 15 is the sync migration:

```bash
sqlite3 "$DB" "PRAGMA user_version;"      # expect 15 or higher
```

No `sqlite3` on the machine? Node has one built in, and Life OS already requires
a Node new enough to have it:

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);console.log(d.prepare('PRAGMA user_version').get());" "$DB"
```

**The tables it adds** — all five:

```bash
sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table'
  AND name IN ('sync_state','change_log','sync_docs','sync_clients','assets')
  ORDER BY name;"
```

**The triggers** — this is the one that fails silently. The change cursor is
bumped by SQLite triggers on every write, so a missing trigger means writes stop
being recorded and every client polls forever without ever being told anything
changed:

```bash
sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master
  WHERE type='trigger' AND name LIKE 'sync_%';"   # expect dozens, never 0
```

The server counts these at every boot and recreates them if they are short, so
a zero here means it has not opened this file — which usually means
`DATABASE_PATH` points somewhere else than you think.

**Then prove the cursor moves**, which is worth more than all three checks
above:

```bash
curl -s "http://127.0.0.1:8787/api/v1/sync" \
  -H "Authorization: Bearer $API_TOKEN" -H "X-LifeOS-Protocol: 4" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["protocol"], d["cursor"], d["reset"])'
```

Make any small write — complete and un-complete something, or touch a setting —
read `/api/v1/sync` again, and confirm the cursor has advanced and the changed
row came back. If the cursor never moves, the triggers are not firing and
nothing will ever sync; stop and fix that before you go near the phone.

**If migration 15 did not run**, do not hand-write the tables. Find out why: the
server is probably running against a different file, or it never started. Check
the boot output, check `DATABASE_PATH`, and run `pnpm db:migrate` with the same
environment the server has.

---

## 6. The dashboard

The web client ships with the server, so there is no separate upgrade — but the
browser is holding an old bundle:

- Running under `pnpm dev`: Vite rebuilds on its own. A **hard reload** of the
  tab is enough.
- Running under `pnpm serve` (one port serving both): the dashboard is a build
  artifact. `pnpm serve` rebuilds it; `pnpm serve:nobuild` does not. If you
  restarted with `serve:nobuild`, run `pnpm --filter @life-os/web build` or you
  have upgraded the API and left the old dashboard in front of it.

Then open it and look. The cached sync state is under a version-stamped key, so
a 2.x cache cannot be misread as a 4 one — the dashboard takes one cold sync and
is current. The sign-in token is untouched, so it should not ask for it again.
If it does, that is the token having changed, which this upgrade does not do.

---

## 7. Now get the phone onto 3.0

The APK is already on the phone from §3. Have them tap it.

It **installs over** the existing app: same signing key, same package. No
uninstall, **no re-pair**, nothing to type. If Android offers to replace the app,
that is correct — accept it. If instead it refuses with a signature error, stop
and say so rather than uninstalling to get past it: uninstalling drops the
queued writes and the pairing, and a signature mismatch means the APK is not the
one this document is about.

On first launch:

- Its database migrates **4 → 5 in place**. Queued offline writes keep their
  life-day stamps, and reminders that have already fired do not fire again.
- The first sync is a **cold** one — the whole state once, about 300 KB — and
  then it is on deltas. Nothing is carried across from the old payload on
  purpose: the old body is a protocol 3 shape, and rows built from it would be
  wrong in exactly the ways this release exists to fix.
- The 2.26 MB cached payload file from the old version is deleted on that first
  run.

**If it still shows a connection error**, it is reaching a server that is not
there rather than failing to upgrade. Check in this order: the server is
actually running (§4), `/health` reports `"lan":true`, and the address the app
holds still resolves — a tunnel URL that changed while you were working will
look exactly like a broken upgrade.

**If they do have to re-enter the address**, it honours a typed scheme exactly,
including a port and a path prefix, so `https://box.tailnet.ts.net/lifeos` works
behind a reverse proxy; a bare host gets the LAN default port.

**If pairing is genuinely lost**, pair again from the dashboard: **Settings →
Pair a phone**, and the user scans the QR **with the phone's ordinary camera
app**. There is no scanner inside the app, on purpose. The code is 12
characters, lives five minutes and burns on first use, so a second scan of the
same QR failing is the server being strict — mint another. Never print the code
or the token anywhere.

---

## 8. Update your own hooks

Your gateway's hooks were written against the old server and will mostly still
work, but go and read them rather than assuming:

[`AGENT_HOOKS.md`](AGENT_HOOKS.md) has the current files for **Hermes** and
**OpenClaw**. Re-paste them over what is there and check three things:

- **The start hook is still idempotent.** It must check `/health` and do nothing
  if something answers. A hook that starts a second server now fights the
  supervised one for the port, and the one that loses is sometimes the real one.
- **It still detaches.** An internal hook that owns a long-lived child blocks
  the gateway.
- **Your webhook targets still resolve.** Nothing about webhooks changed in 3.0,
  but this is the moment you find out one has been broken for a month. Prove
  each one with `lifeos_test_webhook_target` and read the result from
  `lifeos_list_webhook_deliveries` — do not wait on a real completion. Remember
  Life OS resolves that URL, not you: a `127.0.0.1` target means *its* loopback.

If any of your own code or prompts call `GET /api/v1/dashboard/today`, that
route is **gone** — it answers 404. Replace it with `GET /api/v1/sync`, and send
`X-LifeOS-Protocol: 4` on every `/api/v1` request or you will get a 426 instead
of an answer. [`SYNC.md`](SYNC.md) §15 is the client migration list if you
maintain a client of your own. If you only use the MCP tools, none of this
touches you: MCP does its own negotiation and is not behind the protocol gate.

And check your **nightly check-in** still runs. It is the part that makes Life
OS work, and an upgrade is a good moment to confirm it fires rather than
assuming it has been firing.

---

## 9. Verify, instead of declaring success

Not "the upgrade completed". These, actually run:

- [ ] `GET /api/v1/protocol` reports `{"protocol":4,"minProtocol":4}`.
- [ ] `PRAGMA user_version` is **15** or higher, and the five sync tables and the
      `sync_%` triggers are there (§5).
- [ ] A write moves the cursor (§5). This is the one that catches a half-applied
      migration.
- [ ] `GET /api/v1/sync` returns their **real** data — their habits, their task
      titles — not an empty state. An empty one means you are on the wrong
      database file, and the real one is still sitting un-migrated.
- [ ] The old read is gone — **404**, and that is the correct answer:

      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' \
        http://127.0.0.1:8787/api/v1/dashboard/today \
        -H "Authorization: Bearer $API_TOKEN" -H "X-LifeOS-Protocol: 4"
      ```

      Send the token and the header. Without them you get 401 or 426, which
      tells you nothing about whether the route exists.
- [ ] The dashboard loads their day in a hard-reloaded tab, and did not ask for
      the token again.
- [ ] The phone shows their real day, with artwork, and did not need re-pairing.
- [ ] A completion on the phone appears on the dashboard within a few seconds,
      **and the reverse**. One direction passing proves half the protocol.
- [ ] Anything the phone had queued offline has landed — ask the user whether
      something they ticked before the upgrade is still ticked.
- [ ] The server comes back on its own: stop it through its supervisor, confirm
      it restarts, and confirm `/api/v1/protocol` answers again.
- [ ] Your hooks and your nightly check-in have been tested, not just edited.
- [ ] The backup from §2 still exists, and the user knows where it is.

Then tell them what changed, in plain language: their phone and dashboard now
ask the server only for what changed, the app will not crash on launch any more,
and they did not have to re-pair anything.

---

## If it goes wrong

**Rolling back is a real option**, and it is cleaner than debugging a half-upgraded
install while the user has no phone:

```bash
cd /path/to/their/Life_OS
git checkout <the commit or tag they were on>
pnpm install
# restart through the supervisor
```

The database is the catch. Migration 15 is **additive** — it adds tables and
triggers and rewrites nothing — so a 2.x server runs fine against a migrated
file and simply ignores the new tables. The schema version stays at 15, which is
harmless going backwards and correct again when they upgrade. So **you usually
do not need the backup**, and you should not restore over a database that has
taken real writes since the upgrade just because the version number looks
unfamiliar.

If you do restore, restore to a **new path** first, point a test instance at it,
and look at it before you move anything on top of the live file.

The phone goes back by installing the older APK from the releases page, same
package, same key, over the top. Its schema stays at 5; a 2.x app does not read
the new tables and re-fetches the old payload shape.

**What not to do when you are stuck:** do not delete the database, do not clear
the app's data, do not uninstall the app, and do not run a destructive migration
to "start clean". Every one of those throws away something the user cannot get
back, and none of them is the answer to a protocol mismatch. Say what you found,
what you tried, and what you need from them.
