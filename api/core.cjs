// Transport-agnostic stratus cloud-gaming core (ported from the standalone
// api.js). All session logic lives here; the Fastify routes in
// server/routes/cloud.ts provide HTTP/WebSocket transport on cherri's own port.
//
// This is a single self-hosted instance — the old multi-tenant "sites" /
// api-key model is gone. Sessions are capability-scoped by their unguessable
// uuid, and limits are plain constants below.
const { randomUUID, createDecipheriv } = require("crypto");
const { WebSocket } = require("ws");
const dns = require("dns");

if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

// In some deployment environments Bun/Node's fetch() fails to connect to this
// host directly even though it is reachable — `curl` (and a raw socket to the
// resolved literal address) connects fine. Resolving once and hitting the
// literal address with a Host header routes around whatever is going wrong in
// fetch()'s own resolution/connect path, and is a no-op where plain hostname
// fetch already works.
//
// IPv4 is tried first. The host publishes both A and AAAA now (it was
// AAAA-only when this was written), and a server without an IPv6 route still
// resolves AAAA perfectly well — DNS and reachability are unrelated — then
// hangs on connect until TCP gives up. That is a two-minute stall on a code
// path a user is waiting on, and it looks exactly like the remote being down.
const RACCOON_HOST = "www.raccoongame.com";
const RACCOON_TIMEOUT_MS = 20_000;
let raccoonIpCache = null; // { ip, family, expiresAt }

async function resolveRaccoonIp() {
  if (raccoonIpCache && raccoonIpCache.expiresAt > Date.now())
    return raccoonIpCache;
  for (const family of [4, 6]) {
    try {
      const addrs =
        family === 4
          ? await dns.promises.resolve4(RACCOON_HOST)
          : await dns.promises.resolve6(RACCOON_HOST);
      if (addrs?.length) {
        const ip = addrs[Math.floor(Math.random() * addrs.length)];
        raccoonIpCache = { ip, family, expiresAt: Date.now() + 5 * 60_000 };
        return raccoonIpCache;
      }
    } catch {}
  }
  return null;
}

// Nothing here had a timeout, so a black-holed route held the socket — and the
// session slot behind it — until the OS gave up, which degrades the rest of
// the app rather than just this feature.
async function fetchWithTimeout(url, opts = {}, ms = RACCOON_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// `timeoutMs` lets a caller working against a deadline shorten the per-request
// ceiling; without it the literal-address attempt plus the hostname retry can
// spend 2 × RACCOON_TIMEOUT_MS on a single step.
async function raccoonFetch(pathAndQuery, opts = {}) {
  const { timeoutMs = RACCOON_TIMEOUT_MS, ...rest } = opts;
  const entry = await resolveRaccoonIp();
  if (!entry)
    return fetchWithTimeout(`https://${RACCOON_HOST}${pathAndQuery}`, rest, timeoutMs);
  const authority = entry.family === 6 ? `[${entry.ip}]` : entry.ip;
  try {
    return await fetchWithTimeout(
      `https://${authority}${pathAndQuery}`,
      { ...rest, headers: { ...rest.headers, Host: RACCOON_HOST } },
      timeoutMs,
    );
  } catch {
    // Cached address may be stale or unroutable — fall back to normal hostname
    // resolution once rather than failing the whole request.
    raccoonIpCache = null;
    return fetchWithTimeout(`https://${RACCOON_HOST}${pathAndQuery}`, rest, timeoutMs);
  }
}

// ── malq (self-hosted temp mail, see services/malq) ────────────────────────
const MAIL_HOST = "http://127.0.0.1:4400";
const MAIL_TIMEOUT_MS = 10_000;

// malq answers non-2xx as a JSON `{ error }` body rather than mail.tm's
// text/html, but still 429s if the underlying provider it picked is rate
// limited, so the shape of this wrapper (status + retryAfterMs surfaced to
// callers) carries over unchanged.
async function mailFetch(pathAndQuery, opts = {}, ms = MAIL_TIMEOUT_MS) {
  let res;
  try {
    res = await fetchWithTimeout(`${MAIL_HOST}${pathAndQuery}`, opts, ms);
  } catch (cause) {
    const err = new Error(
      `malq unavailable at ${MAIL_HOST}: ${cause?.message || cause}`,
    );
    err.service = "malq";
    err.cause = cause;
    throw err;
  }
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(
      `malq ${pathAndQuery} → HTTP ${res.status} ${body.slice(0, 160)}`,
    );
    err.status = res.status;
    err.retryAfterMs = (Number(res.headers.get("retry-after")) || 0) * 1000;
    throw err;
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `malq ${pathAndQuery} → non-JSON body: ${body.slice(0, 160)}`,
    );
  }
}

