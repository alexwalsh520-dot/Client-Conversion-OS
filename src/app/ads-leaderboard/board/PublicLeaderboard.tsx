"use client";

import { useEffect, useMemo, useState } from "react";

const C = {
  bg: "#070708",
  card: "rgba(22,22,26,0.55)",
  line: "rgba(255,255,255,0.08)",
  text: "#f6f6f8",
  sub: "#9a9aa6",
  gold: "#d8b878",
  gold2: "#c9a96e",
  green: "#5fdb8e",
};

interface BoardEntry {
  id: string;
  name: string;
  creator: string | null;
  videoUrl: string | null;
  live: boolean;
  rank: number;
}

export default function PublicLeaderboard() {
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ads-leaderboard/public");
        const data = await res.json();
        if (res.ok) setEntries(data.entries || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  // Always show a full, alive-looking board: pad the grid with "open slot" cards.
  const placeholders = useMemo(() => {
    const target = Math.max(6, Math.ceil((rest.length + 1) / 3) * 3);
    return Math.max(0, target - rest.length);
  }, [rest.length]);

  return (
    <div className="ads-lb-fullbleed plb-root">
      <div className="plb-bg" aria-hidden />

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "56px 22px 100px", position: "relative", zIndex: 1 }}>
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="plb-badge">🏆 The Leaderboard</div>
          <h1 style={{ fontSize: 44, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.05, margin: "18px 0 14px" }}>
            Real clients. Real stories.<br /><span className="plb-grad">Real money.</span>
          </h1>
          <p style={{ color: C.sub, fontSize: 17, lineHeight: 1.6, maxWidth: 540, margin: "0 auto" }}>
            Our clients turn their transformation into an ad — and get paid when their story brings new people in. The
            best ad each month earns big.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div className="plb-spin" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyBoard />
        ) : (
          <>
            {/* Podium */}
            {podium.length > 0 && (
              <div className="plb-podium">
                {orderPodium(podium).map((e) => (
                  <PodiumCard key={e.id} entry={e} />
                ))}
              </div>
            )}

            {/* The rest + open slots */}
            {(rest.length > 0 || placeholders > 0) && (
              <>
                <h2 className="plb-section">The contenders</h2>
                <div className="plb-grid">
                  {rest.map((e) => <RowCard key={e.id} entry={e} />)}
                  {Array.from({ length: placeholders }).map((_, i) => <OpenSlot key={`ph-${i}`} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <Styles />
    </div>
  );
}

// Podium visual order: 2nd, 1st, 3rd (1st centered + tallest).
function orderPodium(p: BoardEntry[]): BoardEntry[] {
  if (p.length === 3) return [p[1], p[0], p[2]];
  return p;
}

function PodiumCard({ entry }: { entry: BoardEntry }) {
  const isFirst = entry.rank === 1;
  const medal = entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : "🥉";
  return (
    <div className={`plb-podCard ${isFirst ? "plb-podCard-1" : ""}`}>
      {isFirst && <div className="plb-crown">👑</div>}
      <div className="plb-medal">{medal}</div>
      <div className="plb-video-wrap">
        {entry.videoUrl ? (
          <video src={entry.videoUrl} controls playsInline preload="metadata" className="plb-video" />
        ) : (
          <Placeholder />
        )}
        {entry.live && <span className="plb-live">● LIVE</span>}
      </div>
      <div className="plb-name">{entry.name}</div>
      {entry.creator && <div className="plb-creator">{entry.creator}</div>}
    </div>
  );
}

function RowCard({ entry }: { entry: BoardEntry }) {
  return (
    <div className="plb-rowCard">
      <div className="plb-rank">#{entry.rank}</div>
      <div className="plb-video-wrap">
        {entry.videoUrl ? (
          <video src={entry.videoUrl} controls playsInline preload="metadata" className="plb-video" />
        ) : (
          <Placeholder />
        )}
        {entry.live && <span className="plb-live">● LIVE</span>}
      </div>
      <div className="plb-name">{entry.name}</div>
      {entry.creator && <div className="plb-creator">{entry.creator}</div>}
    </div>
  );
}

function OpenSlot() {
  return (
    <div className="plb-rowCard plb-open">
      <div className="plb-video-wrap plb-open-wrap">
        <div style={{ textAlign: "center", color: C.sub }}>
          <div style={{ fontSize: 26, marginBottom: 8, opacity: 0.6 }}>＋</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Your ad<br />could be here</div>
        </div>
      </div>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="plb-ph">
      <div style={{ fontSize: 30, opacity: 0.5 }}>🎬</div>
      <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>Preview coming soon</div>
    </div>
  );
}

function EmptyBoard() {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div className="plb-grid">
        {Array.from({ length: 6 }).map((_, i) => <OpenSlot key={i} />)}
      </div>
      <p style={{ color: C.sub, marginTop: 28, fontSize: 15 }}>
        The board is just getting started. The first ads are on their way. 🚀
      </p>
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .plb-root { min-height: 100vh; background: ${C.bg}; color: ${C.text}; position: relative; overflow-x: hidden; font-family: var(--font-geist-sans), -apple-system, sans-serif; }
      .plb-bg {
        position: fixed; inset: 0; z-index: 0; pointer-events: none;
        background:
          radial-gradient(55% 45% at 50% -8%, rgba(216,184,120,0.18), transparent 70%),
          radial-gradient(40% 38% at 88% 12%, rgba(126,201,160,0.08), transparent 70%),
          radial-gradient(45% 40% at 8% 75%, rgba(216,184,120,0.07), transparent 70%),
          ${C.bg};
      }
      .plb-grad { background: linear-gradient(95deg, ${C.gold}, #f2dca6 45%, ${C.gold2}); -webkit-background-clip: text; background-clip: text; color: transparent; }
      .plb-badge { display: inline-block; font-size: 12.5px; font-weight: 700; letter-spacing: .07em; color: ${C.gold}; background: rgba(216,184,120,0.12); border: 1px solid rgba(216,184,120,0.25); padding: 7px 15px; border-radius: 999px; }
      .plb-section { font-size: 14px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${C.sub}; text-align: center; margin: 44px 0 20px; }

      .plb-podium { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: end; }
      @media (max-width: 640px) { .plb-podium { grid-template-columns: 1fr; } }

      .plb-podCard, .plb-rowCard {
        background: ${C.card}; border: 1px solid ${C.line}; border-radius: 18px; padding: 14px;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 14px 44px rgba(0,0,0,0.4);
        position: relative; animation: plbIn .5s cubic-bezier(.16,.84,.44,1) both;
      }
      @keyframes plbIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
      .plb-podCard-1 { border-color: rgba(216,184,120,0.5); box-shadow: 0 0 0 1px rgba(216,184,120,0.3), 0 0 60px rgba(216,184,120,0.16), 0 16px 50px rgba(0,0,0,0.5); transform: translateY(-12px); }
      @media (max-width: 640px) { .plb-podCard-1 { transform: none; } }

      .plb-crown { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 26px; filter: drop-shadow(0 2px 6px rgba(216,184,120,0.5)); animation: plbBob 2.4s ease-in-out infinite; }
      @keyframes plbBob { 0%,100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-4px); } }
      .plb-medal { position: absolute; top: 8px; left: 12px; z-index: 2; font-size: 22px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
      .plb-rank { position: absolute; top: 10px; left: 14px; z-index: 2; font-size: 14px; font-weight: 800; color: ${C.gold}; background: rgba(0,0,0,0.5); padding: 2px 9px; border-radius: 999px; backdrop-filter: blur(4px); }

      .plb-video-wrap { position: relative; aspect-ratio: 9 / 12; border-radius: 12px; overflow: hidden; background: #000; }
      .plb-video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .plb-live { position: absolute; top: 8px; right: 8px; font-size: 10px; font-weight: 800; letter-spacing: .06em; color: ${C.green}; background: rgba(0,0,0,0.55); padding: 3px 8px; border-radius: 999px; backdrop-filter: blur(4px); }

      .plb-ph, .plb-open-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
      .plb-ph { background: repeating-linear-gradient(45deg, rgba(255,255,255,0.015), rgba(255,255,255,0.015) 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 20px); }

      .plb-name { font-size: 16px; font-weight: 700; margin-top: 12px; text-align: center; }
      .plb-creator { font-size: 12px; color: ${C.gold}; text-align: center; margin-top: 2px; text-transform: capitalize; }

      .plb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      @media (max-width: 760px) { .plb-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 460px) { .plb-grid { grid-template-columns: 1fr; } }

      .plb-open { border-style: dashed; opacity: 0.7; }
      .plb-open .plb-video-wrap { background: transparent; border: 1px dashed ${C.line}; }

      .plb-spin { width: 34px; height: 34px; border: 3px solid rgba(255,255,255,0.1); border-top-color: ${C.gold}; border-radius: 50%; margin: 0 auto; animation: plbSpin .8s linear infinite; }
      @keyframes plbSpin { to { transform: rotate(360deg); } }

      @media (prefers-reduced-motion: reduce) { .plb-podCard, .plb-rowCard, .plb-crown { animation: none !important; } }
    `}</style>
  );
}
