const express = require("express");
const { randomUUID, createDecipheriv } = require("crypto");
const { readFileSync } = require("fs");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");
const path = require("path");
const chalk = require("chalk");

if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

const PORT = 3001;

let sites;
try {
  sites = JSON.parse(readFileSync("sites.json", "utf-8"));
} catch (e) {
  console.error("Failed to load sites.json:", e);
  process.exit(1);
}

const sessions = new Map(); // uuid → session
const siteUsage = new Map(); // api_key → timestamp[]
const ipLimits = new Map(); // ip → timestamp[]
const embedIpLimits = new Map(); // ip → timestamp[]
const accountCreating = new Map(); // api_key → count

const MAX_SESSION_SECONDS = 19 * 60;

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

async function getVerificationCode(mailJwt, maxRetries = 30) {
  const headers = {
    Authorization: `Bearer ${mailJwt}`,
    "Content-Type": "application/json",
  };
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch("https://api.mail.tm/messages?page=1", {
        headers,
      });
      const data = await res.json();
      if (data["hydra:member"]?.length > 0) {
        const msgId = data["hydra:member"][0].id;
        const full = await (
          await fetch(`https://api.mail.tm/messages/${msgId}`, { headers })
        ).json();
        const match = (full.text || full.html || "")
          .replace(/<[^>]*>/g, "")
          .match(/\b\d{6}\b/);
        if (match) return match[0];
      }
    } catch {}
  }
  throw new Error("Timeout getting verification code");
}