const MAX_SESSION_SECONDS = 20 * 60;
const MAX_CONCURRENT_SESSIONS = 25;
// Native websocket send queues are not represented by Bun's JS heap. Cloud
// signaling messages are small (SDP/candidates), so a peer with more than
// this much unread data is stalled, not merely slow.
const MAX_SIGNAL_BUFFERED_BYTES = 1 * 1024 * 1024;

const sessions = new Map(); // uuid → session
const ipLimits = new Map(); // ip → timestamp[]
const embedIpLimits = new Map(); // ip → timestamp[]
let creatingCount = 0; // in-flight account creations (throttles malq/raccoon)

function decryptPayload(result) {
  const key = Buffer.from("fd39e724f7c1e4b3d34bc7c72b5349c3", "utf8");
  const iv = Buffer.from("dd39e4a3337fe25a", "utf8");
  const d = createDecipheriv("aes-256-cbc", key, iv);
  const raw = d.update(result, "base64", "utf8") + d.final("utf8");
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object")
    throw new Error("decryptPayload: unexpected shape");
  return parsed;
}

function generateSN() {
  return randomUUID().replace(/-/g, "").toLowerCase();
}

function generatePassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
  let p = "";
  for (let i = 0; i < 12; i++)
    p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

// The old loop was "30 attempts, sleep 3s each". Attempt count is not a time
// budget: each attempt also carried the 20s fetch timeout, so a mail.tm that
// accepted connections and then stalled stretched this to ~11 minutes with the
// user's session pinned in `creating` the whole time. Bound it by the clock
// instead, poll immediately rather than sleeping first, and report what
// actually went wrong.
const VERIFY_TIMEOUT_MS = 60_000;
const VERIFY_POLL_MIN_MS = 1_000;
const VERIFY_POLL_MAX_MS = 3_000;
const VERIFY_MAX_MESSAGES = 5;

async function getVerificationCode(mailToken, deadline) {
  const until = Math.min(
    deadline ?? Date.now() + VERIFY_TIMEOUT_MS,
    Date.now() + VERIFY_TIMEOUT_MS,
  );
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = null;
  let wait = VERIFY_POLL_MIN_MS;

  // Always check at least once, even if the steps before this already ate the
  // budget — otherwise a slow registration reports "the mailbox stayed empty"
  // having never actually looked at it.
  for (;;) {
    attempts++;
    try {
      // malq's inbox endpoint returns full message bodies up front, unlike
      // mail.tm's summary-then-fetch shape, so there's no second request
      // per message here.
      const { mail } = await mailFetch(
        `/api/v1/inbox/${encodeURIComponent(mailToken)}`,
      );
      for (const msg of (mail || []).slice(0, VERIFY_MAX_MESSAGES)) {
        const text = [msg?.subject, msg?.body].filter(Boolean).join(" ");
        const match = text.match(/\b\d{6}\b/);
        if (match) return match[0];
      }
    } catch (e) {
      lastError = e;
      if (e.status === 429) wait = Math.max(wait, e.retryAfterMs || 5_000);
      logApi(`verify: check ${attempts} failed — ${e.message}`);
    }
    const remaining = until - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(wait, remaining)));
    wait = Math.min(Math.round(wait * 1.5), VERIFY_POLL_MAX_MS);
  }

  const secs = Math.round((Date.now() - startedAt) / 1000);
  const err = new Error(
    lastError
      ? `Verification code never arrived after ${secs}s (${attempts} checks) — mailbox errors, last: ${lastError.message}`
      : `Verification code never arrived after ${secs}s (${attempts} checks) — mailbox stayed empty, so the upstream never sent it`,
  );
  if (lastError?.service) err.service = lastError.service;
  throw err;
}

