# stratus-api

Cloud gaming backend for [RaccoonGame](https://www.raccoongame.com). Handles account creation, the session pool, WebRTC signalling proxy, and queue management. Used in production by [cherri](https://cherri.gg).

## what's in here

- **`api/core.cjs`** — transport-agnostic core module. Exports all session logic; your HTTP/WebSocket layer calls into it.
- **`api/public/`** — static assets served by the cloud gaming embed.
- **`api/api.js`** — older standalone server (kept for reference; `core.cjs` supersedes it).
- **`core.test.ts`** — pool retry behaviour test (`bun test`).

## how it works

`core.cjs` maintains an account pool (`POOL_TARGET = 25`). At startup and whenever an account is consumed, it:

1. Calls **malq** (`http://127.0.0.1:4400`) to get a disposable email address.
2. Sends a registration email via RaccoonGame's `/users/sendEmail`.
3. Polls the malq inbox for the 6-digit verification code.
4. Registers and logs in, storing the `as_user_token` cookie.

When a user starts a game the pool hands over a ready token immediately. If the pool is empty the same flow runs on-demand.

## dependencies

- **malq** running on `127.0.0.1:4400` — self-hosted disposable mail service (see below).
- **`ws`** — WebSocket client for the RaccoonGame signalling relay.

```
bun add ws
```

## setting up malq

malq is a self-hosted disposable mail service that stratus uses to receive RaccoonGame's verification emails. It ships with ~40 provider backends and picks one at random per account creation.

**Get the source**

malq lives in [cherri-v3](https://github.com/genericness/cherri-v3) at `services/malq/`. Clone that repo and work from `services/malq/`.

**Install and run**

```sh
cd services/malq
bun install
bun src/main.ts        # binds to 127.0.0.1:4400
```

Or with pm2 (recommended for production):

```sh
pm2 start bun --name malq -- src/main.ts
pm2 save
```

> **Do not use pm2's ecosystem `env` block to set `MALQ_ONLY_PROVIDER`** unless you deliberately want to pin to one provider — it silently overrides the full provider pool.

**Check which providers are working**

`providerCheck` tests every provider's API reachability from your host:

```sh
bun tests/providerCheck.ts
bun tests/providerCheck.ts --write   # updates src/working-providers.ts
```

`raccoonCheck` tests which providers RaccoonGame actually accepts (some domains are blocklisted):

```sh
bun tests/raccoonCheck.ts
bun tests/raccoonCheck.ts --write   # removes blocked providers from the list
```

Run both after deploying to a new host — provider reachability varies by network, and Raccoon's blocklist changes over time. The `--write` flag updates `src/working-providers.ts`, which malq reads at startup to decide which providers to load.

**Custom domain (optional but reliable)**

If you control a domain, you can add it as a provider and it will never be blocked. Add a `src/providers/impl/yourdomain.com.ts` using `src/providers/impl/cherrion.top.ts` as a template, set up Cloudflare Email Workers to relay inbound mail to malq's `/api/v1/inbound` endpoint, and add your domain to `src/working-providers.ts`.

## integrating into your server

```js
const stratus = require('./api/core.cjs');

// create a session (pulls from pool or creates on-demand)
const { sn, token } = await stratus.createAccount();

// start a game
const result = await stratus.doInitGame({ sn, token, game_key: 'xxx' });

// connect signalling (pass the active WebSocket from your HTTP upgrade handler)
session.clientWs = ws;
stratus.connectRaccoonSignaling(session);
```

See `api/core.cjs` exports at the bottom of the file for the full surface.

## limits (constants in core.cjs)

| constant | default | meaning |
|---|---|---|
| `POOL_TARGET` | 25 | accounts to pre-create |
| `MAX_SESSION_SECONDS` | 1200 | max game length |
| `MAX_CONCURRENT_SESSIONS` | 25 | hard cap |
| `ACCOUNT_CREATE_TIMEOUT_MS` | 90000 | per-account budget |
| `VERIFY_TIMEOUT_MS` | 60000 | email verification window |

## credits

- x8rr
- technonyte
- clawd cod (the sexiest cli in the history of earth and agentic generative ai)
- chatgpt (i mean it's alright)
- gemini (go fuck yourself)
