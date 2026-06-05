"use client";

import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ *
 * Jarvis particle brain — a living, breathing sphere of glowing dots. *
 * ------------------------------------------------------------------ */
function JarvisBrain({ size = 168 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const N = 760;
    const pts: { x: number; y: number; z: number }[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      pts.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r });
    }

    // Mouse reactivity: the brain leans + vibrates toward the cursor anywhere on the page.
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let energy = 0;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ccx = rect.left + rect.width / 2;
      const ccy = rect.top + rect.height / 2;
      targetX = Math.max(-1, Math.min(1, ((e.clientX - ccx) / Math.max(window.innerWidth, 1)) * 2));
      targetY = Math.max(-1, Math.min(1, ((e.clientY - ccy) / Math.max(window.innerHeight, 1)) * 2));
      energy = Math.min(1, energy + 0.22);
    };
    window.addEventListener("mousemove", onMove);

    let raf = 0;
    const start = performance.now();
    const render = (now: number) => {
      const tsec = (now - start) / 1000;
      curX += (targetX - curX) * 0.07;
      curY += (targetY - curY) * 0.07;
      energy *= 0.93;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.4;
      const pulse = 1 + Math.sin(tsec * 1.35) * 0.04; // breathing
      const ay = tsec * 0.32 + curX * 0.5; // tilt toward cursor
      const ax = Math.sin(tsec * 0.17) * 0.28 - curY * 0.5;
      const cosY = Math.cos(ay);
      const sinY = Math.sin(ay);
      const cosX = Math.cos(ax);
      const sinX = Math.sin(ax);
      const shiftX = curX * size * 0.07; // drag toward cursor
      const shiftY = curY * size * 0.07;
      const vib = energy * 1.7; // subtle vibration that decays when the mouse stops

      const proj = pts
        .map((p) => {
          const x = p.x * cosY - p.z * sinY;
          const z = p.x * sinY + p.z * cosY;
          const y2 = p.y * cosX - z * sinX;
          const z2 = p.y * sinX + z * cosX;
          return { x, y: y2, z: z2, sy: p.y, sx: p.x };
        })
        .sort((a, b) => a.z - b.z);

      for (const p of proj) {
        const depth = (p.z + 1) / 2; // 0 back .. 1 front
        const px = cx + p.x * baseR * pulse + shiftX + Math.sin(tsec * 38 + p.sy * 10) * vib;
        const py = cy + p.y * baseR * pulse + shiftY + Math.cos(tsec * 38 + p.sx * 10) * vib;
        const sz = 0.6 + depth * 1.9;
        const wave = 0.5 + 0.5 * Math.sin(tsec * 2 + p.sy * 6 + p.sx * 3);
        const alpha = (0.1 + depth * 0.78) * (0.55 + 0.45 * wave);
        const rr = Math.round(201 + depth * 40);
        const gg = Math.round(169 + depth * 55);
        const bb = Math.round(110 + depth * 125);
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rr},${gg},${bb},${alpha})`;
        ctx.shadowColor = `rgba(201,169,110,${alpha * 0.85})`;
        ctx.shadowBlur = sz * 2.4;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, [size]);

  return (
    <div className="cmo-brain-wrap">
      <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />
    </div>
  );
}

/* --------- tiny, safe markdown -> html (renders the real skill files) --------- */
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
  const lines = String(md || "").split("\n");
  let html = "";
  let i = 0;
  let list: string | null = null;
  const closeList = () => {
    if (list) {
      html += "</" + list + ">";
      list = null;
    }
  };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) {
      closeList();
      i++;
      let code = "";
      while (i < lines.length && !/^```/.test(lines[i])) {
        code += lines[i] + "\n";
        i++;
      }
      i++;
      html += "<pre>" + esc(code.replace(/\n$/, "")) + "</pre>";
      continue;
    }
    if (/^\s*$/.test(ln)) {
      closeList();
      i++;
      continue;
    }
    if (/^---+\s*$/.test(ln)) {
      closeList();
      html += "<hr/>";
      i++;
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      html += "<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">";
      i++;
      continue;
    }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        html += "<ol>";
      }
      html += "<li>" + inline(ol[1]) + "</li>";
      i++;
      continue;
    }
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        html += "<ul>";
      }
      html += "<li>" + inline(ul[1]) + "</li>";
      i++;
      continue;
    }
    closeList();
    html += "<p>" + inline(ln) + "</p>";
    i++;
  }
  closeList();
  return html;
}