// ── Account pool ────────────────────────────────────────────────────────────
// Pre-creates accounts in the background so the first user doesn't wait for
// malq email verification (5-7 s). fillPool() is called at startup and
// each time an account is consumed from the pool.
const POOL_TARGET = 25;
// A pooled account is only useful while its login cookie is still good, and an
// account that has sat unused for half an hour is more likely to fail at
// playGame than to save anyone time.
const POOL_MAX_AGE_MS = 30 * 60_000;
const POOL_RETRY_MIN_MS = 15_000;
const POOL_RETRY_MAX_MS = 5 * 60_000;
const POOL_LOCAL_MAIL_RETRY_MS = 5_000;
// Keep a small gap between successful registrations so pool refill does not
// burst requests at Raccoon, while still taking advantage of self-hosted malq.
const POOL_SPACING_MS = 250;

const pool = []; // { sn, token, createdAt }[]
let poolFilling = false;
let poolRetryMs = POOL_RETRY_MIN_MS;
let poolRetryTimer = null;
let poolRetryAt = 0;
let lastPoolError = null;

// The old fillPool() `break`s out on the first error and is only ever called
// again when an account is consumed — so if upstream was down at startup the
// pool stayed empty for the life of the process and every single user paid the
// full on-demand account creation. Retry on a backoff instead.
function scheduleRefill(delayMs) {
  const retryAt = Date.now() + delayMs;
  if (poolRetryTimer && poolRetryAt <= retryAt) return;
  if (poolRetryTimer) clearTimeout(poolRetryTimer);
  poolRetryAt = retryAt;
  poolRetryTimer = setTimeout(() => {
    poolRetryTimer = null;
    poolRetryAt = 0;
    fillPool().catch(() => {});
  }, delayMs);
  poolRetryTimer.unref?.();
}

async function fillPool() {
  if (poolFilling || pool.length >= POOL_TARGET) return;
  poolFilling = true;
  try {
    while (pool.length < POOL_TARGET) {
      try {
        const acc = await createAccountRaw();
        pool.push({ ...acc, createdAt: Date.now() });
        lastPoolError = null;
        poolRetryMs = POOL_RETRY_MIN_MS;
        logApi(`pool: ready (${pool.length}/${POOL_TARGET})`);
      } catch (e) {
        lastPoolError = e.message;
        const retryMs = e.service === "malq" ? POOL_LOCAL_MAIL_RETRY_MS : poolRetryMs;
        logApi(
          `pool: fill error — ${e.message}; retrying in ${Math.round(retryMs / 1000)}s`,
        );
        scheduleRefill(retryMs);
        if (e.service !== "malq")
          poolRetryMs = Math.min(poolRetryMs * 2, POOL_RETRY_MAX_MS);
        return;
      }
      if (pool.length < POOL_TARGET)
        await new Promise((r) => setTimeout(r, POOL_SPACING_MS));
    }
  } finally {
    poolFilling = false;
  }
}

function takeFromPool() {
  while (pool.length) {
    const acc = pool.shift();
    if (Date.now() - acc.createdAt < POOL_MAX_AGE_MS) return acc;
    logApi("pool: discarded stale account");
  }
  return null;
}

async function createAccount() {
  const pooled = takeFromPool();
  if (pooled) {
    logApi(`pool: served account (${pool.length} remaining)`);
    fillPool().catch(() => {});
    return { sn: pooled.sn, token: pooled.token, pooled: true };
  }
  logApi(
    `pool: miss — creating account on demand${lastPoolError ? ` (last pool error: ${lastPoolError})` : ""}`,
  );
  try {
    const acc = await createAccountRaw();
    fillPool().catch(() => {});
    return acc;
  } catch (e) {
    // Don't immediately re-attempt a fill through the same failing upstream —
    // that just burns the rate limit the next user needs.
    lastPoolError = e.message;
    scheduleRefill(e.service === "malq" ? POOL_LOCAL_MAIL_RETRY_MS : poolRetryMs);
    throw e;
  }
}

