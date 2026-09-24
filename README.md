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

- **malq** running on `127.0.0.1:4400` — self-hosted disposable mail service, see [`services/malq/`](../cherri-v3/services/malq/).
- **`ws`** — WebSocket client for the RaccoonGame signalling relay.

```
npm install ws
# or
bun add ws
```

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