type Skill = {
  id: string;
  name: string;
  emoji?: string;
  accent?: string;
  tagline?: string;
  selfImproving?: boolean;
  path?: string;
  description?: string;
  markdown?: string;
};
type Meeting = {
  id: string;
  date?: string;
  title: string;
  creator?: string;
  accent?: string;
  tags?: string[];
  summary?: string;
  notes?: string;
};
type FeedEntry = {
  at?: string;
  bucket?: string;
  title: string;
  detail?: string;
  tags?: string[];
  where?: string;
};

export default function CmoPage() {
  const [tab, setTab] = useState<"skills" | "meetings" | "feed">("feed");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);
  const [account, setAccount] = useState("all");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    let off = false;
    fetch("/skills-data.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        setSkills(Array.isArray(d?.skills) ? d.skills : []);
      })
      .catch(() => {});
    fetch("/meetings-data.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        setMeetings(Array.isArray(d?.meetings) ? d.meetings : []);
      })
      .catch(() => {});
    fetch("/memory-log.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        setFeed(Array.isArray(d?.entries) ? d.entries : []);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const activeSkill = openSkill ? skills.find((s) => s.id === openSkill) : null;
  const activeMeeting = openMeeting ? meetings.find((m) => m.id === openMeeting) : null;
  const inDetail = (tab === "skills" && activeSkill) || (tab === "meetings" && activeMeeting);

  return (
    <div className="cmo-page">
      <CmoStyles />

      {/* Header: the brain + title, with the standard top filters on the right */}
      <div className="cmo-head">
        <div className="cmo-head-left">
          <JarvisBrain size={150} />
          <div>
            <h1 className="cmo-title">CMO</h1>
            <p className="cmo-sub">
              Your AI CMO&apos;s brain. The skills it runs and the context from your meetings, always current.
            </p>
          </div>
        </div>
        <div className="cmo-filters">
          <label className="cmo-filter">
            <span>Account</span>
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="all">All accounts</option>
              <option value="tyson">Tyson</option>
              <option value="keith">Keith</option>
              <option value="lucy">Lucy</option>
              <option value="antoine">Antoine</option>
            </select>
          </label>
          <div className="cmo-seg">
            {["active", "finished", "all"].map((s) => (
              <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
                {s === "active" ? "Active" : s === "finished" ? "Finished" : "All"}
              </button>
            ))}
          </div>
          <label className="cmo-filter">
            <span>Range</span>
            <select defaultValue="month">
              <option value="month">This month</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>
      </div>

      {/* Tabs */}
      {!inDetail && (
        <div className="cmo-tabs">
          <button
            className={tab === "feed" ? "on" : ""}
            onClick={() => {
              setTab("feed");
              setOpenSkill(null);
              setOpenMeeting(null);
            }}
          >
            Learning feed
          </button>
          <button
            className={tab === "skills" ? "on" : ""}
            onClick={() => {
              setTab("skills");
              setOpenMeeting(null);
            }}
          >
            Skills
          </button>
          <button
            className={tab === "meetings" ? "on" : ""}
            onClick={() => {
              setTab("meetings");
              setOpenSkill(null);
            }}
          >
            Meetings context
          </button>
        </div>
      )}

      {/* Back bar inside a detail */}
      {inDetail && (
        <button
          className="cmo-back"
          onClick={() => {
            setOpenSkill(null);
            setOpenMeeting(null);
          }}
        >
          ← All {tab === "skills" ? "skills" : "meetings"}
        </button>
      )}

      {/* LEARNING FEED — the live window into what the brain has captured */}
      {tab === "feed" && (
        <div className="cmo-feed">
          <p className="cmo-feed-intro">
            A live record of what your CMO has learned and written to memory, newest first. Every rule,
            correction, person, offer, and meeting it captured shows up here, so you can always see the brain learning.
          </p>
          {feed.map((e, i) => (
            <div key={i} className="cmo-feed-row">
              <div className="cmo-feed-time">{e.at}</div>
              <div className="cmo-feed-body">
                <div className="cmo-feed-head">
                  {e.bucket && <span className="cmo-feed-bucket">{e.bucket}</span>}
                  <span className="cmo-feed-title">{e.title}</span>
                </div>
                {e.detail && <div className="cmo-feed-detail">{e.detail}</div>}
                <div className="cmo-feed-meta">
                  {Array.isArray(e.tags) &&
                    e.tags.map((t, j) => (
                      <span key={j} className="cmo-chip">
                        {t}
                      </span>
                    ))}
                  {e.where && <span className="cmo-feed-where">→ {e.where}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SKILLS */}
      {tab === "skills" &&
        (activeSkill ? (
          <SkillDetail skill={activeSkill} />
        ) : (
          <div className="cmo-grid">
            {skills.map((s) => (
              <button
                key={s.id}
                className="cmo-card"
                style={{ "--accent": s.accent || "#c9a96e" } as React.CSSProperties}
                onClick={() => setOpenSkill(s.id)}
              >
                <div className="cmo-card-top">
                  <span className="cmo-emoji">{s.emoji}</span>
                  {s.selfImproving && <span className="cmo-badge">self-improving</span>}
                </div>
                <div className="cmo-card-name">{s.name}</div>
                <div className="cmo-card-tag">{s.tagline}</div>
                <div className="cmo-card-desc">{s.description}</div>
                <div className="cmo-card-foot">
                  <span className="cmo-open">Open →</span>
                  <span className="cmo-foot-x">read the file →</span>
                </div>
              </button>
            ))}
          </div>
        ))}

      {/* MEETINGS */}
      {tab === "meetings" &&
        (activeMeeting ? (
          <MeetingDetail meeting={activeMeeting} />
        ) : meetings.length ? (
          <div className="cmo-grid">
            {meetings.map((m) => (
              <button
                key={m.id}
                className="cmo-card"
                style={{ "--accent": m.accent || "#8b7cf6" } as React.CSSProperties}
                onClick={() => setOpenMeeting(m.id)}
              >
                <div className="cmo-card-top">
                  <span className="cmo-emoji">🎙️</span>
                  {m.date && <span className="cmo-badge">{m.date}</span>}
                </div>
                <div className="cmo-card-name">{m.title}</div>
                {m.creator && <div className="cmo-card-tag">{m.creator}</div>}
                {m.summary && <div className="cmo-card-desc">{m.summary}</div>}
                {Array.isArray(m.tags) && m.tags.length > 0 && (
                  <div className="cmo-chips">
                    {m.tags.slice(0, 3).map((t, i) => (
                      <span key={i} className="cmo-chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="cmo-card-foot">
                  <span className="cmo-open">Open →</span>
                  <span className="cmo-foot-x">read notes →</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="cmo-empty">
            <div className="cmo-empty-emoji">🎙️</div>
            <div className="cmo-empty-title">No meeting context yet</div>
            <div className="cmo-empty-sub">
              Paste your Fathom transcripts and they&apos;ll live here as context for ads, offers, and messaging.
            </div>
          </div>
        ))}
    </div>
  );
}

function SkillDetail({ skill }: { skill: Skill }) {
  return (
    <div className="cmo-detail" style={{ "--accent": skill.accent || "#c9a96e" } as React.CSSProperties}>
      <div className="cmo-detail-head">
        <span className="cmo-emoji big">{skill.emoji}</span>
        <div>
          <div className="cmo-detail-name">
            {skill.name}
            {skill.selfImproving && <span className="cmo-badge">self-improving</span>}
          </div>
          <div className="cmo-card-tag">{skill.tagline}</div>
        </div>
      </div>
      {skill.description && <div className="cmo-purpose">{skill.description}</div>}
      {skill.path && <div className="cmo-path">{skill.path}</div>}
      <div className="cmo-md" dangerouslySetInnerHTML={{ __html: mdToHtml(skill.markdown || "") }} />
    </div>
  );
}

function MeetingDetail({ meeting }: { meeting: Meeting }) {
  return (
    <div className="cmo-detail" style={{ "--accent": meeting.accent || "#8b7cf6" } as React.CSSProperties}>
      <div className="cmo-detail-head">
        <span className="cmo-emoji big">🎙️</span>
        <div>
          <div className="cmo-detail-name">{meeting.title}</div>
          <div className="cmo-card-tag">{[meeting.date, meeting.creator].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      {Array.isArray(meeting.tags) && meeting.tags.length > 0 && (
        <div className="cmo-chips" style={{ margin: "12px 0 4px" }}>
          {meeting.tags.map((t, i) => (
            <span key={i} className="cmo-chip">
              {t}
            </span>
          ))}
        </div>
      )}
      {meeting.summary && <div className="cmo-purpose">{meeting.summary}</div>}
      <div className="cmo-md" dangerouslySetInnerHTML={{ __html: mdToHtml(meeting.notes || "") }} />
    </div>
  );
}

function CmoStyles() {
  return (
    <style>{`
  .cmo-page{max-width:1160px;margin:0 auto;padding:28px 28px 80px}
  .cmo-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:24px}
  .cmo-head-left{display:flex;align-items:center;gap:18px}
  .cmo-brain-wrap{position:relative;flex:0 0 auto;border-radius:50%;background:radial-gradient(circle at 50% 45%, rgba(201,169,110,.10), rgba(201,169,110,0) 62%)}
  .cmo-brain-wrap::after{content:"";position:absolute;inset:-6px;border-radius:50%;box-shadow:0 0 60px -12px rgba(201,169,110,.35);pointer-events:none}
  .cmo-title{font-size:30px;font-weight:800;letter-spacing:-.5px;color:var(--text-primary);margin:0 0 4px}
  .cmo-sub{font-size:13px;color:var(--text-muted);max-width:460px;line-height:1.5;margin:0}
  .cmo-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cmo-filter{display:inline-flex;flex-direction:column;gap:3px;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)}
  .cmo-filter select{font-size:13px;font-weight:600;color:var(--text-primary);background:var(--bg-card);border:1px solid var(--border);border-radius:9px;padding:8px 10px;cursor:pointer;font-family:inherit}
  .cmo-seg{display:inline-flex;gap:3px;padding:3px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:9px;align-self:flex-end}
  .cmo-seg button{padding:6px 11px;border:none;background:transparent;color:var(--text-muted);font-size:12px;font-weight:650;border-radius:7px;cursor:pointer;font-family:inherit}
  .cmo-seg button.on{background:var(--bg-card);color:var(--text-primary)}
  .cmo-tabs{display:flex;align-items:center;gap:4px;padding:4px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:11px;margin-bottom:22px;width:fit-content}
  .cmo-tabs button{padding:8px 18px;border:none;background:transparent;color:var(--text-muted);font-size:13px;font-weight:650;border-radius:8px;cursor:pointer;font-family:inherit}
  .cmo-tabs button.on{background:var(--bg-card);color:var(--text-primary);box-shadow:0 1px 3px rgba(0,0,0,.18)}
  .cmo-updated{font-size:11.5px;color:var(--text-muted);margin-left:8px}
  .cmo-back{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--border);border-radius:9px;background:var(--bg-card);color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer;margin-bottom:18px;font-family:inherit;transition:transform .08s ease,border-color .12s ease}
  .cmo-back:hover{transform:translateX(-2px);border-color:var(--gold)}
  .cmo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .cmo-card{position:relative;text-align:left;display:flex;flex-direction:column;gap:9px;padding:20px 20px 16px;border:1px solid var(--border);border-radius:16px;background:var(--bg-card);cursor:pointer;overflow:hidden;font-family:inherit;transition:transform .1s ease,border-color .14s ease,box-shadow .14s ease}
  .cmo-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--accent,#c9a96e)}
  .cmo-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent,#c9a96e) 50%,var(--border));box-shadow:0 14px 32px -20px rgba(0,0,0,.6)}
  .cmo-card-top{display:flex;align-items:center;justify-content:space-between}
  .cmo-emoji{font-size:26px;line-height:1}
  .cmo-emoji.big{font-size:40px}
  .cmo-badge{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--accent,#c9a96e);background:color-mix(in srgb,var(--accent,#c9a96e) 14%,transparent);border:1px solid color-mix(in srgb,var(--accent,#c9a96e) 30%,transparent);padding:3px 8px;border-radius:999px;white-space:nowrap}
  .cmo-card-name{font-size:18px;font-weight:750;color:var(--text-primary)}
  .cmo-card-tag{font-size:13px;color:var(--accent,#c9a96e);font-weight:600}
  .cmo-card-desc{font-size:12.5px;color:var(--text-muted);line-height:1.5}
  .cmo-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .cmo-chip{font-size:11px;color:var(--text-secondary);background:var(--bg-secondary);border:1px solid var(--border);border-radius:999px;padding:4px 10px;line-height:1.3}
  .cmo-card-foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:10px;border-top:1px solid var(--border)}
  .cmo-open{font-size:12px;font-weight:700;color:var(--accent,#c9a96e)}
  .cmo-foot-x{font-size:11px;color:var(--text-muted)}
  .cmo-detail{max-width:780px}
  .cmo-detail-head{display:flex;align-items:center;gap:16px;margin-bottom:6px}
  .cmo-detail-name{font-size:24px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:12px}
  .cmo-purpose{font-size:14px;color:var(--text-secondary);margin:14px 0 4px;line-height:1.55}
  .cmo-path{font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:7px 11px;margin:10px 0 20px;display:inline-block}
  .cmo-md{font-size:13.5px;color:var(--text-secondary);line-height:1.62}
  .cmo-md h1{font-size:20px;font-weight:800;color:var(--text-primary);margin:4px 0 12px}
  .cmo-md h2{font-size:15.5px;font-weight:750;color:var(--text-primary);margin:24px 0 10px;padding-top:16px;border-top:1px solid var(--border)}
  .cmo-md h3{font-size:13.5px;font-weight:750;color:var(--text-primary);margin:16px 0 8px}
  .cmo-md p{margin:0 0 11px}
  .cmo-md strong{color:var(--text-primary);font-weight:700}
  .cmo-md em{color:var(--text-secondary);font-style:italic}
  .cmo-md ul,.cmo-md ol{margin:0 0 12px;padding-left:0;list-style:none;counter-reset:m;display:flex;flex-direction:column;gap:8px}
  .cmo-md li{position:relative;padding-left:24px}
  .cmo-md ul>li::before{content:"";position:absolute;left:5px;top:8px;width:6px;height:6px;border-radius:50%;background:var(--accent,#c9a96e)}
  .cmo-md ol>li{counter-increment:m}
  .cmo-md ol>li::before{content:counter(m);position:absolute;left:0;top:0;width:18px;height:18px;border-radius:6px;background:color-mix(in srgb,var(--accent,#c9a96e) 16%,transparent);color:var(--accent,#c9a96e);font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .cmo-md code{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:1px 5px;color:var(--text-primary)}
  .cmo-md pre{margin:0 0 12px;padding:13px 14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12.5px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.5}
  .cmo-md pre code{background:none;border:none;padding:0}
  .cmo-md hr{border:none;border-top:1px solid var(--border);margin:18px 0}
  .cmo-feed{display:flex;flex-direction:column;gap:0}
  .cmo-feed-intro{font-size:13px;color:var(--text-muted);max-width:660px;line-height:1.55;margin:0 0 20px}
  .cmo-feed-row{display:flex;gap:16px;padding:16px 0;border-bottom:1px solid var(--border)}
  .cmo-feed-row:first-of-type{padding-top:0}
  .cmo-feed-time{flex:0 0 92px;font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;padding-top:3px;font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-feed-body{flex:1;min-width:0}
  .cmo-feed-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:5px}
  .cmo-feed-bucket{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gold);background:color-mix(in srgb,var(--gold) 13%,transparent);border:1px solid color-mix(in srgb,var(--gold) 30%,transparent);padding:3px 8px;border-radius:999px;white-space:nowrap}
  .cmo-feed-title{font-size:14px;font-weight:700;color:var(--text-primary)}
  .cmo-feed-detail{font-size:12.5px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px}
  .cmo-feed-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .cmo-feed-where{font-size:11px;color:var(--text-muted);font-style:italic}
  .cmo-empty{text-align:center;padding:64px 24px;border:1px dashed var(--border);border-radius:16px;background:var(--bg-secondary)}
  .cmo-empty-emoji{font-size:42px;margin-bottom:14px}
  .cmo-empty-title{font-size:17px;font-weight:750;color:var(--text-primary);margin-bottom:8px}
  .cmo-empty-sub{font-size:13px;color:var(--text-muted);line-height:1.55;max-width:460px;margin:0 auto}
    `}</style>
  );
}
