import { useEffect, useRef, useState } from "react";
import "./index.css";
import logoSrc from "./logo.webp";

// ── Scroll animation hook ───────────────────────────────────────────────────

function useInView(threshold = 0.1) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, visible] as const;
}

// ── Minimal syntax highlighter ──────────────────────────────────────────────

const KW = new Set([
  "const", "let", "var", "async", "await", "return", "if", "else",
  "for", "of", "while", "true", "false", "null", "new", "import",
  "from", "export", "break", "function",
]);

type Token = { text: string; color: string };

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let s = code;

  while (s.length) {
    // Line comment
    if (s.startsWith("//")) {
      const end = s.indexOf("\n");
      const text = end === -1 ? s : s.slice(0, end);
      tokens.push({ text, color: "#4b5563" });
      s = end === -1 ? "" : s.slice(end);
      continue;
    }

    // String (single/double/template)
    const strM = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/.exec(s);
    if (strM) {
      tokens.push({ text: strM[1], color: "#86efac" });
      s = s.slice(strM[1].length);
      continue;
    }

    // Number
    const numM = /^(\b\d+\.?\d*\b)/.exec(s);
    if (numM) {
      tokens.push({ text: numM[1], color: "#fca5a5" });
      s = s.slice(numM[1].length);
      continue;
    }

    // Identifier — keyword, function call, or plain
    const idM = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(s);
    if (idM) {
      const word = idM[1];
      const after = s.slice(word.length).trimStart();
      const color = KW.has(word)
        ? "#D4F000"
        : after.startsWith("(")
        ? "#93c5fd"
        : "#f1f5f9";
      tokens.push({ text: word, color });
      s = s.slice(word.length);
      continue;
    }

    // Punctuation / whitespace / everything else
    tokens.push({ text: s[0], color: "#94a3b8" });
    s = s.slice(1);
  }

  return tokens;
}

