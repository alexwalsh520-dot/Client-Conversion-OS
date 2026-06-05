"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ============================================================ *
 * Jarvis brain — a window into a living thing. All particles drift
 * constantly (neuro-bounce around their points), the whole shape
 * rotates slowly, and a soft premium glow intensifies + leans toward
 * the cursor. Color is preserved (no blown-out central dot).
 * ============================================================ */
function JarvisBrain({ size = 150 }: { size?: number }) {
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

    const N = 520;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      return {
        x: Math.cos(t) * r,
        y,
        z: Math.sin(t) * r,
        a: Math.random() * 6.28,
        b: Math.random() * 6.28,
        s: 0.4 + Math.random() * 0.7,
      };
    });

    let mx = -9999;
    let my = -9999;
    let target = 0;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      // reacts ANYWHERE on the page (base level), stronger as the cursor nears
      target = 0.45 + 0.55 * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 800);
    };
    const onLeave = () => (target = 0);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseout", onLeave);

    let raf = 0;
    const start = performance.now();
    let infl = 0;
    const render = (now: number) => {
      const t = (now - start) / 1000;
      infl += (target - infl) * 0.04; // ease very slowly
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const R = size * 0.4;
      const ay = t * 0.09;
      const ax = Math.sin(t * 0.05) * 0.18;
      const cY = Math.cos(ay), sY = Math.sin(ay), cX = Math.cos(ax), sX = Math.sin(ax);

      // direction toward the cursor (clamped) — drives a visible whole-sphere lean ANYWHERE
      const dirX = mx > -9000 ? Math.max(-1, Math.min(1, (mx - cx) / (size * 1.1))) : 0;
      const dirY = my > -9000 ? Math.max(-1, Math.min(1, (my - cy) / (size * 1.1))) : 0;
      const shiftX = dirX * size * 0.2 * infl;
      const shiftY = dirY * size * 0.2 * infl;

      // soft aura that leans + brightens toward the cursor (no hard central dot)
      const grad = ctx.createRadialGradient(cx + dirX * R * 0.55, cy + dirY * R * 0.55, 0, cx, cy, R * 1.5);
      grad.addColorStop(0, `rgba(201,169,110,${0.08 + 0.18 * infl})`);
      grad.addColorStop(1, "rgba(201,169,110,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
      ctx.fill();

      const proj = pts.map((p) => {
        // constant organic wobble around the point (more alive)
        const ox = 0.09 * Math.sin(t * 0.9 * p.s + p.a);
        const oy = 0.09 * Math.sin(t * 0.8 * p.s + p.b);
        const oz = 0.09 * Math.cos(t * 0.85 * p.s + p.a);
        const x0 = p.x + ox, y0 = p.y + oy, z0 = p.z + oz;
        const x = x0 * cY - z0 * sY;
        const z = x0 * sY + z0 * cY;
        const y2 = y0 * cX - z * sX;
        const z2 = y0 * sX + z * cX;
        let px = cx + x * R + shiftX;
        let py = cy + y2 * R + shiftY;
        const depth = (z2 + 1) / 2;
        if (infl > 0.01 && mx > -9000) {
          const dx = mx - px, dy = my - py;
          const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (size * 0.85));
          const pull = infl * near * near * 0.3;
          px += dx * pull;
          py += dy * pull;
        }
        return { px, py, depth };
      });

      if (infl > 0.14) {
        const near = proj.map((p) => ({ p, d: Math.hypot(p.px - mx, p.py - my) })).filter((o) => o.d < size * 0.45).sort((a, b) => a.d - b.d).slice(0, 22);
        ctx.lineWidth = 0.6;
        for (let i = 0; i < near.length; i++)
          for (let j = i + 1; j < near.length; j++) {
            const a = near[i].p, b = near[j].p;
            const dd = Math.hypot(a.px - b.px, a.py - b.py);
            if (dd < size * 0.2) {
              ctx.strokeStyle = `rgba(201,169,110,${infl * (1 - dd / (size * 0.2)) * 0.3})`;
              ctx.beginPath();
              ctx.moveTo(a.px, a.py);
              ctx.lineTo(b.px, b.py);
              ctx.stroke();
            }
          }
      }

      for (const p of proj) {
        const sz = 0.5 + p.depth * 1.25;
        const a = 0.18 + p.depth * 0.62;
        ctx.beginPath();
        ctx.arc(p.px, p.py, sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.round(208 + p.depth * 28)},${Math.round(180 + p.depth * 40)},${Math.round(132 + p.depth * 90)},${a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
    };
  }, [size]);

  return (
    <div className="cmo-brain-window" style={{ width: size + 16, height: size + 16 }}>
      <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />
    </div>
  );
}

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
  const lines = String(md || "").split("\n");
  let html = "";
  let i = 0;
  let list: string | null = null;
  const close = () => { if (list) { html += "</" + list + ">"; list = null; } };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) { close(); i++; let c = ""; while (i < lines.length && !/^```/.test(lines[i])) { c += lines[i] + "\n"; i++; } i++; html += "<pre>" + esc(c.replace(/\n$/, "")) + "</pre>"; continue; }
    if (/^\s*$/.test(ln)) { close(); i++; continue; }
    if (/^---+\s*$/.test(ln)) { close(); html += "<hr/>"; i++; continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { close(); html += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"; i++; continue; }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (list !== "ol") { close(); list = "ol"; html += "<ol>"; } html += "<li>" + inline(ol[1]) + "</li>"; i++; continue; }
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== "ul") { close(); list = "ul"; html += "<ul>"; } html += "<li>" + inline(ul[1]) + "</li>"; i++; continue; }
    close(); html += "<p>" + inline(ln) + "</p>"; i++;
  }
  close();
  return html;
}

type Skill = { id: string; name: string; tagline?: string; selfImproving?: boolean; path?: string; description?: string; markdown?: string };
type Meeting = { id: string; date?: string; title: string; creator?: string; tags?: string[]; summary?: string; notes?: string; archive?: string };
type FeedEntry = { at?: string; bucket?: string; title: string; detail?: string; tags?: string[]; where?: string };

const BUCKET_COLOR: Record<string, string> = {
  "Copywriting rule": "#c9a96e",
  "Attribution rule": "#5b8def",
  "Coaching playbook": "#5b8def",
  "Org / people": "#a78bfa",
  "How Alex thinks": "#3fb27f",
  "Company doctrine": "#e0915b",
  "System / protocol": "#3fb6b2",
  "Meeting": "#a78bfa",
  "Creator context": "#e07ba0",
  "Feature spec": "#4cc4e0",
  "Identity": "#c9a96e",
};
const colorFor = (b?: string) => (b && BUCKET_COLOR[b]) || "#c9a96e";

const TRANSCRIPTS = [
  { name: "Team strategy (3h)", sub: "2026-06-05", path: "~/.claude/.../transcripts/2026-06-05-team-strategy-deep.md", meetingId: "2026-06-05-team-strategy" },
  { name: "Zakk coaching call", sub: "2026-06-04", path: "~/.claude/.../transcripts/2026-06-04-zakk-coaching-call.md", meetingId: "2026-06-04-zakk-coaching" },
];

type Tab = "feed" | "skills" | "meetings" | "files";

export default function CmoPage() {
  const [tab, setTab] = useState<Tab>("feed");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);
  const [openFeed, setOpenFeed] = useState<number | null>(null);
  const [fileSel, setFileSel] = useState<{ kind: "skill" | "meeting" | "transcript"; id: string } | null>(null);

  useEffect(() => {
    let off = false;
    const grab = (url: string, key: string, set: (v: unknown) => void) =>
      fetch(url, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (!off) set(d?.[key]); }).catch(() => {});
    grab("/skills-data.json", "skills", (v) => setSkills(Array.isArray(v) ? (v as Skill[]) : []));
    grab("/meetings-data.json", "meetings", (v) => setMeetings(Array.isArray(v) ? (v as Meeting[]) : []));
    grab("/memory-log.json", "entries", (v) => setFeed(Array.isArray(v) ? (v as FeedEntry[]) : []));
    return () => { off = true; };
  }, []);

  const activeSkill = useMemo(() => skills.find((s) => s.id === openSkill) || null, [skills, openSkill]);
  const activeMeeting = useMemo(() => meetings.find((m) => m.id === openMeeting) || null, [meetings, openMeeting]);
  const inDetail = activeSkill || activeMeeting;
  const fileMeeting = fileSel?.kind === "meeting" ? meetings.find((m) => m.id === fileSel.id) : fileSel?.kind === "transcript" ? meetings.find((m) => m.id === fileSel.id) : null;
  const fileSkill = fileSel?.kind === "skill" ? skills.find((s) => s.id === fileSel.id) : null;

  return (
    <div className="cmo">
      <CmoStyles />

      <header className="cmo-top">
        <div className="cmo-brand">
          <JarvisBrain size={150} />
          <div>
            <h1>CMO</h1>
            <div className="cmo-status"><span className="cmo-dot" /> active · self-improving · learning live</div>
          </div>
        </div>
        <nav className="cmo-nav">
          {(["feed", "skills", "meetings", "files"] as Tab[]).map((tk) => (
            <button key={tk} className={tab === tk && !inDetail ? "on" : ""} onClick={() => { setTab(tk); setOpenSkill(null); setOpenMeeting(null); }}>
              {tk === "feed" ? "Learning feed" : tk === "files" ? "Files" : tk === "skills" ? "Skills" : "Meetings"}
            </button>
          ))}
        </nav>
      </header>

      {inDetail && <button className="cmo-back" onClick={() => { setOpenSkill(null); setOpenMeeting(null); }}>← back</button>}

      {/* FEED */}
      {tab === "feed" && !inDetail && (
        <section className="cmo-term">
          <div className="cmo-term-bar">
            <span className="cmo-live"><span className="cmo-live-dot" /> live</span>
            <span className="cmo-term-name">memory.log</span>
            <span className="cmo-term-count">{feed.length} entries</span>
          </div>
          <div>
            {feed.map((e, i) => {
              const open = openFeed === i;
              const c = colorFor(e.bucket);
              return (
                <div key={i} className={"cmo-row" + (open ? " open" : "")} onClick={() => setOpenFeed(open ? null : i)}>
                  <div className="cmo-row-main">
                    <span className="cmo-row-bucket">
                      <span className="cmo-bdot" style={{ background: c }} />
                      {e.bucket}
                    </span>
                    <span className="cmo-row-title">{e.title}</span>
                    <span className="cmo-row-time">{(e.at || "").slice(5)}</span>
                  </div>
                  {open && (
                    <div className="cmo-row-detail">
                      {e.detail && <p>{e.detail}</p>}
                      <div className="cmo-row-meta">
                        {(e.tags || []).map((t, j) => <span key={j} className="cmo-tag">{t}</span>)}
                        {e.where && <span className="cmo-where">stored in {e.where}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SKILLS */}
      {tab === "skills" && (activeSkill ? (
        <Detail title={activeSkill.name} sub={activeSkill.tagline} badge={activeSkill.selfImproving ? "self-improving" : undefined} path={activeSkill.path} desc={activeSkill.description} md={activeSkill.markdown} />
      ) : (
        <div className="cmo-grid">
          {skills.map((s) => (
            <button key={s.id} className="cmo-card" onClick={() => setOpenSkill(s.id)}>
              <div className="cmo-card-row"><span className="cmo-card-name">{s.name}</span>{s.selfImproving && <span className="cmo-badge">self-improving</span>}</div>
              <div className="cmo-card-tag">{s.tagline}</div>
              <div className="cmo-card-desc">{s.description}</div>
              <div className="cmo-card-path">{s.path}</div>
            </button>
          ))}
        </div>
      ))}

      {/* MEETINGS */}
      {tab === "meetings" && (activeMeeting ? (
        <Detail title={activeMeeting.title} sub={[activeMeeting.date, activeMeeting.creator].filter(Boolean).join(" · ")} tags={activeMeeting.tags} desc={activeMeeting.summary} md={activeMeeting.notes} path={activeMeeting.archive} />
      ) : meetings.length ? (
        <div className="cmo-mlist">
          {meetings.map((m) => (
            <button key={m.id} className="cmo-mcard" onClick={() => setOpenMeeting(m.id)}>
              <div className="cmo-mcard-date">{m.date}</div>
              <div className="cmo-mcard-body">
                <div className="cmo-mcard-title">{m.title}</div>
                <div className="cmo-mcard-creator">{m.creator}</div>
                <div className="cmo-mcard-sum">{m.summary}</div>
                <div className="cmo-card-taglist">{(m.tags || []).slice(0, 5).map((t, i) => <span key={i} className="cmo-tag">{t}</span>)}</div>
              </div>
              <span className="cmo-mcard-go">→</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="cmo-empty">No meeting context yet. Paste a Fathom transcript and it shows up here.</div>
      ))}

      {/* FILES — master / detail */}
      {tab === "files" && (
        <div className="cmo-files">
          <div className="cmo-files-list">
            <FGroup title="Skills" hint="always-on playbooks">
              {skills.map((s) => <FRow key={s.id} name={s.name} on={fileSel?.kind === "skill" && fileSel.id === s.id} onClick={() => setFileSel({ kind: "skill", id: s.id })} />)}
            </FGroup>
            <FGroup title="Meetings" hint="distilled context">
              {meetings.map((m) => <FRow key={m.id} name={m.title} on={fileSel?.kind === "meeting" && fileSel.id === m.id} onClick={() => setFileSel({ kind: "meeting", id: m.id })} />)}
            </FGroup>
            <FGroup title="Transcripts" hint="raw archive (private)">
              {TRANSCRIPTS.map((tr) => <FRow key={tr.path} name={tr.name} sub={tr.sub} on={fileSel?.kind === "transcript" && fileSel.id === tr.meetingId} onClick={() => setFileSel({ kind: "transcript", id: tr.meetingId })} />)}
            </FGroup>
          </div>
          <div className="cmo-files-view">
            {fileSkill ? (
              <Detail title={fileSkill.name} sub={fileSkill.tagline} path={fileSkill.path} desc={fileSkill.description} md={fileSkill.markdown} />
            ) : fileMeeting ? (
              <>
                {fileSel?.kind === "transcript" && (
                  <div className="cmo-tnote">Raw transcript is stored privately on your machine. Showing the distilled version below.</div>
                )}
                <Detail title={fileMeeting.title} sub={[fileMeeting.date, fileMeeting.creator].filter(Boolean).join(" · ")} tags={fileMeeting.tags} desc={fileMeeting.summary} md={fileMeeting.notes} path={fileMeeting.archive} />
              </>
            ) : (
              <div className="cmo-files-empty">Select a file to view it.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ title, sub, badge, tags, path, desc, md }: { title: string; sub?: string; badge?: string; tags?: string[]; path?: string; desc?: string; md?: string }) {
  return (
    <div className="cmo-detail">
      <div className="cmo-detail-head"><h2>{title}</h2>{badge && <span className="cmo-badge">{badge}</span>}</div>
      {sub && <div className="cmo-detail-sub">{sub}</div>}
      {tags && tags.length > 0 && <div className="cmo-card-taglist" style={{ marginTop: 10 }}>{tags.map((t, i) => <span key={i} className="cmo-tag">{t}</span>)}</div>}
      {desc && <p className="cmo-detail-desc">{desc}</p>}
      {path && <div className="cmo-detail-path">{path}</div>}
      {md && <div className="cmo-md" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} />}
    </div>
  );
}
function FGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="cmo-fgroup">
      <div className="cmo-fgroup-head"><span className="cmo-fgroup-title">{title}</span>{hint && <span className="cmo-fgroup-hint">{hint}</span>}</div>
      <div>{children}</div>
    </div>
  );
}
function FRow({ name, sub, on, onClick }: { name: string; sub?: string; on?: boolean; onClick?: () => void }) {
  return (
    <button className={"cmo-frow" + (on ? " on" : "")} onClick={onClick}>
      <span className="cmo-frow-name">{name}</span>
      {sub && <span className="cmo-frow-sub">{sub}</span>}
    </button>
  );
}

function CmoStyles() {
  return (
    <style>{`
  .cmo{max-width:1080px;margin:0 auto;padding:30px 30px 100px}
  .cmo-top{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:28px}
  .cmo-brand{display:flex;align-items:center;gap:18px}
  .cmo-brain-window{flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid color-mix(in srgb,var(--gold) 24%,var(--border));background:radial-gradient(circle at 50% 42%,#1b1812,#0b0a09 74%);box-shadow:inset 0 0 26px -8px rgba(201,169,110,.32),0 0 46px -18px rgba(201,169,110,.5)}
  .cmo h1{font-size:26px;font-weight:800;letter-spacing:-.4px;color:var(--text-primary);margin:0 0 6px}
  .cmo-status{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#3fb27f);box-shadow:0 0 8px var(--green,#3fb27f)}
  .cmo-nav{display:inline-flex;gap:2px;padding:3px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px}
  .cmo-nav button{padding:7px 14px;border:none;background:transparent;color:var(--text-muted);font-size:12.5px;font-weight:600;border-radius:7px;cursor:pointer;font-family:inherit}
  .cmo-nav button:hover{color:var(--text-secondary)}
  .cmo-nav button.on{background:var(--bg-card);color:var(--text-primary);box-shadow:0 1px 2px rgba(0,0,0,.15)}
  .cmo-back{background:none;border:none;color:var(--text-muted);font-size:13px;font-weight:600;cursor:pointer;margin-bottom:16px;padding:0;font-family:inherit}
  .cmo-back:hover{color:var(--text-primary)}

  /* feed */
  .cmo-term{border:1px solid var(--border);border-radius:13px;overflow:hidden;background:var(--bg-card)}
  .cmo-term-bar{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);background:var(--bg-secondary)}
  .cmo-live{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--green,#3fb27f);background:color-mix(in srgb,var(--green,#3fb27f) 14%,transparent);border:1px solid color-mix(in srgb,var(--green,#3fb27f) 32%,transparent);padding:3px 9px;border-radius:999px}
  .cmo-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#3fb27f);animation:cmoPulse 1.8s ease-in-out infinite}
  @keyframes cmoPulse{0%,100%{opacity:1}50%{opacity:.35}}
  .cmo-term-name{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;color:var(--text-secondary)}
  .cmo-term-count{margin-left:auto;font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-row{border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s}
  .cmo-row:last-child{border-bottom:none}
  .cmo-row:hover{background:color-mix(in srgb,var(--text-primary) 3%,transparent)}
  .cmo-row-main{display:flex;align-items:center;gap:14px;padding:13px 16px}
  .cmo-row-bucket{flex:0 0 150px;display:inline-flex;align-items:center;gap:8px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted)}
  .cmo-bdot{width:6px;height:6px;border-radius:50%;flex:0 0 auto}
  .cmo-row-title{flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-row.open .cmo-row-title{white-space:normal}
  .cmo-row-time{flex:0 0 auto;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:11px;color:var(--text-muted)}
  .cmo-row-detail{padding:0 16px 16px 182px}
  .cmo-row-detail p{margin:0 0 10px;font-size:13px;color:var(--text-secondary);line-height:1.6}
  .cmo-row-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .cmo-where{font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-tag{font-size:10.5px;color:var(--text-secondary);background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:2px 7px}

  /* skill cards */
  .cmo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
  .cmo-card{text-align:left;display:flex;flex-direction:column;gap:7px;padding:18px;border:1px solid var(--border);border-radius:13px;background:var(--bg-card);cursor:pointer;font-family:inherit;transition:border-color .14s,transform .1s}
  .cmo-card:hover{border-color:var(--border-hover);transform:translateY(-2px)}
  .cmo-card-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .cmo-card-name{font-size:15.5px;font-weight:750;color:var(--text-primary)}
  .cmo-badge{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gold);border:1px solid color-mix(in srgb,var(--gold) 36%,transparent);padding:2px 7px;border-radius:999px;white-space:nowrap}
  .cmo-card-tag{font-size:12px;color:var(--gold)}
  .cmo-card-desc{font-size:12px;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .cmo-card-path{font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);margin-top:4px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-card-taglist{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}

  /* meeting list */
  .cmo-mlist{display:flex;flex-direction:column;gap:10px}
  .cmo-mcard{display:flex;align-items:flex-start;gap:18px;text-align:left;padding:18px 20px;border:1px solid var(--border);border-radius:13px;background:var(--bg-card);cursor:pointer;font-family:inherit;transition:border-color .14s,transform .08s}
  .cmo-mcard:hover{border-color:var(--border-hover);transform:translateY(-1px)}
  .cmo-mcard-date{flex:0 0 86px;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:11.5px;color:var(--gold);padding-top:2px}
  .cmo-mcard-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
  .cmo-mcard-title{font-size:15.5px;font-weight:750;color:var(--text-primary)}
  .cmo-mcard-creator{font-size:12px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-mcard-sum{font-size:13px;color:var(--text-secondary);line-height:1.5}
  .cmo-mcard-go{flex:0 0 auto;color:var(--text-muted);font-size:18px;align-self:center}

  /* detail */
  .cmo-detail{max-width:760px}
  .cmo-detail-head{display:flex;align-items:center;gap:12px}
  .cmo-detail-head h2{font-size:22px;font-weight:800;color:var(--text-primary);margin:0}
  .cmo-detail-sub{font-size:13px;color:var(--gold);margin-top:6px;font-weight:600}
  .cmo-detail-desc{font-size:13.5px;color:var(--text-secondary);line-height:1.55;margin:14px 0 4px}
  .cmo-detail-path{font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);background:var(--bg-secondary);border:1px solid var(--border);border-radius:7px;padding:7px 11px;margin:10px 0 18px;display:inline-block}
  .cmo-md{font-size:13.5px;color:var(--text-secondary);line-height:1.64}
  .cmo-md h1{font-size:19px;font-weight:800;color:var(--text-primary);margin:2px 0 12px}
  .cmo-md h2{font-size:17px;font-weight:800;color:var(--text-primary);margin:30px 0 13px;padding-top:18px;border-top:1px solid var(--border);line-height:1.3}
  .cmo-md h3{font-size:13.5px;font-weight:750;color:var(--gold);margin:16px 0 8px}
  .cmo-md p{margin:0 0 11px}
  .cmo-md strong{color:var(--text-primary);font-weight:700}
  .cmo-md ul{list-style:none;padding-left:0;margin:0 0 13px;display:flex;flex-direction:column;gap:7px}
  .cmo-md ul>li{position:relative;padding-left:18px}
  .cmo-md ul>li::before{content:"";position:absolute;left:3px;top:8px;width:5px;height:5px;border-radius:50%;background:var(--gold)}
  .cmo-md ol{list-style:none;padding-left:0;margin:0 0 13px;counter-reset:cmoO;display:flex;flex-direction:column;gap:9px}
  .cmo-md ol>li{position:relative;padding-left:31px;counter-increment:cmoO}
  .cmo-md ol>li::before{content:counter(cmoO);position:absolute;left:0;top:0;width:21px;height:21px;border-radius:6px;background:color-mix(in srgb,var(--gold) 15%,transparent);color:var(--gold);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-md code{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;background:color-mix(in srgb,var(--gold) 11%,transparent);border:1px solid color-mix(in srgb,var(--gold) 24%,transparent);border-radius:5px;padding:1px 5px;color:var(--text-primary)}
  .cmo-md pre{margin:0 0 12px;padding:13px 14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:9px;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.5}
  .cmo-md pre code{background:none;border:none;padding:0}
  .cmo-md hr{border:none;border-top:1px solid var(--border);margin:18px 0}

  /* files: master / detail */
  .cmo-files{display:grid;grid-template-columns:300px 1fr;gap:22px;align-items:start}
  .cmo-files-list{display:flex;flex-direction:column;gap:16px;position:sticky;top:20px}
  .cmo-fgroup{border:1px solid var(--border);border-radius:11px;overflow:hidden;background:var(--bg-card)}
  .cmo-fgroup-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:10px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border)}
  .cmo-fgroup-title{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-primary)}
  .cmo-fgroup-hint{font-size:10px;color:var(--text-muted)}
  .cmo-frow{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:9px 14px;border:none;border-bottom:1px solid var(--border);background:transparent;cursor:pointer;font-family:inherit;transition:background .1s}
  .cmo-frow:last-child{border-bottom:none}
  .cmo-frow:hover{background:color-mix(in srgb,var(--text-primary) 3%,transparent)}
  .cmo-frow.on{background:color-mix(in srgb,var(--gold) 12%,transparent);box-shadow:inset 2px 0 0 var(--gold)}
  .cmo-frow-name{font-size:12.5px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-frow-sub{flex:0 0 auto;font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-files-view{min-width:0;border:1px solid var(--border);border-radius:13px;background:var(--bg-card);padding:24px 26px;min-height:300px}
  .cmo-files-empty{color:var(--text-muted);font-size:13px;padding:40px 0;text-align:center}
  .cmo-tnote{font-size:11.5px;color:var(--text-muted);background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:9px 12px;margin-bottom:16px}
  .cmo-empty{text-align:center;padding:56px 24px;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);font-size:13px}
  @media(max-width:760px){.cmo-files{grid-template-columns:1fr}.cmo-files-list{position:static}}
    `}</style>
  );
}
