"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Copy,
  Cpu,
  Gamepad2,
  MapPinned,
  RefreshCcw,
  Rocket,
  Shirt,
  Sparkles,
  Users,
  Wrench,
  Zap
} from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "Highly Optimized Scripts",
    text: "Performance-first resources designed to keep client and server frame time smooth."
  },
  {
    icon: MapPinned,
    title: "Highly Optimized MLO",
    text: "Curated interiors and map assets with a focus on sensible texture and poly budgets."
  },
  {
    icon: Shirt,
    title: "More Clothing",
    text: "Expanded civilian, faction, and lifestyle clothing choices for better character identity."
  },
  {
    icon: Cpu,
    title: "Optimized Clothing",
    text: "Organized clothing packs and streaming-friendly assets built to reduce unnecessary load."
  },
  {
    icon: Gamepad2,
    title: "Immersive Roleplay",
    text: "Systems designed around meaningful jobs, factions, businesses, progression, and player stories."
  },
  {
    icon: Sparkles,
    title: "Next-Gen Experience",
    text: "A polished presentation, responsive UI, and live server information right on the website."
  }
];

function Pill({ children, online = false }) {
  return (
    <span className={`pill ${online ? "online" : ""}`}>
      <span className="pill-dot" />
      {children}
    </span>
  );
}