function Code({ children }: { children: string }) {
  return (
    <code>
      {tokenize(children).map((t, i) => (
        <span key={i} style={{ color: t.color }}>
          {t.text}
        </span>
      ))}
    </code>
  );
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function IconMonitor() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function IconZap() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconCode() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

// ── Nav ─────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#1a1a1a] bg-[#0a0a0a]/90 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5" aria-label="Stratus API home">
          <img src={logoSrc} alt="" width="22" height="22" className="opacity-90" />
          <span className="font-semibold text-sm tracking-tight text-white">Stratus</span>
          <span className="text-[#333] text-sm font-light hidden sm:inline">API</span>
        </a>

        <nav className="hidden md:flex items-center gap-8" aria-label="Primary">
          <a href="#features" className="text-sm text-[#888] hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" className="text-sm text-[#888] hover:text-white transition-colors">How it works</a>
          <a href="#quickstart" className="text-sm text-[#888] hover:text-white transition-colors">Quickstart</a>
          <a href="/docs" className="text-sm text-[#888] hover:text-white transition-colors">Docs</a>
        </nav>

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

// ── Hero ─────────────────────────────────────────────────────────────────────

const HERO_CODE = `const res = await fetch(
  "https://api.stratus.lol/cloud/v1/createSession",
  {
    method: "POST",
    headers: {
      "x-api-key": "sk_live_xxxxxxxxxxxxxxxx",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      game_key: "gta_v",
    }),
  }
);

// Stream NDJSON status events
for await (const event of streamNDJSON(res)) {
  if (event.status === "finished_queue") {
    const { ice_servers, signaling_ws } =
      await post("/cloud/v1/startGame", { uuid: event.uuid });
    // Connect your WebRTC client
  }
}`;

function HeroCodeWindow() {
  return (
    <div className="bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[#1a1a1a]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#2a2a2a]" aria-hidden="true" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#2a2a2a]" aria-hidden="true" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#2a2a2a]" aria-hidden="true" />
        <span className="ml-3 text-[#3a3a3a] text-xs font-mono">createSession.js</span>
      </div>
      <pre className="px-5 py-5 overflow-x-auto text-[13px] leading-[1.7] font-mono">
        <Code>{HERO_CODE}</Code>
      </pre>
    </div>
  );
}

function Hero() {
  return (
    <section className="pt-14 min-h-screen flex items-center" aria-label="Hero">
      <div className="max-w-6xl mx-auto px-6 py-24 w-full grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-yellow border border-yellow/20 bg-yellow/5 px-3 py-1.5 rounded mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow" aria-hidden="true" />
            Free · No credit card required
          </div>

          <h1 className="text-5xl md:text-[64px] font-black tracking-[-0.03em] leading-[1.0] text-white mb-6">
            Cloud game<br />streaming for<br />developers.
          </h1>

          <p className="text-[#888] text-lg leading-relaxed mb-10 max-w-[420px]">
            A REST API that provisions cloud gaming sessions for 180+ titles —
            GTA V, Minecraft: Dungeons, Poppy Playtime, and more.
            Handle WebRTC, session lifecycle, and TURN infrastructure with a single POST request.
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              href="mailto:channelediting521@gmail.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-yellow text-black text-sm font-semibold rounded hover:opacity-90 transition-opacity"
            >
              Request API Access
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#2a2a2a] text-white text-sm font-medium rounded hover:border-[#444] transition-colors"
            >
              See how it works
            </a>
          </div>

          <dl className="mt-12 flex gap-8 border-t border-[#1a1a1a] pt-8">
            {[
              ["180+", "games"],
              ["720p30", "everywhere"],
              ["15 min", "sessions"],
            ].map(([val, label]) => (
              <div key={label}>
                <dt className="text-2xl font-bold text-white tracking-tight">{val}</dt>
                <dd className="text-xs text-[#555] mt-0.5">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:pl-8">
          <HeroCodeWindow />
        </div>
      </div>
    </section>
  );
}

// ── Features ─────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    Icon: IconGrid,
    title: "180+ Games",
    body: "GTA V, Minecraft: Dungeons, Minecraft: Legends, Poppy Playtime ch. 1–4, and a growing library — all through one API.",
  },
  {
    Icon: IconMonitor,
    title: "720p30 Everywhere",
    body: "Hardware-accelerated WebRTC streaming that runs smooth at 720p30 even on low-end and mobile hardware.",
  },
  {
    Icon: IconClock,
    title: "15-Minute Sessions",
    body: "Clean, bounded session lifecycle with automatic cleanup. No runaway processes or leaked resources.",
  },
  {
    Icon: IconStar,
    title: "Free to Use",
    body: "No credit card. No monthly bill. Generous rate limits per API key — start building without spending a cent.",
  },
  {
    Icon: IconZap,
    title: "Fast Session Start",
    body: "Sessions provision in seconds. Google STUN + TURN relay coverage keeps latency low across regions.",
  },
  {
    Icon: IconCode,
    title: "Developer-First API",
    body: "Plain HTTP endpoints, NDJSON streaming events, and a WebSocket signaling proxy. No proprietary SDK required.",
  },
];

function Features() {
  const [ref, visible] = useInView();

  return (
    <section
      id="features"
      ref={ref as React.RefObject<HTMLElement>}
      className={`py-24 border-t border-[#1a1a1a] transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
      aria-labelledby="features-heading"
    >
      <div className="max-w-6xl mx-auto px-6">
        <header className="mb-14">
          <p className="text-xs font-semibold text-yellow tracking-widest uppercase mb-3">Features</p>
          <h2 id="features-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Everything you need to ship.
          </h2>
        </header>

        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[#1a1a1a]" role="list">
          {FEATURES.map(({ Icon, title, body }) => (
            <li key={title} className="bg-[#0a0a0a] p-7">
              <div className="w-8 h-8 rounded flex items-center justify-center text-yellow mb-4 border border-yellow/15 bg-yellow/5">
                <Icon />
              </div>
              <h3 className="font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-[#666] leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── How it Works ─────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    title: "Get your API key",
    body: "Request access and receive an API key. No approval queue — keys are issued immediately.",
    detail: "Your key is sent with every request via the x-api-key header.",
  },
  {
    n: "02",
    title: "Create a session",
    body: "POST to /cloud/v1/createSession with a game_key. Read the NDJSON response stream as the session boots.",
    detail: "Events: creating_account → account_ready → requesting_game → queue → finished_queue",
  },
  {
    n: "03",
    title: "Stream via WebRTC",
    body: "Call /cloud/v1/startGame to get ICE servers and a signaling WebSocket URL.",
    detail: "Connect your WebRTC peer. The signaling proxy handles SDP offer/answer and ICE candidates.",
  },
];

function HowItWorks() {
  const [ref, visible] = useInView();

  return (
    <section
      id="how-it-works"
      ref={ref as React.RefObject<HTMLElement>}
      className={`py-24 border-t border-[#1a1a1a] transition-all duration-700 delay-100 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
      aria-labelledby="how-heading"
    >
      <div className="max-w-6xl mx-auto px-6">
        <header className="mb-14">
          <p className="text-xs font-semibold text-yellow tracking-widest uppercase mb-3">How it works</p>
          <h2 id="how-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            From zero to streaming in three steps.
          </h2>
        </header>

        <ol className="grid md:grid-cols-3 gap-px bg-[#1a1a1a]">
          {STEPS.map(({ n, title, body, detail }) => (
            <li key={n} className="bg-[#0a0a0a] p-7">
              <span className="text-5xl font-black text-[#1e1e1e] leading-none block mb-6 select-none" aria-hidden="true">
                {n}
              </span>
              <h3 className="font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-[#666] leading-relaxed mb-4">{body}</p>
              <p className="text-xs font-mono text-[#444] leading-relaxed">{detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── Quick Start ───────────────────────────────────────────────────────────────

const CURL_CODE = `# 1. Create a session (streams NDJSON events)
curl -X POST https://api.stratus.lol/cloud/v1/createSession \\
  -H "x-api-key: sk_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"game_key": "gta_v"}'

# Example response stream:
# {"status":"creating_account"}
# {"status":"account_ready"}
# {"status":"requesting_game"}
# {"status":"finished_queue","uuid":"7f3a2c...","fetch_this_within_30s_or_terminate":"/cloud/v1/startGame"}

# 2. Start the game — get WebRTC credentials
curl -X POST https://api.stratus.lol/cloud/v1/startGame \\
  -H "x-api-key: sk_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"uuid": "7f3a2c..."}'

# {"ice_servers":[...],"signaling_ws":"wss://...","max_seconds":900}`;

const JS_CODE = `async function launchGame(apiKey, gameKey) {
  // 1. Create session — read NDJSON stream
  const res = await fetch(
    "https://api.stratus.lol/cloud/v1/createSession",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ game_key: gameKey }),
    }
  );

  let sessionUuid = null;
  for await (const event of streamNDJSON(res)) {
    if (event.status === "finished_queue") {
      sessionUuid = event.uuid;
      break;
    }
    if (event.status === "error") throw new Error(event.error);
  }

  // 2. Start game — receive WebRTC credentials
  const { ice_servers, signaling_ws } = await fetch(
    "https://api.stratus.lol/cloud/v1/startGame",
    {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: sessionUuid }),
    }
  ).then(r => r.json());

  // 3. Connect WebRTC using ice_servers + signaling_ws
  return connectWebRTC({ ice_servers, signaling_ws });
}`;

type Tab = "curl" | "js";

function QuickStart() {
  const [tab, setTab] = useState<Tab>("js");
  const [ref, visible] = useInView();

  const code = tab === "curl" ? CURL_CODE : JS_CODE;

  return (
    <section
      id="quickstart"
      ref={ref as React.RefObject<HTMLElement>}
      className={`py-24 border-t border-[#1a1a1a] transition-all duration-700 delay-150 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
      aria-labelledby="qs-heading"
    >
      <div className="max-w-6xl mx-auto px-6">
        <header className="mb-14">
          <p className="text-xs font-semibold text-yellow tracking-widest uppercase mb-3">Quickstart</p>
          <h2 id="qs-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Up and running in minutes.
          </h2>
        </header>

        <div className="border border-[#1a1a1a] rounded-lg overflow-hidden">
          <div className="flex items-center border-b border-[#1a1a1a] bg-[#0d0d0d]">
            {(["js", "curl"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? "border-yellow text-white"
                    : "border-transparent text-[#555] hover:text-[#999]"
                }`}
              >
                {t === "js" ? "JavaScript" : "cURL"}
              </button>
            ))}
          </div>

          <pre className="px-6 py-6 overflow-x-auto text-[13px] leading-[1.7] font-mono bg-[#0a0a0a]">
            <Code key={tab}>{code}</Code>
          </pre>
        </div>

        <div className="mt-8 grid sm:grid-cols-3 gap-4">
          {[
            { endpoint: "POST /cloud/v1/createSession", desc: "Provisions a new session, streams status events" },
            { endpoint: "POST /cloud/v1/startGame",     desc: "Activates session, returns WebRTC credentials" },
            { endpoint: "POST /cloud/v1/pingSession",   desc: "Keepalive ping + quota usage stats" },
          ].map(({ endpoint, desc }) => (
            <div key={endpoint} className="border border-[#1a1a1a] rounded p-4">
              <code className="text-xs text-yellow font-mono block mb-1.5">{endpoint}</code>
              <p className="text-xs text-[#555] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-[#1a1a1a] py-12" role="contentinfo">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <img src={logoSrc} alt="" width="18" height="18" className="opacity-60" />
          <span className="text-sm font-semibold text-[#444]">Stratus API</span>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-6">
          {[
            ["Features", "#features"],
            ["How it works", "#how-it-works"],
            ["Quickstart", "#quickstart"],
            ["Contact", "mailto:channelediting521@gmail.com"],
          ].map(([label, href]) => (
            <a key={label} href={href} className="text-xs text-[#444] hover:text-[#888] transition-colors">
              {label}
            </a>
          ))}
        </nav>

        <p className="text-xs text-[#2a2a2a]">
          &copy; {new Date().getFullYear()} Stratus API
        </p>
      </div>
    </footer>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <QuickStart />
      </main>
      <Footer />
    </div>
  );
}

export default App;