async function createAccount() {
  const domainData = await (await fetch("https://api.mail.tm/domains")).json();
  if (!domainData["hydra:member"]?.length)
    throw new Error("No Mail.tm domains available");
  const domain = domainData["hydra:member"][0].domain;

  const mailUser = `rcn_${Math.random().toString(36).substring(2, 11)}`;
  const email = `${mailUser}@${domain}`;
  const mailPassword = generatePassword();
  const raccoonPassword = generatePassword();
  const sn = generateSN();

  const regRes = await fetch("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPassword }),
  });
  if (!regRes.ok) throw new Error("Failed to register Mail.tm mailbox");

  const tokenRes = await fetch("https://api.mail.tm/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPassword }),
  });
  if (!tokenRes.ok) throw new Error("Failed to get Mail.tm token");
  const { token: mailJwt } = await tokenRes.json();

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

  await fetch("https://www.raccoongame.com/users/sendEmail", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, type: "register", ...base }),
  });

  const code = await getVerificationCode(mailJwt);

  await fetch("https://www.raccoongame.com/users/emailRegister", {
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
  });

  const loginRes = await fetch("https://www.raccoongame.com/users/emailLogin", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, password: raccoonPassword, ...base }),
  });
  const loginData = await loginRes.json();
  if (loginData.status !== 200) throw new Error("Login failed");

  let userToken = loginData.data?.user_token || "";
  const cookie = loginRes.headers.get("set-cookie");
  if (cookie) {
    const m = cookie.match(/as_user_token=([^;]+)/);
    if (m) userToken = m[1];
  }

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

  await fetch("https://www.raccoongame.com/userGame/checkCost", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ ...common, game_key }),
  });

  const playData = await (
    await fetch("https://www.raccoongame.com/jyapi/playGame", {
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
    await fetch("https://www.raccoongame.com/jyapi/playQueue", {
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
    await fetch("https://www.raccoongame.com/jyapi/playGame", {
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
    await fetch("https://www.raccoongame.com/jyapi/stopGame", {
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
    await fetch("https://www.raccoongame.com/userGame/cost", {
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

function logApi(apiKey, message) {
  const name = getSiteName(apiKey) || "unknown";
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const date = now.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
  console.log(
    `${chalk.blackBright(`[${time} ${date}]`)} ${chalk.cyan(name)} ${message}`,
  );
}

function getClientIp(req) {
  const caddy = req.headers["x-caddy-real-ip-is-here1357908642"];
  if (caddy) return caddy;
  return req.socket.remoteAddress || "unknown";
}

function checkIpLimit(store, ip, windowMs, max) {
  const now = Date.now();
  const hits = (store.get(ip) || []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  store.set(ip, hits);
  return true;
}

function getSiteName(apiKey) {
  return (
    Object.keys(sites.sites).find((k) => sites.sites[k].api_key === apiKey) ||
    null
  );
}

function getSite(apiKey) {
  const name = getSiteName(apiKey);
  return name ? { name, ...sites.sites[name] } : null;
}

function checkRateLimit(apiKey, site) {
  const now = Date.now();
  const calls = siteUsage.get(apiKey) || [];

  const perMin = calls.filter((t) => t > now - 60_000).length;
  const perHour = calls.filter((t) => t > now - 3_600_000).length;
  const perDay = calls.filter((t) => t > now - 86_400_000).length;
  const perMonth = calls.filter((t) => t > now - 30 * 86_400_000).length;

  if (perMin >= site.limits.per_minute)
    return {
      allowed: false,
      reason: `per-minute limit (${site.limits.per_minute}/min)`,
    };
  if (perHour >= site.limits.per_hour)
    return {
      allowed: false,
      reason: `per-hour limit (${site.limits.per_hour}/hr)`,
    };
  if (perDay >= site.limits.per_day)
    return {
      allowed: false,
      reason: `per-day limit (${site.limits.per_day}/day)`,
    };
  if (perMonth >= site.limits.per_month)
    return {
      allowed: false,
      reason: `per-month limit (${site.limits.per_month}/month)`,
    };

  return { allowed: true };
}

function recordUsage(apiKey) {
  const now = Date.now();
  const calls = (siteUsage.get(apiKey) || []).filter(
    (t) => t > now - 30 * 86_400_000,
  );
  calls.push(now);
  siteUsage.set(apiKey, calls);
}

function getUsageStats(apiKey) {
  const now = Date.now();
  const calls = siteUsage.get(apiKey) || [];
  return {
    perMin: calls.filter((t) => t > now - 60_000).length,
    perHour: calls.filter((t) => t > now - 3_600_000).length,
    perDay: calls.filter((t) => t > now - 86_400_000).length,
    perMonth: calls.filter((t) => t > now - 30 * 86_400_000).length,
  };
}

function countActiveSessions(apiKey) {
  return [...sessions.values()].filter((s) => s.api_key === apiKey).length;
}

function acquireAccountSlot(apiKey, site) {
  const cap = (site.max_concurrent_sessions ?? 5) * 2;
  const current = accountCreating.get(apiKey) ?? 0;
  if (current >= cap) return false;
  accountCreating.set(apiKey, current + 1);
  return true;
}

function releaseAccountSlot(apiKey) {
  const current = accountCreating.get(apiKey) ?? 1;
  const next = current - 1;
  if (next <= 0) accountCreating.delete(apiKey);
  else accountCreating.set(apiKey, next);
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

  try {
    session.clientWs?.close(1000, reason);
  } catch {}

  doStopGame(session).catch(() => {});
  sessions.delete(uuid);

  logApi(
    session.api_key,
    chalk.gray(`session ${chalk.white(uuid.slice(0, 8))} killed — ${reason}`),
  );
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
  queued: 10 * 60_000,
  finished_queue: 2 * 60_000,
};

setInterval(() => {
  const now = Date.now();
  for (const [uuid, session] of sessions) {
    const deadline = REAPER_DEADLINES[session.state];
    if (deadline !== undefined && now - session.created_at > deadline) {
      killSession(uuid, `reaper:${session.state}_deadline`);
      continue;
    }
    // Active sessions with no session_timeout set — shouldn't happen, nuke anyway
    if (session.state === "active" && !session.session_timeout) {
      killSession(uuid, "reaper:active_no_timeout");
    }
  }
}, 2 * 60_000);

// ── Raccoon signaling proxy (per API session) ──────────────────────────────

function connectRaccoonSignaling(session) {
  const { sn, gl_key, play_config, uuid } = session;

  const raccoonWs = new WebSocket(session.message_server.url);
  session.raccoonWs = raccoonWs;

  const rSend = (p) => {
    if (raccoonWs.readyState === WebSocket.OPEN)
      raccoonWs.send(JSON.stringify(p));
  };
  const toClient = (data) => {
    const cws = session.clientWs;
    if (cws?.readyState === WebSocket.OPEN) cws.send(JSON.stringify(data));
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
  raccoonWs.on("error", () =>
    logApi(session.api_key, chalk.red(`signal error on ${uuid.slice(0, 8)}`)),
  );
}

function auth(req, res, next) {
  const apiKey =
    req.headers["x-api-key"] || req.body?.api_key || req.query?.api_key;
  if (!apiKey) return res.status(401).json({ error: "Missing API key." });
  const site = getSite(apiKey);
  if (!site) return res.status(401).json({ error: "Invalid API key." });
  if (!site.enabled)
    return res.status(403).json({ error: "API Key has been disabled." });
  req.site = site;
  req.apiKey = apiKey;
  next();
}

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const ip = getClientIp(req);

  if (!checkIpLimit(ipLimits, ip, 60_000, 100)) {
    return res
      .status(429)
      .json({
        error: "Too many requests from this IP. Try again in a minute.",
      });
  }

  req.setTimeout(30_000, () => {
    res.status(408).json({ error: "Request timeout." });
  });

  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/cloud/v1/embed", (req, res) => {
  if (!req.query.id) {
    return res.status(400).type("text").send("Missing `id` parameter");
  }
  res.sendFile(path.join(__dirname, "public", "e.html"));
});

app.get("/cloud/v1/embed-data", (req, res) => {
  const ip = getClientIp(req);
  if (!checkIpLimit(embedIpLimits, ip, 60_000, 30)) {
    return res.status(429).json({ error: "Too many requests. Slow down." });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id." });

  const session = sessions.get(id);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.state !== "active")
    return res.status(400).json({ error: "Session not yet active." });

  res.json({
    ice_servers: session.embed_ice_servers,
    signaling_ws: session.embed_signaling_ws,
  });
});

//    { "status": "creating_account" }
//    { "status": "account_ready" }
//    { "status": "requesting_game" }
//    { "status": "queue",          "uuid": "...", "queue_pos": N }
//    { "status": "finished_queue", "uuid": "...", "fetch_this_within_30s_or_terminate": "/cloud/v1/startGame" }
//    { "status": "error",          "error": "..." }

app.post("/cloud/v1/createSession", auth, async (req, res) => {
  const { game_key } = req.body;
  if (!game_key || typeof game_key !== "string" || game_key.length > 256) {
    return res.status(400).json({ error: "Invalid game_key." });
  }

  const { site, apiKey } = req;

  if (countActiveSessions(apiKey) >= site.max_concurrent_sessions) {
    return res
      .status(429)
      .json({
        error: `Concurrent session limit reached (max ${site.max_concurrent_sessions}).`,
      });
  }

  const rl = checkRateLimit(apiKey, site);
  if (!rl.allowed)
    return res
      .status(429)
      .json({ error: `Rate limit exceeded: ${rl.reason}.` });

  if (!acquireAccountSlot(apiKey, site)) {
    return res
      .status(429)
      .json({ error: "Too many sessions being created. Try again shortly." });
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const push = (obj) => res.write(JSON.stringify(obj) + "\n");
  const uuid = randomUUID();

  const rawLimit = site.max_session_seconds ?? MAX_SESSION_SECONDS;
  const sessionLimit = Math.min(rawLimit, MAX_SESSION_SECONDS);

  const session = {
    uuid,
    api_key: apiKey,
    state: "creating",
    game_key,
    sn: "",
    token: "",
    created_at: Date.now(),
    max_session_seconds: sessionLimit,
    last_queue_poll_at: null,
    last_ping_at: null,
    startgame_timeout: null,
    queue_abandon_timeout: null,
    ping_timeout: null,
    session_timeout: null,
    raccoonWs: null,
    raccoonPingInterval: null,
    clientWs: null,
    costInterval: null,
  };
  sessions.set(uuid, session);
  logApi(
    apiKey,
    `${chalk.gray("createSession")} ${chalk.white(game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
  );

  try {
    push({ status: "creating_account" });
    const acc = await createAccount();

    releaseAccountSlot(apiKey);

    if (!sessions.has(uuid)) return res.end();

    session.sn = acc.sn;
    session.token = acc.token;
    recordUsage(apiKey);

    push({ status: "account_ready" });
    push({ status: "requesting_game" });

    const init = await doInitGame(session);

    if (!sessions.has(uuid)) return res.end();

    if (init.queued) {
      session.state = "queued";
      session.queue_id = init.queue_id;

      session.queue_abandon_timeout = setTimeout(
        () => killSession(uuid, "queue_abandoned"),
        60_000,
      );

      push({ status: "queue", uuid, queue_pos: init.initial_pos });
    } else {
      applyServerData(session, init.server_data);
      session.state = "finished_queue";
      session.finished_queue_at = Date.now();

      session.startgame_timeout = setTimeout(
        () => killSession(uuid, "startgame_timeout"),
        30_000,
      );

      push({
        status: "finished_queue",
        uuid,
        fetch_this_within_30s_or_terminate: "/cloud/v1/startGame",
      });
    }
  } catch (e) {
    releaseAccountSlot(apiKey);
    push({ status: "error", error: e.message });
    killSession(uuid, "creation_error");
  }

  res.end();
});

app.get("/cloud/v1/getQueue", auth, async (req, res) => {
  const { uuid } = req.query;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });

  if (session.state !== "queued" && session.state !== "finished_queue") {
    return res
      .status(400)
      .json({ error: `Session is '${session.state}', not pollable.` });
  }

  const now = Date.now();
  if (session.last_queue_poll_at && now - session.last_queue_poll_at < 3_000) {
    return res
      .status(429)
      .json({ error: "Too fast. Poll getQueue at most once every 3 seconds." });
  }
  session.last_queue_poll_at = now;

  clearTimeout(session.queue_abandon_timeout);
  session.queue_abandon_timeout = setTimeout(
    () => killSession(uuid, "queue_abandoned"),
    60_000,
  );

  if (session.state === "finished_queue") {
    return res.json({
      status: "finished_queue",
      uuid,
      fetch_this_within_30s_or_terminate: "/cloud/v1/startGame",
    });
  }

  try {
    const pos = await doPollQueue(session, session.queue_id);

    if (pos === 0) {
      const serverData = await doClaimGame(session, session.queue_id);
      applyServerData(session, serverData);
      session.state = "finished_queue";
      session.finished_queue_at = Date.now();
      clearTimeout(session.queue_abandon_timeout);

      session.startgame_timeout = setTimeout(
        () => killSession(uuid, "startgame_timeout"),
        30_000,
      );

      return res.json({
        status: "finished_queue",
        uuid,
        fetch_this_within_30s_or_terminate: "/cloud/v1/startGame",
      });
    }

    return res.json({ status: "queue", queue_pos: pos });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/cloud/v1/startGame", auth, (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });
  if (session.state !== "finished_queue") {
    return res
      .status(400)
      .json({ error: `Session is '${session.state}', not ready to start.` });
  }

  clearTimeout(session.startgame_timeout);
  clearTimeout(session.queue_abandon_timeout);

  session.state = "active";
  session.game_started_at = Date.now();

  resetPingTimeout(uuid);

  session.session_timeout = setTimeout(
    () => killSession(uuid, "max_session_length"),
    session.max_session_seconds * 1000,
  );

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    ...(session.turns || []).map((t) => ({
      urls: t.turn_url,
      username: t.turn_user,
      credential: t.turn_password,
    })),
  ];

  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const signalingWs = `${proto === "https" ? "wss" : "ws"}://${req.headers.host}/cloud/v1/signal/${uuid}`;

  session.embed_ice_servers = iceServers;
  session.embed_signaling_ws = signalingWs;

  session.costInterval = setInterval(() => doCost(session), 25_000);

  res.json({
    ice_servers: iceServers,
    signaling_ws: signalingWs,
    max_seconds: session.max_session_seconds,
  });

  logApi(
    req.apiKey,
    `${chalk.gray("startGame")} ${chalk.white(session.game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
  );

  connectRaccoonSignaling(session);
});

app.post("/cloud/v1/pingSession", auth, (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });
  if (session.state !== "active")
    return res.status(400).json({ error: "Session is not active." });

  const now = Date.now();
  if (session.last_ping_at && now - session.last_ping_at < 3_000) {
    return res
      .status(429)
      .json({ error: "Too fast. Ping at most once every 3 seconds." });
  }

  session.last_ping_at = now;
  resetPingTimeout(uuid);

  const { site } = req;
  const usage = getUsageStats(req.apiKey);
  const timeUsed = Math.floor((now - session.game_started_at) / 1000);

  res.json({
    session_time_used_seconds: timeUsed,
    session_time_limit_seconds: session.max_session_seconds,
    quota: {
      minute: { used: usage.perMin, limit: site.limits.per_minute },
      hour: { used: usage.perHour, limit: site.limits.per_hour },
      day: { used: usage.perDay, limit: site.limits.per_day },
      month: { used: usage.perMonth, limit: site.limits.per_month },
    },
  });
});

app.post("/cloud/v1/quitSession", auth, (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });

  logApi(
    req.apiKey,
    `${chalk.gray("quitSession")} ${chalk.white(uuid.slice(0, 8))}`,
  );
  killSession(uuid, "quit_requested");
  res.json({ status: "ok" });
});

//  Client → Server:
//    { "type": "rtc_offer",     "sdp": "..."       }
//    { "type": "rtc_candidate", "candidate": "..." }
//
//  Server → Client:
//    { "type": "game_ready"                        }  ← wait for this before sending offer
//    { "type": "rtc_answer",    "sdp": { ... }     }
//    { "type": "rtc_candidate", "candidate": "..." }

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const match = req.url.match(/^\/cloud\/v1\/signal\/([0-9a-f-]{36})$/i);
  if (!match) {
    socket.destroy();
    return;
  }

  const uuid = match[1];
  const session = sessions.get(uuid);

  if (!session || session.state !== "active") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    session.clientWs = ws;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const rws = session.raccoonWs;
      if (!rws || rws.readyState !== WebSocket.OPEN) return;

      if (msg.type === "rtc_offer" && msg.sdp) {
        rws.send(
          JSON.stringify({
            id: "rtc_sdp",
            from: session.sn,
            to: session.gl_key,
            body: { sdp: msg.sdp, type: "offer" },
          }),
        );
      } else if (msg.type === "rtc_candidate" && msg.candidate) {
        rws.send(
          JSON.stringify({
            id: "rtc_sdp",
            from: session.sn,
            to: session.gl_key,
            body: { type: "candidate", sdp: msg.candidate },
          }),
        );
      }
    });

    ws.on("close", () => {
      session.clientWs = undefined;
    });
    ws.on("error", () => {});
  });
});

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
}, 60_000);

httpServer.listen(PORT, () => {
  const label = (s) => chalk.dim(s.padStart(12));
  const siteList = Object.entries(sites.sites);

  console.log("");
  console.log(chalk.bold(" 🔌 stratus api"));
  console.log("");
  console.log(label("port") + "  " + chalk.white(PORT));
  console.log(label("sites") + "  " + chalk.white(siteList.length));
  console.log(
    label("cap") +
      "  " +
      chalk.white(`${MAX_SESSION_SECONDS / 60}m max session`),
  );
  console.log("");

  siteList.forEach(([name, cfg]) => {
    const sessionCap = Math.min(
      cfg.max_session_seconds ?? MAX_SESSION_SECONDS,
      MAX_SESSION_SECONDS,
    );
    const status = cfg.enabled ? chalk.green("enabled") : chalk.red("disabled");
    console.log(
      `  ${chalk.white(name.padEnd(20))} ${status}  ${chalk.blackBright(`max ${cfg.max_concurrent_sessions} concurrent  ·  ${sessionCap}s limit`)}`,
    );
  });

  console.log("");
});