// Keep the pool warm even with no traffic; no-ops when it is already full or a
// fill is in flight.
setInterval(() => fillPool().catch(() => {}), 60_000).unref?.();

// Account creation touches two upstreams and used to have no overall ceiling
// at all, so a single slow step could hold a session in `creating` far past
// anything a waiting user would sit through.
const ACCOUNT_CREATE_TIMEOUT_MS = 90_000;

// Raccoon replies with a JSON envelope carrying its own `status`. The register
// path ignored both the HTTP status and that envelope, so a refused
// sendEmail — blocked disposable domain, rate limit, upstream 5xx — looked
// exactly like success and the failure only surfaced a minute later as a
// verification-code timeout, pointing at the wrong service entirely.
async function raccoonStep(label, pathAndQuery, opts, deadline) {
  const budget = deadline ? deadline - Date.now() : Infinity;
  if (budget <= 0)
    throw new Error(`${label} skipped — account creation budget exhausted`);
  const res = await raccoonFetch(pathAndQuery, {
    ...opts,
    ...(Number.isFinite(budget)
      ? { timeoutMs: Math.min(RACCOON_TIMEOUT_MS, budget) }
      : {}),
  });
  const body = await res.text();
  if (!res.ok)
    throw new Error(`${label} → HTTP ${res.status} ${body.slice(0, 160)}`);
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {
    // Not every endpoint is guaranteed to answer JSON; a 2xx is enough.
    logApi(`${label}: non-JSON response ${body.slice(0, 120)}`);
    return null;
  }
  if (
    typeof data?.status === "number" &&
    data.status !== 200 &&
    data.status !== 201
  )
    throw new Error(
      `${label} rejected — status ${data.status}${data.msg ? `: ${data.msg}` : ""}`,
    );
  return data;
}

// malq's providers vary in freshness — some 500 on every single inbox poll
// (a broken scraper against a provider that changed its API), which is
// nothing like the transient rate-limit mail.tm produced. Riding that out
// with getVerificationCode's own retry loop would just burn the entire
// verification budget hammering a provider that will never work. Getting a
// new session (new random provider) is one HTTP call and cheap by
// comparison, so it's worth one retry before giving up.
const MAX_MAIL_ATTEMPTS = 3;

