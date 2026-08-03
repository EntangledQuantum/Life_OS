# Running Life OS on your network

By default Life OS binds to `127.0.0.1` — only the machine it runs on can reach
it. That is the right default for a single-user local app, and it is what a
fresh clone gets.

If you want to open the dashboard on your phone, or point a future native client
at it, you need it reachable from the rest of your Wi-Fi.

---

## Turning it on

In `.env`:

```env
API_HOST=0.0.0.0
VITE_API_URL=
```

Then restart:

```bash
pnpm dev
```

The API prints the addresses it is reachable on:

```
Life OS API listening on http://0.0.0.0:8787 (storage=local)
  reachable on your network at http://192.168.1.24:8787
  ⚠ anyone on this network can reach the API — keep API_TOKEN secret and
    do not port-forward this to the internet
```

On your phone, open **`http://192.168.1.24:5173`** (that address, your web
port). Log in with the same `ADMIN_USER` / `ADMIN_PASS`.

To go back to local-only, set `API_HOST=127.0.0.1` and, if you want the web
server on loopback too, `WEB_HOST=localhost`.

---

## Why `VITE_API_URL` must stay empty

The web dev server proxies `/api` to the API on **the same origin it was loaded
from**. So a phone loading `http://192.168.1.24:5173` sends its API calls to
`http://192.168.1.24:5173/api`, which is proxied through.

If you hard-code `VITE_API_URL=http://127.0.0.1:8787`, the phone tries to reach
*its own* loopback address and everything fails with a connection error that
looks like the server is down. Leave it empty.

---

## CORS

You do not need to configure anything for a home network. The API accepts any
origin whose hostname is loopback or a private address, on any port:

| Allowed automatically |
|:--|
| `localhost`, `*.localhost`, `127.x.x.x`, `::1` |
| `10.x.x.x` · `172.16–31.x.x` · `192.168.x.x` |
| `169.254.x.x` (link-local) and IPv6 `fe80::` / `fc00::` |
| `*.local` (mDNS names like `macbook.local`) |

Anything public has to be named explicitly:

```env
CORS_ORIGINS=https://lifeos.example.com,https://tunnel.example.dev
```

This is deliberately not a wildcard. An open CORS policy would let any web page
you happen to have open in another tab talk to your Life OS instance.

---

## What you are actually exposing

Be clear-eyed about this before you turn it on.

- **Authentication is a single shared secret.** `API_TOKEN` for agents, and a
  mock `ADMIN_USER` / `ADMIN_PASS` login for the browser. There are no user
  accounts, no rate limiting, and no lockout.
- **Anyone on the same network can reach it.** On your own Wi-Fi that means your
  own devices. On a café or office network it means everyone there.
- **Nothing is encrypted.** It is plain HTTP; the token crosses the network in
  the clear.

That is fine for a home LAN and not fine for anything else.

**Do not port-forward this, put it in a DMZ, or expose it through a public
tunnel.** If you genuinely need remote access, put it behind a VPN such as
Tailscale or WireGuard — those give you an encrypted private network where the
existing model is still appropriate. Real multi-user authentication is on the
roadmap and is not built yet.

---

## Firewall

The first time you bind to `0.0.0.0`, Windows will pop up a Defender prompt.
Allow **private networks** only — never public.

macOS may ask the same thing on first launch. Linux with `ufw`:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 8787 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 5173 proto tcp
```

---

## Checking it works

From the phone or another machine:

```bash
curl -s http://192.168.1.24:8787/health
# {"ok":true,"service":"life-os-api","storage":"local","host":"0.0.0.0","lan":true}
```

`lan: true` confirms the API knows it is exposed. If the request times out, it is
almost always the firewall rather than the app.
