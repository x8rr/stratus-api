import { useEffect, useState } from "react";
import "./index.css";
import logoSrc from "./logo.webp";

// ── Syntax highlighter ────────────────────────────────────────────────────────

const KW = new Set([
  "const", "let", "var", "async", "await", "return", "if", "else",
  "for", "of", "while", "true", "false", "null", "new", "import",
  "from", "export", "break", "function", "throw",
]);

function tokenize(code: string) {
  const out: { text: string; color: string }[] = [];
  let s = code;
  while (s.length) {
    if (s.startsWith("//")) {
      const end = s.indexOf("\n");
      const text = end === -1 ? s : s.slice(0, end);
      out.push({ text, color: "#4b5563" });
      s = end === -1 ? "" : s.slice(end);
      continue;
    }
    const strM = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/.exec(s);
    if (strM) { out.push({ text: strM[1], color: "#86efac" }); s = s.slice(strM[1].length); continue; }
    const numM = /^(\b\d+\.?\d*\b)/.exec(s);
    if (numM) { out.push({ text: numM[1], color: "#fca5a5" }); s = s.slice(numM[1].length); continue; }
    const idM = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(s);
    if (idM) {
      const w = idM[1];
      const after = s.slice(w.length).trimStart();
      const color = KW.has(w) ? "#D4F000" : after.startsWith("(") ? "#93c5fd" : "#f1f5f9";
      out.push({ text: w, color });
      s = s.slice(w.length);
      continue;
    }
    out.push({ text: s[0], color: "#94a3b8" });
    s = s.slice(1);
  }
  return out;
}

function Code({ children, block = false }: { children: string; block?: boolean }) {
  const tokens = tokenize(children);
  const spans = tokens.map((t, i) => <span key={i} style={{ color: t.color }}>{t.text}</span>);
  if (!block) return <code className="font-mono text-sm">{spans}</code>;
  return (
    <pre className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-5 py-4 overflow-x-auto text-[13px] leading-[1.75] font-mono">
      <code>{spans}</code>
    </pre>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="font-mono text-xs text-[#D4F000] bg-yellow/5 border border-yellow/15 px-1.5 py-0.5 rounded">
      {children}
    </code>
  );
}

// ── Method badge ──────────────────────────────────────────────────────────────

type Method = "GET" | "POST" | "WS";

const METHOD_STYLE: Record<Method, string> = {
  GET:  "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  POST: "text-blue-400   bg-blue-400/10   border-blue-400/20",
  WS:   "text-purple-400 bg-purple-400/10 border-purple-400/20",
};

function EndpointBar({ method, path }: { method: Method; path: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-sm bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-4 py-3 mb-6">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${METHOD_STYLE[method]}`}>
        {method}
      </span>
      <span className="text-[#888]">{path}</span>
    </div>
  );
}

// ── Parameter table ───────────────────────────────────────────────────────────

type Param = { name: string; type: string; required?: boolean; desc: string };