async function createAccountRaw() {
  const startedAt = Date.now();
  const deadline = startedAt + ACCOUNT_CREATE_TIMEOUT_MS;

  const raccoonPassword = generatePassword();
  const sn = generateSN();

  const h = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/147.0.0.0 Safari/537.36",
  };
  const base = {
    sn,
    model: "Chrome/147.0.0.0",
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
  };

  let email, code, lastVerifyError;
  for (let attempt = 1; attempt <= MAX_MAIL_ATTEMPTS; attempt++) {
    // malq picks the domain/provider and creates the inbox itself; no
    // separate account+password step like mail.tm required.
    const session = await mailFetch("/api/v1/session");
    email = session?.address;
    const mailToken = session?.token;
    if (!email || !mailToken) throw new Error("malq returned no session");

    await raccoonStep(
      "sendEmail",
      "/users/sendEmail",
      {
        method: "POST",
        headers: h,
        body: new URLSearchParams({ email, type: "register", ...base }),
      },
      deadline,
    );

    // A dead provider (a malq scraper throwing on every single poll, not a
    // transient 429) will happily eat the entire remaining deadline before
    // giving up, which left later attempts with no time at all. Split what's
    // left evenly across the attempts still owed, so a provider that never
    // answers can only cost its fair share.
    const attemptsLeft = MAX_MAIL_ATTEMPTS - attempt + 1;
    const attemptDeadline = Math.min(
      deadline,
      Date.now() + Math.floor((deadline - Date.now()) / attemptsLeft),
    );

    try {
      code = await getVerificationCode(mailToken, attemptDeadline);
      lastVerifyError = null;
      break;
    } catch (e) {
      lastVerifyError = e;
      if (attempt < MAX_MAIL_ATTEMPTS && Date.now() < deadline)
        logApi(`mail: attempt ${attempt} failed (${e.message}) — trying a new provider`);
    }
  }
  if (lastVerifyError) throw lastVerifyError;

  await raccoonStep(
    "emailRegister",
    "/users/emailRegister",
    {
      method: "POST",
      headers: h,
      body: new URLSearchParams({
        email,
        code,
        password: raccoonPassword,
        phone: "1",
        country: "Brazil",
        ...base,
      }),
    },
    deadline,
  );

  const loginRes = await raccoonFetch("/users/emailLogin", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, password: raccoonPassword, ...base }),
    timeoutMs: Math.max(5_000, Math.min(RACCOON_TIMEOUT_MS, deadline - Date.now())),
  });
  const loginBody = await loginRes.text();
  let loginData = null;
  try {
    loginData = JSON.parse(loginBody);
  } catch {}
  if (loginData?.status !== 200)
    throw new Error(
      `emailLogin failed — HTTP ${loginRes.status}, status ${loginData?.status ?? "?"}${loginData?.msg ? `: ${loginData.msg}` : ` ${loginBody.slice(0, 160)}`}`,
    );

  let userToken = loginData.data?.user_token || "";
  const cookie = loginRes.headers.get("set-cookie");
  if (cookie) {
    const m = cookie.match(/as_user_token=([^;]+)/);
    if (m) userToken = m[1];
  }
  // A blank token gets past every check here and only fails later at
  // checkCost/playGame, where it reads as a game problem rather than a
  // registration one.
  if (!userToken) throw new Error("emailLogin returned no user token");

  logApi(`account created in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  return { sn, token: userToken };
}

function gameHeaders(token) {
  return {
    accept: "*/*",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie: `as_user_token=${token}`,
    origin: "https://www.raccoongame.com",
    referer: "https://www.raccoongame.com/?t=1720436119",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
  };
}

async function doInitGame(session) {
  const { sn, token, game_key } = session;
  const h = gameHeaders(token);
  const common = {
    sn,
    model: "Chrome/147.0.0.0",
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
    "manufacturer;": "",
    user_token: token,
  };

  await raccoonFetch("/userGame/checkCost", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ ...common, game_key }),
  });

  const playData = await (
    await raccoonFetch("/jyapi/playGame", {
      method: "POST",
      headers: h,
      body: new URLSearchParams({
        ...common,
        game_key,
        model_name: "Chrome/147.0.0.0",
      }),
    })
  ).json();

  if (
    playData.status === 201 ||
    (playData.status === 200 && playData.data?.play_queue_id)
  ) {
    const qid = playData.data?.play_queue_id;
    if (!qid) throw new Error("Missing queue ID");
    return {
      queued: true,
      queue_id: qid,
      initial_pos: playData.data?.queue_pos,
    };
  }
  if (playData.status === 200 && playData.data?.result) {
    const server_data = decryptPayload(playData.data.result);
    return { queued: false, server_data };
  }

  throw new Error(`Unexpected playGame response: ${JSON.stringify(playData)}`);
}

async function doPollQueue(session, queue_id) {
  const { sn, token } = session;
  const d = await (
    await raccoonFetch("/jyapi/playQueue", {
      method: "POST",
      headers: gameHeaders(token),
      body: new URLSearchParams({
        sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        play_queue_id: queue_id,
        user_token: token,
      }),
    })
  ).json();
  if (d.status !== 200 && d.status !== 201)
    throw new Error(`Queue poll rejected: ${JSON.stringify(d)}`);
  return d.data?.queue_pos ?? 1;
}

async function doClaimGame(session, queue_id) {
  const { sn, token, game_key } = session;
  const d = await (
    await raccoonFetch("/jyapi/playGame", {
      method: "POST",
      headers: gameHeaders(token),
      body: new URLSearchParams({
        sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        game_key,
        model_name: "Chrome/147.0.0.0",
        play_queue_id: queue_id,
        user_token: token,
      }),
    })
  ).json();
  if (d.status === 200 && d.data?.result) return decryptPayload(d.data.result);
  throw new Error(`Failed to claim game. API Status: ${d.status}`);
}

async function doStopGame(session) {
  clearInterval(session.raccoonPingInterval);
  session.raccoonWs?.close();
  if (!session.sc_id) return;
  try {
    await raccoonFetch("/jyapi/stopGame", {
      method: "POST",
      headers: gameHeaders(session.token),
      body: new URLSearchParams({
        sn: session.sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
  } catch {}
}

async function doCost(session) {
  if (!session.sc_id) return;
  try {
    const res = await raccoonFetch("/userGame/cost", {
      method: "POST",
      headers: gameHeaders(session.token),
      body: new URLSearchParams({
        sn: session.sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
    const body = await res.json().catch(() => null);
    logApi(`doCost → ${res.status} ${JSON.stringify(body)}`);
    if (body?.status === 3013) {
      killSession(session.uuid, "upstream_terminated");
    }
  } catch (e) {
    logApi(`doCost error: ${e.message}`);
  }
}

function logApi(message) {
  console.log(`[stratus] ${message}`);
}

function checkIpLimit(store, ip, windowMs, max) {
  const now = Date.now();
  const hits = (store.get(ip) || []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  store.set(ip, hits);
  return true;
}

function countActiveSessions() {
  return sessions.size;
}

function acquireAccountSlot() {
  if (creatingCount >= MAX_CONCURRENT_SESSIONS * 2) return false;
  creatingCount++;
  return true;
}

function releaseAccountSlot() {
  creatingCount = Math.max(0, creatingCount - 1);
}

function applyServerData(session, sd) {
  session.sc_id = sd.sc_id || sd.play_id;
  session.bs_sc_id = sd.bs_sc_id || session.sc_id;
  session.bs_host = sd.bs_host;
  session.bs_token = sd.token;
  session.channel_id = sd.channel_id;
  session.gl_key = sd.gl_key;
  session.play_config = sd.play_config;
  session.turns = sd.turns || [];
  session.message_server = sd.message_server;
}

function killSession(uuid, reason = "unknown") {
  const session = sessions.get(uuid);
  if (!session) return;

  clearTimeout(session.startgame_timeout);
  clearTimeout(session.queue_abandon_timeout);
  clearTimeout(session.ping_timeout);
  clearTimeout(session.session_timeout);
  clearInterval(session.costInterval);
  // The signaling socket and its keepalive were never cleaned up, so every
  // ended session left an open outbound websocket and a 30s timer holding a
  // reference to it for the life of the process.
  clearInterval(session.raccoonPingInterval);

  try {
    session.clientWs?.close(1000, reason);
  } catch {}
  try {
    session.raccoonWs?.close(1000, reason);
  } catch {}

  doStopGame(session).catch(() => {});
  sessions.delete(uuid);

  logApi(`session ${uuid.slice(0, 8)} killed — ${reason}`);
}

function resetPingTimeout(uuid) {
  const session = sessions.get(uuid);
  if (!session) return;
  clearTimeout(session.ping_timeout);
  session.ping_timeout = setTimeout(
    () => killSession(uuid, "ping_timeout"),
    30_000,
  );
}

const REAPER_DEADLINES = {
  creating: 5 * 60_000,
  finished_queue: 2 * 60_000,
};
// "queued" has no flat deadline here — a real matchmaking queue can take a
// long time at busy times, and a client actively polling every few seconds
// (refreshing queue_abandon_timeout each time, see cloud.ts) is proof it's
// still there. QUEUED_MAX_AGE is only a backstop against a session that's
// stuck in "queued" despite queue_abandon_timeout having somehow not fired
// (e.g. a bug, or the poll loop itself throwing before it resets the timer).
const QUEUED_MAX_AGE = 30 * 60_000;
const QUEUED_POLL_STALE_AFTER = 90_000;

setInterval(() => {
  const now = Date.now();
  for (const [uuid, session] of sessions) {
    if (session.state === "queued") {
      const lastSeen = session.last_queue_poll_at ?? session.created_at;
      if (
        now - lastSeen > QUEUED_POLL_STALE_AFTER ||
        now - session.created_at > QUEUED_MAX_AGE
      ) {
        killSession(uuid, "reaper:queued_stale");
      }
      continue;
    }
    const deadline = REAPER_DEADLINES[session.state];
    if (deadline !== undefined && now - session.created_at > deadline) {
      killSession(uuid, `reaper:${session.state}_deadline`);
      continue;
    }
    if (session.state === "active" && !session.session_timeout) {
      killSession(uuid, "reaper:active_no_timeout");
    }
  }
}, 2 * 60_000).unref?.();

// Periodically prune the per-IP rate-limit windows.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, timestamps] of ipLimits.entries()) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) ipLimits.delete(ip);
    else ipLimits.set(ip, recent);
  }
  for (const [ip, timestamps] of embedIpLimits.entries()) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) embedIpLimits.delete(ip);
    else embedIpLimits.set(ip, recent);
  }
}, 60_000).unref?.();

// ── Raccoon signaling proxy (per session) ───────────────────────────────────
function connectRaccoonSignaling(session) {
  const { sn, gl_key, play_config, uuid } = session;

  const raccoonWs = new WebSocket(session.message_server.url, {
    perMessageDeflate: false,
    maxPayload: MAX_SIGNAL_BUFFERED_BYTES,
  });
  session.raccoonWs = raccoonWs;

  const endStalledSession = () => {
    // terminate() discards queued native buffers immediately; close() waits
    // for those buffers to drain and is therefore the wrong operation here.
    try { session.clientWs?.terminate(); } catch {}
    try { raccoonWs.terminate(); } catch {}
    killSession(uuid, "signal_backpressure");
  };
  const rSend = (p) => {
    if (raccoonWs.readyState !== WebSocket.OPEN) return;
    if (raccoonWs.bufferedAmount > MAX_SIGNAL_BUFFERED_BYTES)
      return endStalledSession();
    raccoonWs.send(JSON.stringify(p));
  };
  const toClient = (data) => {
    const cws = session.clientWs;
    if (cws?.readyState !== WebSocket.OPEN) return;
    if (cws.bufferedAmount > MAX_SIGNAL_BUFFERED_BYTES)
      return endStalledSession();
    cws.send(JSON.stringify(data));
  };

  raccoonWs.on("open", () => {
    rSend({
      id: "register",
      type: "webUA",
      uid: sn,
      token: decodeURIComponent(session.message_server.token),
    });
    session.raccoonPingInterval = setInterval(() => {
      rSend({
        id: "ping",
        uid: sn,
        type: "webUA",
        status: "gaming",
        sc_id: session.bs_sc_id,
      });
    }, 30_000);
  });

  raccoonWs.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (data.id) {
      case "register_ack":
        if (data.code === 200) {
          rSend({
            id: "start_game",
            from: sn,
            to: gl_key,
            game_args: "",
            gp_num: 0,
            play_config,
            simpleHandler: null,
            body: {
              force_soft_dec: 0,
              session_id: session.bs_sc_id,
              sn_user_id: sn,
              game_name: null,
              joystick_num: 2,
            },
          });
        }
        break;

      case "start_game":
        if (data.from === gl_key && data.body?.code === 200) {
          toClient({ type: "game_ready" });
        }
        break;

      case "rtc_sdp": {
        const b = data.body;
        if (!b) break;
        try {
          if (b.type === "answer") {
            toClient({ type: "rtc_answer", sdp: b });
          } else if (b.type === "candidate" && b.sdp) {
            toClient({ type: "rtc_candidate", candidate: b.sdp });
          }
        } catch {}
        break;
      }
    }
  });

  raccoonWs.on("close", () => clearInterval(session.raccoonPingInterval));
  raccoonWs.on("error", () => logApi(`signal error on ${uuid.slice(0, 8)}`));
}

// Warm the pool at startup so accounts are ready before the first user arrives.
fillPool().catch(() => {});

module.exports = {
  WebSocket,
  MAX_SESSION_SECONDS,
  MAX_CONCURRENT_SESSIONS,
  sessions,
  ipLimits,
  embedIpLimits,
  checkIpLimit,
  countActiveSessions,
  acquireAccountSlot,
  releaseAccountSlot,
  createAccount,
  doInitGame,
  doPollQueue,
  doClaimGame,
  doCost,
  applyServerData,
  killSession,
  resetPingTimeout,
  connectRaccoonSignaling,
  logApi,
};
