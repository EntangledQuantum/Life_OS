# Making Life OS start with your agent

Life OS is a local server. If it is not running, your agent cannot read the
user's day, and the user's phone shows "can't reach the server". The fix is a
hook: the agent's gateway starts Life OS when *it* starts.

Two supported gateways, and a fallback that works anywhere.

Everything below is generated for you by the setup flow — this file is the
reference for what it wrote and why.

---

## OpenClaw

OpenClaw has two separate things both called hooks, and they solve different
problems. You want **both**, for different reasons.

### 1. Internal hook — start Life OS when the gateway starts

Internal hooks run inside the Gateway when agent events fire. A `gateway_start`
hook is the right place to bring a dependency up.

Note the constraint from the OpenClaw docs: *internal hook handlers must not own
long-lived timers, watchers, sockets, or clients.* So the hook does not run the
server in-process — it spawns a detached one and returns immediately.

`~/.openclaw/hooks/lifeos/HOOK.md`:

```md
---
name: lifeos-start
events: [gateway_start]
---

Start the Life OS server if it is not already listening.
```

`~/.openclaw/hooks/lifeos/hook.sh`:

```bash
#!/usr/bin/env bash
# Idempotent: if something already answers on the port, do nothing.
if curl -s --max-time 2 http://127.0.0.1:8787/health > /dev/null; then
  exit 0
fi
cd "$LIFEOS_DIR" || exit 0
# Detached, so the gateway hook returns immediately and owns nothing.
nohup pnpm dev > "$LIFEOS_DIR/data/server.log" 2>&1 &
exit 0
```

The Gateway only loads internal hooks once hooks are enabled or at least one
hook entry exists, so add this to `~/.openclaw/config.json5`:

```json5
{
  hooks: {
    enabled: true,
  },
}
```

Check it was picked up with `openclaw hooks list` — standalone hooks and
plugin-managed ones (shown as `plugin:<id>`) both appear there.

### 2. Webhook — let Life OS tell you about completions

This is the other direction: Life OS calling *into* OpenClaw when the user
finishes something.

```json5
{
  hooks: {
    enabled: true,
    token: "a-long-random-string",
    path: "/hooks",
  },
}
```

Then register the target from your agent:

```
lifeos_add_webhook_target
  name: "OpenClaw"
  url: "http://127.0.0.1:18789/hooks/wake"
  preset: "openclaw"
  secret: "<the same hooks.token>"
```

Life OS sends `Authorization: Bearer <token>` — query-string tokens are
rejected by OpenClaw, so the secret never appears in a URL. The body is
`{ text, mode: "now", lifeos: {...} }`: `text` is a readable one-liner, and
`lifeos` carries the structured payload for a `hooks.mappings` transform.

Restrict which agents webhooks can reach with `hooks.allowedAgentIds` if you run
more than one.

---

## Hermes

### 1. Gateway hook — start Life OS with the gateway

Hermes gateway hooks are a directory with two files.

`~/.hermes/hooks/lifeos/HOOK.yaml`:

```yaml
name: lifeos-start
description: Start the Life OS server alongside the gateway
events:
  - gateway:start
```

`~/.hermes/hooks/lifeos/handler.py`:

```python
import os
import subprocess
import urllib.request

LIFEOS_DIR = os.environ.get("LIFEOS_DIR", os.path.expanduser("~/Life_OS"))
HEALTH = "http://127.0.0.1:8787/health"


def handle(event, context):
    """Bring Life OS up if it is not already answering.

    Hook errors are isolated and logged rather than crashing the agent, so a
    failure here degrades to "Life OS is not running" instead of taking the
    gateway down with it.
    """
    try:
        with urllib.request.urlopen(HEALTH, timeout=2):
            return  # already up
    except Exception:
        pass

    subprocess.Popen(
        ["pnpm", "dev"],
        cwd=LIFEOS_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
```

### 2. Inbound webhook — let Life OS tell you about completions

Hermes verifies an HMAC signature and **rejects unsigned requests with 401**, so
a target without a secret can never work. In `~/.hermes/config.yaml`:

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        lifeos:
          secret: "a-long-random-string"
          prompt: |
            Life OS event: {event}
            {__raw__}
```

Then register it:

```
lifeos_add_webhook_target
  name: "Hermes"
  url: "http://127.0.0.1:8644/webhooks/lifeos"
  preset: "hermes"
  secret: "<the same route secret>"
```

Life OS uses the **generic V2** scheme: `X-Webhook-Signature-V2` is
`HMAC-SHA256(secret, "<timestamp>.<body>")` in hex, with `X-Webhook-Timestamp`
alongside in **seconds**. Hermes rejects a timestamp more than 300 seconds from
its own clock, which is what stops a captured request being replayed later — the
older V1 scheme signs the body alone and has no such protection.

Deliveries also carry `X-Request-ID`; Hermes deduplicates on it for an hour, so
Life OS retrying a request that actually got through does not double-count.

Set `deliver` on the route if you want the agent's reply to land somewhere:

```yaml
          deliver: "telegram"
          deliver_extra:
            chat_id: "-100123456789"
```

---

## Anything else

Any agent that can run a shell command on startup can do the same thing:

```bash
curl -s --max-time 2 http://127.0.0.1:8787/health || (cd "$LIFEOS_DIR" && nohup pnpm dev &)
```

And any agent that can receive an HTTP POST can use `preset: "generic"`, which
sends the payload with an `X-LifeOS-Secret` header and no signing.

---

## Checking it works

```bash
# Is the server up?
curl -s http://127.0.0.1:8787/health

# Did my webhook actually arrive?
#   lifeos_test_webhook_target   → sends a throwaway event now
#   lifeos_list_webhook_deliveries → status and error for recent attempts
```

A delivery that has been failing for a week and one that was never configured
used to look identical. They do not any more — `lifeos_list_webhook_deliveries`
shows the attempt count, the HTTP status, and the error.