function ParamTable({ title, params }: { title: string; params: Param[] }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold text-[#555] uppercase tracking-widest mb-3">{title}</p>
      <div className="border border-[#1a1a1a] rounded-lg overflow-hidden">
        {params.map((p, i) => (
          <div key={p.name} className={`grid grid-cols-[160px_1fr] gap-4 px-4 py-3 ${i < params.length - 1 ? "border-b border-[#1a1a1a]" : ""}`}>
            <div className="flex items-start gap-2 pt-0.5">
              <code className="text-xs font-mono text-[#f1f5f9]">{p.name}</code>
              {p.required && (
                <span className="text-[10px] font-semibold text-red-400/70 border border-red-400/20 bg-red-400/5 px-1 rounded leading-4 mt-0.5">req</span>
              )}
            </div>
            <div>
              <span className="text-xs text-[#555] font-mono mr-2">{p.type}</span>
              <span className="text-sm text-[#777]">{p.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Event stream table ────────────────────────────────────────────────────────

type EventRow = { status: string; when: string; extra?: string };

function EventTable({ events }: { events: EventRow[] }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold text-[#555] uppercase tracking-widest mb-3">NDJSON events</p>
      <div className="border border-[#1a1a1a] rounded-lg overflow-hidden">
        {events.map((e, i) => (
          <div key={e.status} className={`grid grid-cols-[180px_1fr] gap-4 px-4 py-3 ${i < events.length - 1 ? "border-b border-[#1a1a1a]" : ""}`}>
            <code className="text-xs font-mono text-yellow">{e.status}</code>
            <div>
              <span className="text-sm text-[#777]">{e.when}</span>
              {e.extra && <p className="text-xs text-[#444] font-mono mt-1">{e.extra}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="py-12 border-b border-[#111] scroll-mt-20">
      <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
      <div className="w-8 h-px bg-yellow mb-8" aria-hidden="true" />
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[#777] leading-relaxed mb-4 text-sm">{children}</p>;
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

const SIDEBAR = [
  {
    group: "Getting Started",
    items: [
      { id: "overview",           label: "Overview" },
      { id: "authentication",     label: "Authentication" },
      { id: "session-lifecycle",  label: "Session Lifecycle" },
    ],
  },
  {
    group: "Endpoints",
    items: [
      { id: "create-session", label: "createSession" },
      { id: "get-queue",      label: "getQueue" },
      { id: "start-game",     label: "startGame" },
      { id: "ping-session",   label: "pingSession" },
      { id: "quit-session",   label: "quitSession" },
    ],
  },
  {
    group: "Advanced",
    items: [
      { id: "signaling",    label: "WebRTC Signaling" },
      { id: "embed",        label: "Embed" },
      { id: "rate-limits",  label: "Rate Limits" },
      { id: "errors",       label: "Errors" },
    ],
  },
];

const ALL_IDS = SIDEBAR.flatMap((g) => g.items.map((i) => i.id));

function useActiveSection() {
  const [active, setActive] = useState(ALL_IDS[0]);

  useEffect(() => {
    const ios = ALL_IDS.map((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const io = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActive(id); },
        { rootMargin: "-15% 0% -75% 0%", threshold: 0 }
      );
      io.observe(el);
      return io;
    });
    return () => ios.forEach((io) => io?.disconnect());
  }, []);

  return active;
}

function Sidebar({ active }: { active: string }) {
  return (
    <aside className="hidden lg:block w-52 shrink-0">
      <nav className="sticky top-20 space-y-6" aria-label="Documentation">
        {SIDEBAR.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[10px] font-semibold text-[#444] uppercase tracking-widest mb-2">{group}</p>
            <ul className="space-y-0.5">
              {items.map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className={`block text-sm px-2 py-1.5 rounded transition-colors ${
                      active === id
                        ? "text-yellow bg-yellow/5"
                        : "text-[#555] hover:text-[#999]"
                    }`}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────────

function DocsNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#1a1a1a] bg-[#0a0a0a]/90 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="flex items-center gap-2.5" aria-label="Stratus API home">
            <img src={logoSrc} alt="" width="22" height="22" className="opacity-90" />
            <span className="font-semibold text-sm tracking-tight text-white">Stratus</span>
            <span className="text-[#333] text-sm font-light hidden sm:inline">API</span>
          </a>
          <span className="text-[#333]">/</span>
          <span className="text-sm text-[#666]">Docs</span>
        </div>

        <a
          href="mailto:channelediting521@gmail.com"
          className="text-xs font-semibold px-4 py-2 bg-yellow text-black rounded hover:opacity-90 transition-opacity"
        >
          Get API Key
        </a>
      </div>
    </header>
  );
}

// ── Page content ───────────────────────────────────────────────────────────────

function Content() {
  return (
    <main className="flex-1 min-w-0 py-4">

      {/* Overview */}
      <Section id="overview" title="Overview">
        <P>
          Stratus API provisions cloud gaming sessions and returns WebRTC credentials so you can stream
          games directly to your users. You supply a <InlineCode>game_key</InlineCode>, the API handles
          account creation, session queuing, and TURN infrastructure.
        </P>
        <P>
          The library covers 180+ titles including GTA V, Minecraft: Dungeons, Minecraft: Legends, and
          Poppy Playtime chapters 1–4.
        </P>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {[
            ["Base URL",        "https://api.stratus.lol"],
            ["Auth header",     "x-api-key: sk_live_..."],
            ["Session limit",   "15 minutes max"],
            ["Content-Type",    "application/json"],
          ].map(([k, v]) => (
            <div key={k} className="border border-[#1a1a1a] rounded-lg p-4">
              <p className="text-xs text-[#444] mb-1">{k}</p>
              <code className="text-xs font-mono text-[#888]">{v}</code>
            </div>
          ))}
        </div>
      </Section>

      {/* Authentication */}
      <Section id="authentication" title="Authentication">
        <P>
          Every request must include your API key in the <InlineCode>x-api-key</InlineCode> request header.
          Keys are bound to a single site and carry their own rate limits and session caps.
        </P>
        <Code block>{`// Header format
x-api-key: sk_live_xxxxxxxxxxxxxxxx

// Or as a query param (not recommended)
GET /cloud/v1/getQueue?uuid=...&api_key=sk_live_...`}</Code>
        <P>
          Missing or invalid keys return <InlineCode>401</InlineCode>. Disabled keys return <InlineCode>403</InlineCode>.
        </P>
      </Section>

      {/* Session Lifecycle */}
      <Section id="session-lifecycle" title="Session Lifecycle">
        <P>
          A session moves through a fixed set of states. The typical path from cold start to active stream:
        </P>
        <Code block>{`createSession  →  [stream NDJSON events]
                       creating_account
                       account_ready
                       requesting_game
                       queue  (if server is full — poll getQueue)
                       finished_queue  ←────────────────┐
                                                        │
startGame  (must call within 30 s)  ──────────────────►┘
  └─ returns ice_servers + signaling_ws

[WebRTC connect via signaling WebSocket]

pingSession  (call every <30 s to keep session alive)

quitSession  (explicit teardown)`}</Code>
        <P>
          Sessions that exceed the 15-minute limit are terminated automatically.
          Failing to ping within 30 seconds also terminates the session.
        </P>
      </Section>

      {/* createSession */}
      <Section id="create-session" title="createSession">
        <EndpointBar method="POST" path="/cloud/v1/createSession" />
        <P>
          Provisions a new cloud gaming session. The response body is an NDJSON stream — each line is a
          JSON object describing the current provisioning state. Read the stream line-by-line until you
          receive <InlineCode>finished_queue</InlineCode>, then call <InlineCode>startGame</InlineCode>.
        </P>
        <ParamTable
          title="Request headers"
          params={[
            { name: "x-api-key",     type: "string", required: true,  desc: "Your API key." },
            { name: "Content-Type",  type: "string", required: true,  desc: "Must be application/json." },
          ]}
        />
        <ParamTable
          title="Request body"
          params={[
            { name: "game_key", type: "string", required: true, desc: "Identifier for the title to launch." },
          ]}
        />
        <EventTable
          events={[
            { status: "creating_account",  when: "Backend account is being provisioned." },
            { status: "account_ready",     when: "Account ready, requesting game slot." },
            { status: "requesting_game",   when: "Requesting a game server." },
            { status: "queue",             when: "Server is full — session is queued.", extra: '{ uuid, queue_pos: number }' },
            { status: "finished_queue",    when: "Game slot acquired. Call startGame within 30 s.", extra: '{ uuid, fetch_this_within_30s_or_terminate }' },
            { status: "error",             when: "Provisioning failed.", extra: '{ error: string }' },
          ]}
        />
        <Code block>{`const res = await fetch(
  "https://api.stratus.lol/cloud/v1/createSession",
  {
    method: "POST",
    headers: {
      "x-api-key": "sk_live_xxxxxxxxxxxxxxxx",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ game_key: "gta_v" }),
  }
);

const reader = res.body.getReader();
const dec = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  const event = JSON.parse(dec.decode(value));

  if (event.status === "queue") {
    console.log("Queue position:", event.queue_pos);
    // poll getQueue every 3-5 s
  }
  if (event.status === "finished_queue") {
    await startGame(event.uuid); // see startGame
    break;
  }
  if (event.status === "error") {
    throw new Error(event.error);
  }
}`}</Code>
      </Section>

      {/* getQueue */}
      <Section id="get-queue" title="getQueue">
        <EndpointBar method="GET" path="/cloud/v1/getQueue?uuid=UUID" />
        <P>
          Poll the queue position for a session that received a <InlineCode>queue</InlineCode> event
          from <InlineCode>createSession</InlineCode>. Call at most once every 3 seconds — faster
          polling returns <InlineCode>429</InlineCode>. You must poll at least once every 60 seconds
          or the session is abandoned.
        </P>
        <ParamTable
          title="Query parameters"
          params={[
            { name: "uuid", type: "string", required: true, desc: "Session UUID from the queue event." },
          ]}
        />
        <Code block>{`// Returns one of two shapes:

// Still queued
{ "status": "queue", "queue_pos": 3 }

// Ready — call startGame within 30 s
{
  "status": "finished_queue",
  "uuid": "7f3a2c...",
  "fetch_this_within_30s_or_terminate": "/cloud/v1/startGame"
}`}</Code>
      </Section>

      {/* startGame */}
      <Section id="start-game" title="startGame">
        <EndpointBar method="POST" path="/cloud/v1/startGame" />
        <P>
          Activates the session and returns WebRTC credentials. Must be called within
          30 seconds of receiving a <InlineCode>finished_queue</InlineCode> event, or the session
          is terminated.
        </P>
        <ParamTable
          title="Request body"
          params={[
            { name: "uuid", type: "string", required: true, desc: "Session UUID from finished_queue." },
          ]}
        />
        <Code block>{`// Response
{
  "ice_servers": [
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": "turn:...",
      "username": "...",
      "credential": "..."
    }
  ],
  "signaling_ws": "wss://api.stratus.lol/cloud/v1/signal/7f3a2c...",
  "max_seconds": 900
}`}</Code>
        <P>
          Use <InlineCode>ice_servers</InlineCode> to configure your{" "}
          <InlineCode>RTCPeerConnection</InlineCode> and connect to{" "}
          <InlineCode>signaling_ws</InlineCode> to begin the WebRTC handshake.
          See <a href="#signaling" className="text-yellow hover:underline">WebRTC Signaling</a>.
        </P>
      </Section>

      {/* pingSession */}
      <Section id="ping-session" title="pingSession">
        <EndpointBar method="POST" path="/cloud/v1/pingSession" />
        <P>
          Keepalive ping for an active session. The server terminates any session
          that goes 30 seconds without a ping. Call this in a tight loop (every 10–20 s is ideal).
          Also returns current quota usage and session time.
        </P>
        <ParamTable
          title="Request body"
          params={[
            { name: "uuid", type: "string", required: true, desc: "Active session UUID." },
          ]}
        />
        <Code block>{`// Response
{
  "session_time_used_seconds": 42,
  "session_time_limit_seconds": 900,
  "quota": {
    "minute": { "used": 1,  "limit": 10  },
    "hour":   { "used": 3,  "limit": 60  },
    "day":    { "used": 3,  "limit": 200 },
    "month":  { "used": 3,  "limit": 1000 }
  }
}`}</Code>
        <Code block>{`// Keepalive loop
async function keepAlive(apiKey, uuid) {
  const interval = setInterval(async () => {
    const { session_time_used_seconds, session_time_limit_seconds } =
      await post("/cloud/v1/pingSession", { uuid });

    if (session_time_used_seconds >= session_time_limit_seconds) {
      clearInterval(interval);
      onSessionEnd();
    }
  }, 15_000);

  return () => clearInterval(interval);
}`}</Code>
      </Section>

      {/* quitSession */}
      <Section id="quit-session" title="quitSession">
        <EndpointBar method="POST" path="/cloud/v1/quitSession" />
        <P>
          Explicitly terminates a session and frees the cloud instance. Call this when the user is
          done — do not rely solely on the session timeout to clean up.
        </P>
        <ParamTable
          title="Request body"
          params={[
            { name: "uuid", type: "string", required: true, desc: "Session UUID to terminate." },
          ]}
        />
        <Code block>{`// Response
{ "status": "ok" }`}</Code>
      </Section>

      {/* Signaling */}
      <Section id="signaling" title="WebRTC Signaling">
        <EndpointBar method="WS" path="/cloud/v1/signal/:uuid" />
        <P>
          WebSocket endpoint that proxies WebRTC signaling between your client and the game server.
          Connect using the <InlineCode>signaling_ws</InlineCode> URL returned by{" "}
          <InlineCode>startGame</InlineCode>. Wait for the <InlineCode>game_ready</InlineCode> event
          before sending your offer.
        </P>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold text-[#555] uppercase tracking-widest mb-3">Client → Server</p>
            <div className="border border-[#1a1a1a] rounded-lg overflow-hidden">
              {[
                { type: "rtc_offer",     desc: 'SDP offer: { type: "rtc_offer", sdp: string }' },
                { type: "rtc_candidate", desc: 'ICE candidate: { type: "rtc_candidate", candidate: string }' },
              ].map((r, i) => (
                <div key={r.type} className={`px-4 py-3 ${i === 0 ? "border-b border-[#1a1a1a]" : ""}`}>
                  <code className="text-xs font-mono text-blue-400 block mb-1">{r.type}</code>
                  <p className="text-xs text-[#555]">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#555] uppercase tracking-widest mb-3">Server → Client</p>
            <div className="border border-[#1a1a1a] rounded-lg overflow-hidden">
              {[
                { type: "game_ready",    desc: "Game server is ready. Send your SDP offer now." },
                { type: "rtc_answer",    desc: 'SDP answer: { type: "rtc_answer", sdp: object }' },
                { type: "rtc_candidate", desc: 'ICE candidate: { type: "rtc_candidate", candidate: string }' },
              ].map((r, i) => (
                <div key={r.type} className={`px-4 py-3 ${i < 2 ? "border-b border-[#1a1a1a]" : ""}`}>
                  <code className="text-xs font-mono text-emerald-400 block mb-1">{r.type}</code>
                  <p className="text-xs text-[#555]">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Code block>{`const pc = new RTCPeerConnection({ iceServers: ice_servers });
const ws = new WebSocket(signaling_ws);

ws.addEventListener("message", async (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === "game_ready") {
    // Add video track receiver before creating offer
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "rtc_offer", sdp: offer.sdp }));
  }

  if (msg.type === "rtc_answer") {
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: msg.sdp.sdp })
    );
  }

  if (msg.type === "rtc_candidate") {
    await pc.addIceCandidate(new RTCIceCandidate({ candidate: msg.candidate }));
  }
});

pc.addEventListener("icecandidate", (e) => {
  if (e.candidate) {
    ws.send(JSON.stringify({ type: "rtc_candidate", candidate: e.candidate.candidate }));
  }
});

pc.addEventListener("track", (e) => {
  videoElement.srcObject = e.streams[0];
});`}</Code>
      </Section>

      {/* Embed */}
      <Section id="embed" title="Embed">
        <P>
          For a zero-integration option, use the embed endpoints to drop an active session into an
          iframe. The session must already be active (i.e. <InlineCode>startGame</InlineCode> has been called).
        </P>

        <EndpointBar method="GET" path="/cloud/v1/embed?id=UUID" />
        <P>Returns an HTML page that handles WebRTC internally. Embed it as an iframe:</P>
        <Code block>{`<iframe
  src="https://api.stratus.lol/cloud/v1/embed?id=SESSION_UUID"
  width="1280"
  height="720"
  allow="autoplay; fullscreen"
  style="border: none;"
/>`}</Code>

        <EndpointBar method="GET" path="/cloud/v1/embed-data?id=UUID" />
        <P>
          Returns the raw <InlineCode>ice_servers</InlineCode> and{" "}
          <InlineCode>signaling_ws</InlineCode> for a session — useful for building custom embed pages.
          Rate-limited to 30 requests per minute per IP.
        </P>
        <Code block>{`// Response
{
  "ice_servers":  [...],
  "signaling_ws": "wss://api.stratus.lol/cloud/v1/signal/..."
}`}</Code>
      </Section>

      {/* Rate Limits */}
      <Section id="rate-limits" title="Rate Limits">
        <P>
          Rate limits are applied at two levels: per API key (configurable per-site) and per IP.
        </P>

        <p className="text-xs font-semibold text-[#555] uppercase tracking-widest mb-3">Per API key</p>
        <div className="border border-[#1a1a1a] rounded-lg overflow-hidden mb-8">
          {[
            ["per_minute",  "Requests per 60-second window"],
            ["per_hour",    "Requests per 60-minute window"],
            ["per_day",     "Requests per 24-hour window"],
            ["per_month",   "Requests per 30-day window"],
          ].map(([k, v], i) => (
            <div key={k} className={`grid grid-cols-[160px_1fr] gap-4 px-4 py-3 ${i < 3 ? "border-b border-[#1a1a1a]" : ""}`}>
              <code className="text-xs font-mono text-yellow">{k}</code>
              <span className="text-sm text-[#777]">{v}</span>
            </div>
          ))}
        </div>

        <p className="text-xs font-semibold text-[#555] uppercase tracking-widest mb-3">Per IP</p>
        <div className="border border-[#1a1a1a] rounded-lg overflow-hidden mb-8">
          {[
            ["All endpoints",   "100 requests / minute"],
            ["embed-data",      "30 requests / minute"],
            ["getQueue / ping", "1 request / 3 seconds per session"],
          ].map(([k, v], i) => (
            <div key={k} className={`grid grid-cols-[200px_1fr] gap-4 px-4 py-3 ${i < 2 ? "border-b border-[#1a1a1a]" : ""}`}>
              <code className="text-xs font-mono text-[#888]">{k}</code>
              <span className="text-sm text-[#777]">{v}</span>
            </div>
          ))}
        </div>

        <P>
          When exceeded, responses return <InlineCode>429</InlineCode> with a JSON body describing the limit hit.
          Current usage is visible in every <InlineCode>pingSession</InlineCode> response.
        </P>
      </Section>

      {/* Errors */}
      <Section id="errors" title="Errors">
        <P>All error responses use standard HTTP status codes and return a JSON body:</P>
        <Code block>{`{ "error": "Human-readable description." }`}</Code>

        <div className="border border-[#1a1a1a] rounded-lg overflow-hidden">
          {[
            ["400", "Bad Request",       "Missing or malformed parameters."],
            ["401", "Unauthorized",      "Missing or invalid x-api-key."],
            ["403", "Forbidden",         "API key is disabled, or session belongs to a different key."],
            ["404", "Not Found",         "Session UUID not found or has expired."],
            ["408", "Request Timeout",   "Request took longer than 30 seconds."],
            ["429", "Too Many Requests", "Rate limit or concurrent session cap exceeded."],
            ["500", "Server Error",      "Unexpected failure during session provisioning."],
          ].map(([code, title, desc], i, arr) => (
            <div key={code} className={`grid grid-cols-[60px_160px_1fr] gap-4 px-4 py-3 ${i < arr.length - 1 ? "border-b border-[#1a1a1a]" : ""}`}>
              <code className="text-xs font-mono text-red-400">{code}</code>
              <span className="text-xs font-mono text-[#666]">{title}</span>
              <span className="text-sm text-[#777]">{desc}</span>
            </div>
          ))}
        </div>
      </Section>

    </main>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

export function Docs() {
  const active = useActiveSection();

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <DocsNav />
      <div className="max-w-6xl mx-auto px-6 pt-14 flex gap-12">
        <Sidebar active={active} />
        <Content />
      </div>
    </div>
  );
}

export default Docs;