export default function HomePage() {
  const [status, setStatus] = useState({
    loading: true,
    online: false,
    hostname: "Donut City",
    players: [],
    clients: 0,
    maxClients: 0,
    joinCode: process.env.NEXT_PUBLIC_FIVEM_JOIN_CODE || "alq4yz",
    error: null
  });

  const [copied, setCopied] = useState(false);
  const [updates, setUpdates] = useState([]);

  const refresh = async () => {
    setStatus((s) => ({ ...s, loading: true, error: null }));

    try {
      const response = await fetch("/api/server-status", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to load server status");
      }

      setStatus({ ...data, loading: false });
    } catch (error) {
      setStatus((s) => ({
        ...s,
        loading: false,
        online: false,
        error: error.message
      }));
    }
  };

  const loadUpdates = async () => {
    try {
      const response = await fetch("/api/updates", { cache: "no-store" });
      const data = await response.json();
      setUpdates(Array.isArray(data.updates) ? data.updates : []);
    } catch {
      setUpdates([]);
    }
  };

  useEffect(() => {
    refresh();
    loadUpdates();

    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);

  const joinUrl = useMemo(() => {
    if (!status.joinCode || status.joinCode === "YOUR_JOIN_CODE") return "#";
    return `https://cfx.re/join/${status.joinCode}`;
  }, [status.joinCode]);

  const occupancy = useMemo(() => {
    if (!status.online || !status.maxClients) return 0;
    return Math.min(100, Math.round((status.clients / status.maxClients) * 100));
  }, [status.online, status.clients, status.maxClients]);

  const copyJoinCode = async () => {
    if (!status.joinCode || status.joinCode === "YOUR_JOIN_CODE") return;
    await navigator.clipboard.writeText(status.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main>
      <div className="bg-grid" />
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <nav className="nav">
        <a className="brand" href="#top" aria-label="Donut City home">
          <img src="/logo.svg" alt="Donut City logo" />
          <div>
            <strong>DONUT CITY</strong>
            <span>Next Generation Role Play</span>
          </div>
        </a>

        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#status">Status</a>
          <a href="#updates">Updates</a>
          <a href="#connect">Connect</a>
        </div>

        <a className="button button-small button-outline" href="#connect">
          Play Now
        </a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <Activity size={16} />
            FiveM Roleplay • Next Generation
          </div>

          <h1>
            Welcome to <span>Donut City</span>
          </h1>

          <p className="hero-text">
            A performance-focused FiveM roleplay experience built around optimized scripts,
            optimized MLOs, expanded clothing, immersive systems, and a community-first city.
          </p>

          <div className="hero-actions">
            <a
              className="button button-primary"
              href={joinUrl}
              target={joinUrl === "#" ? undefined : "_blank"}
            >
              Connect to Server
              <ArrowRight size={18} />
            </a>

            <a
              className="button button-ghost"
              href={process.env.NEXT_PUBLIC_DISCORD_URL || "https://discord.gg/pv8FUfdqXz"}
              target="_blank"
            >
              Join Discord
            </a>
          </div>

          <div className="quick-stats">
            <div>
              <strong>{status.online ? status.clients : "—"}</strong>
              <span>Players Online</span>
            </div>
            <div>
              <strong>{status.online ? status.maxClients : "—"}</strong>
              <span>Server Slots</span>
            </div>
            <div>
              <strong>30s</strong>
              <span>Live Refresh</span>
            </div>
          </div>
        </div>

        <div className="hero-card">
          <div className="hero-logo-wrap">
            <img src="/logo.svg" alt="Donut City emblem" className="hero-logo" />
          </div>

          <div className="server-mini">
            <div>
              <Pill online={status.online}>
                {status.loading
                  ? "Checking server..."
                  : status.online
                    ? "Server Online"
                    : "Server Offline"}
              </Pill>
              <h3>{status.hostname || "Donut City"}</h3>
            </div>

            <span className="player-count">
              <Users size={18} />
              {status.online ? `${status.clients}/${status.maxClients}` : "—"}
            </span>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-heading">
          <span>Why Donut City</span>
          <h2>Built for smoother, richer roleplay.</h2>
          <p>
            Performance, customization, and immersive roleplay are at the center of the Donut City
            experience.
          </p>
        </div>

        <div className="feature-grid">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article className="feature-card" key={title}>
              <div className="icon-box">
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="status">
        <div className="section-heading row-heading">
          <div>
            <span>Live City Status</span>
            <h2>See how active the city is.</h2>
            <p>
              Player count refreshes automatically every 30 seconds. Individual player names are
              kept hidden.
            </p>
          </div>

          <button className="button button-ghost" onClick={refresh} disabled={status.loading}>
            <RefreshCcw size={17} className={status.loading ? "spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="compact-status-card">
          <div className="compact-status-main">
            <div className="compact-status-copy">
              <Pill online={status.online}>
                {status.loading ? "Checking" : status.online ? "Live" : "Offline"}
              </Pill>
              <h3>{status.hostname || "Donut City"}</h3>
              <p>
                {status.loading
                  ? "Checking the city..."
                  : status.online
                    ? `${status.clients} ${status.clients === 1 ? "player is" : "players are"} currently in the city.`
                    : "The city is currently unavailable."}
              </p>
            </div>

            <div className="count-display">
              <Users size={28} />
              <strong>{status.online ? status.clients : 0}</strong>
              <span>/ {status.online ? status.maxClients : 0}</span>
              <small>ONLINE PLAYERS</small>
            </div>
          </div>

          <div className="capacity-track" aria-label="Server capacity">
            <div className="capacity-fill" style={{ width: `${occupancy}%` }} />
          </div>

          <div className="capacity-meta">
            <span>{occupancy}% capacity</span>
            <span>Auto refresh • 30 seconds</span>
          </div>

          {status.error && <div className="notice">{status.error}</div>}
        </div>
      </section>

      <section className="section" id="updates">
        <div className="section-heading">
          <span>Server Development</span>
          <h2>Updates & Patch Notes.</h2>
          <p>
            New features, optimizations, fixes, and server changes can be posted here so players
            always know what changed.
          </p>
        </div>

        <div className="updates-grid">
          {updates.map((update, updateIndex) => (
            <article
              className={`update-card ${update.featured ? "featured-update" : ""}`}
              key={`${update.id || update.version || "update"}-${updateIndex}`}
            >
              <div className="update-card-top">
                <div className="update-version">
                  {update.type === "Roadmap" ? <Rocket size={19} /> : <Wrench size={19} />}
                  <span>{update.version}</span>
                </div>

                <div className="update-date">
                  <CalendarDays size={15} />
                  {update.date}
                </div>
              </div>

              <div className="update-type">{update.type}</div>
              <h3>{update.title}</h3>

              <ul className="patch-list">
                {update.notes.map((note, noteIndex) => (
                  <li key={`${update.id || updateIndex}-note-${noteIndex}`}>
                    <span />
                    {note}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section connect-section" id="connect">
        <div className="connect-card">
          <div>
            <span className="mini-label">Ready to enter the city?</span>
            <h2>Connect to Donut City.</h2>
            <p>
              Use the FiveM join code below. The main button opens the Cfx.re connect page directly.
            </p>
          </div>

          <div className="connect-actions">
            <button className="join-code" onClick={copyJoinCode} title="Copy join code">
              <span>{status.joinCode || "alq4yz"}</span>
              <Copy size={18} />
              {copied && <em>Copied!</em>}
            </button>

            <a
              className="button button-primary"
              href={joinUrl}
              target={joinUrl === "#" ? undefined : "_blank"}
            >
              Launch FiveM
              <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand">
          <img src="/logo.svg" alt="" />
          <div>
            <strong>DONUT CITY</strong>
            <span>Next Generation Role Play</span>
          </div>
        </div>

        <p>
          © {new Date().getFullYear()} Donut City. FiveM is a trademark of Cfx.re/FiveM.
          {" "}·{" "}<a href="/admin" className="footer-admin-link">Admin</a>
        </p>
      </footer>
    </main>
  );
}
