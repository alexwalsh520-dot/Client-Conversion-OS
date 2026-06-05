"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ============================================================ *
 * Jarvis brain — slow, organic, and it GATHERS toward the cursor:
 * particles pull together + connect near the mouse, and drift loose
 * and flowy far from it. No per-dot shadowBlur (that caused the lag);
 * additive blending gives the glow cheaply.
 * ============================================================ */
function JarvisBrain({ size = 132 }: { size?: number }) {
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

    const N = 460;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      return { x: Math.cos(t) * r, y, z: Math.sin(t) * r, ph: Math.random() * Math.PI * 2 };
    });

    let mx = -9999;
    let my = -9999;
    let influence = 0; // 0 far from brain .. 1 mouse over brain
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      influence = Math.max(0, 1 - d / 300); // gentle falloff around the brain
    };
    const onLeave = () => {
      influence = 0;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseout", onLeave);

    let raf = 0;
    const start = performance.now();
    let infl = 0;
    const render = (now: number) => {
      const t = (now - start) / 1000;
      infl += (influence - infl) * 0.05; // ease influence very slowly
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.4;
      const breathe = 1 + Math.sin(t * 0.5) * 0.025; // very slow breathing
      const ay = t * 0.08; // slow rotation
      const ax = Math.sin(t * 0.05) * 0.2;
      const cosY = Math.cos(ay);
      const sinY = Math.sin(ay);
      const cosX = Math.cos(ax);
      const sinX = Math.sin(ax);

      const proj = pts.map((p) => {
        // slow organic drift so the dots aren't perfectly uniform
        const drift = 0.06 * Math.sin(t * 0.5 + p.ph);
        const rr = 1 + drift;
        const x0 = p.x * rr;
        const y0 = p.y * rr;
        const z0 = p.z * rr;
        const x = x0 * cosY - z0 * sinY;
        const z = x0 * sinY + z0 * cosY;
        const y2 = y0 * cosX - z * sinX;
        const z2 = y0 * sinX + z * cosX;
        let px = cx + x * baseR * breathe;
        let py = cy + y2 * baseR * breathe;
        const depth = (z2 + 1) / 2;
        // gather toward the cursor (strong near it, nothing far away)
        if (infl > 0.01 && mx > -9000) {
          const dx = mx - px;
          const dy = my - py;
          const dd = Math.sqrt(dx * dx + dy * dy);
          const near = Math.max(0, 1 - dd / (size * 0.7));
          const pull = infl * near * near * 0.32;
          px += dx * pull;
          py += dy * pull;
        }
        return { px, py, depth };
      });

      // faint connection lines only near the cursor (cheap, capped)
      if (infl > 0.12) {
        const near = proj
          .map((p, i) => ({ p, d: Math.hypot(p.px - mx, p.py - my), i }))
          .filter((o) => o.d < size * 0.5)
          .sort((a, b) => a.d - b.d)
          .slice(0, 26);
        ctx.lineWidth = 0.6;
        for (let i = 0; i < near.length; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const a = near[i].p;
            const b = near[j].p;
            const dd = Math.hypot(a.px - b.px, a.py - b.py);
            if (dd < size * 0.22) {
              ctx.strokeStyle = `rgba(201,169,110,${infl * (1 - dd / (size * 0.22)) * 0.28})`;
              ctx.beginPath();
              ctx.moveTo(a.px, a.py);
              ctx.lineTo(b.px, b.py);
              ctx.stroke();
            }
          }
        }
      }

      ctx.globalCompositeOperation = "lighter";
      for (const p of proj) {
        const sz = 0.5 + p.depth * 1.2;
        const a = 0.12 + p.depth * 0.6;
        ctx.beginPath();
        ctx.arc(p.px, p.py, sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.round(206 + p.depth * 30)},${Math.round(176 + p.depth * 45)},${Math.round(120 + p.depth * 110)},${a})`;
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
    };
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />;
}

/* tiny markdown -> html (renders the real skill/meeting files) */
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
  const close = () => {
    if (list) {
      html += "</" + list + ">";
      list = null;
    }
  };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) {
      close();
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
      close();
      i++;
      continue;
    }
    if (/^---+\s*$/.test(ln)) {
      close();
      html += "<hr/>";
      i++;
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      close();
      html += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">";
      i++;
      continue;
    }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (list !== "ol") {
        close();
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
        close();
        list = "ul";
        html += "<ul>";
      }
      html += "<li>" + inline(ul[1]) + "</li>";
      i++;
      continue;
    }
    close();
    html += "<p>" + inline(ln) + "</p>";
    i++;
  }
  close();
  return html;
}

type Skill = { id: string; name: string; tagline?: string; selfImproving?: boolean; path?: string; description?: string; markdown?: string };
type Meeting = { id: string; date?: string; title: string; creator?: string; tags?: string[]; summary?: string; notes?: string; archive?: string };
type FeedEntry = { at?: string; bucket?: string; title: string; detail?: string; tags?: string[]; where?: string };

const TRANSCRIPTS = [
  { name: "2026-06-05 · Team strategy (3h)", path: "~/.claude/.../memory/transcripts/2026-06-05-team-strategy-deep.md", meetingId: "2026-06-05-team-strategy" },
  { name: "2026-06-04 · Zakk coaching call", path: "~/.claude/.../memory/transcripts/2026-06-04-zakk-coaching-call.md", meetingId: "2026-06-04-zakk-coaching" },
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

  useEffect(() => {
    let off = false;
    const grab = (url: string, key: string, set: (v: unknown) => void) =>
      fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!off) set(d?.[key]);
        })
        .catch(() => {});
    grab("/skills-data.json", "skills", (v) => setSkills(Array.isArray(v) ? (v as Skill[]) : []));
    grab("/meetings-data.json", "meetings", (v) => setMeetings(Array.isArray(v) ? (v as Meeting[]) : []));
    grab("/memory-log.json", "entries", (v) => setFeed(Array.isArray(v) ? (v as FeedEntry[]) : []));
    return () => {
      off = true;
    };
  }, []);

  const activeSkill = useMemo(() => skills.find((s) => s.id === openSkill) || null, [skills, openSkill]);
  const activeMeeting = useMemo(() => meetings.find((m) => m.id === openMeeting) || null, [meetings, openMeeting]);
  const inDetail = activeSkill || activeMeeting;

  const openMeetingFromFiles = (id: string) => {
    setOpenMeeting(id);
    setTab("meetings");
  };

  return (
    <div className="cmo">
      <CmoStyles />

      {/* Console header */}
      <header className="cmo-top">
        <div className="cmo-brand">
          <div className="cmo-brain-frame">
            <JarvisBrain size={120} />
          </div>
          <div>
            <h1>CMO</h1>
            <div className="cmo-status">
              <span className="cmo-dot" /> active · self-improving · learning live
            </div>
          </div>
        </div>
        <nav className="cmo-nav">
          {(["feed", "skills", "meetings", "files"] as Tab[]).map((tk) => (
            <button
              key={tk}
              className={tab === tk && !inDetail ? "on" : ""}
              onClick={() => {
                setTab(tk);
                setOpenSkill(null);
                setOpenMeeting(null);
              }}
            >
              {tk === "feed" ? "Learning feed" : tk === "files" ? "Files" : tk === "skills" ? "Skills" : "Meetings"}
            </button>
          ))}
        </nav>
      </header>

      {inDetail && (
        <button
          className="cmo-back"
          onClick={() => {
            setOpenSkill(null);
            setOpenMeeting(null);
          }}
        >
          ← back
        </button>
      )}

      {/* LEARNING FEED — a clean terminal-style window */}
      {tab === "feed" && !inDetail && (
        <section className="cmo-term">
          <div className="cmo-term-bar">
            <span className="cmo-term-dots">
              <i /> <i /> <i />
            </span>
            <span className="cmo-term-name">memory.log</span>
            <span className="cmo-term-count">{feed.length} entries</span>
          </div>
          <div className="cmo-term-body">
            {feed.map((e, i) => {
              const open = openFeed === i;
              return (
                <div key={i} className={"cmo-row" + (open ? " open" : "")} onClick={() => setOpenFeed(open ? null : i)}>
                  <div className="cmo-row-main">
                    <span className="cmo-row-time">{(e.at || "").slice(5)}</span>
                    <span className="cmo-row-bucket">{e.bucket}</span>
                    <span className="cmo-row-title">{e.title}</span>
                    <span className="cmo-row-caret">{open ? "−" : "+"}</span>
                  </div>
                  {open && (
                    <div className="cmo-row-detail">
                      {e.detail && <p>{e.detail}</p>}
                      <div className="cmo-row-meta">
                        {(e.tags || []).map((t, j) => (
                          <span key={j} className="cmo-tag">
                            {t}
                          </span>
                        ))}
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
      {tab === "skills" &&
        (activeSkill ? (
          <Detail title={activeSkill.name} sub={activeSkill.tagline} badge={activeSkill.selfImproving ? "self-improving" : undefined} path={activeSkill.path} desc={activeSkill.description} md={activeSkill.markdown} />
        ) : (
          <div className="cmo-grid">
            {skills.map((s) => (
              <button key={s.id} className="cmo-card" onClick={() => setOpenSkill(s.id)}>
                <div className="cmo-card-row">
                  <span className="cmo-card-name">{s.name}</span>
                  {s.selfImproving && <span className="cmo-badge">self-improving</span>}
                </div>
                <div className="cmo-card-tag">{s.tagline}</div>
                <div className="cmo-card-desc">{s.description}</div>
                <div className="cmo-card-path">{s.path}</div>
              </button>
            ))}
          </div>
        ))}

      {/* MEETINGS */}
      {tab === "meetings" &&
        (activeMeeting ? (
          <Detail
            title={activeMeeting.title}
            sub={[activeMeeting.date, activeMeeting.creator].filter(Boolean).join(" · ")}
            tags={activeMeeting.tags}
            desc={activeMeeting.summary}
            md={activeMeeting.notes}
            path={activeMeeting.archive}
          />
        ) : meetings.length ? (
          <div className="cmo-grid">
            {meetings.map((m) => (
              <button key={m.id} className="cmo-card" onClick={() => setOpenMeeting(m.id)}>
                <div className="cmo-card-row">
                  <span className="cmo-card-name">{m.title}</span>
                  {m.date && <span className="cmo-badge muted">{m.date}</span>}
                </div>
                <div className="cmo-card-tag">{m.creator}</div>
                <div className="cmo-card-desc">{m.summary}</div>
                <div className="cmo-card-taglist">
                  {(m.tags || []).slice(0, 4).map((t, i) => (
                    <span key={i} className="cmo-tag">
                      {t}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="cmo-empty">No meeting context yet. Paste a Fathom transcript and it shows up here.</div>
        ))}

      {/* FILES — the source of truth, navigable */}
      {tab === "files" && (
        <div className="cmo-files">
          <FileGroup title="Skills" hint="always-on playbooks">
            {skills.map((s) => (
              <FileRow key={s.id} name={s.name} path={s.path} onClick={() => { setOpenSkill(s.id); setTab("skills"); }} />
            ))}
          </FileGroup>
          <FileGroup title="Meetings" hint="distilled context">
            {meetings.map((m) => (
              <FileRow key={m.id} name={m.title} path={"meetings-data.json"} onClick={() => openMeetingFromFiles(m.id)} />
            ))}
          </FileGroup>
          <FileGroup title="Transcripts" hint="raw deep archive (private, on your machine)">
            {TRANSCRIPTS.map((tr) => (
              <FileRow key={tr.path} name={tr.name} path={tr.path} onClick={() => openMeetingFromFiles(tr.meetingId)} note="open distilled →" />
            ))}
          </FileGroup>
          <FileGroup title="Data" hint="what the page reads">
            <FileRow name="Learning feed" path="public/memory-log.json" onClick={() => setTab("feed")} />
            <FileRow name="Skills index" path="public/skills-data.json" onClick={() => setTab("skills")} />
            <FileRow name="Meetings index" path="public/meetings-data.json" onClick={() => setTab("meetings")} />
          </FileGroup>
        </div>
      )}
    </div>
  );
}

function Detail({ title, sub, badge, tags, path, desc, md }: { title: string; sub?: string; badge?: string; tags?: string[]; path?: string; desc?: string; md?: string }) {
  return (
    <div className="cmo-detail">
      <div className="cmo-detail-head">
        <h2>{title}</h2>
        {badge && <span className="cmo-badge">{badge}</span>}
      </div>
      {sub && <div className="cmo-detail-sub">{sub}</div>}
      {tags && tags.length > 0 && (
        <div className="cmo-card-taglist" style={{ marginTop: 10 }}>
          {tags.map((t, i) => (
            <span key={i} className="cmo-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      {desc && <p className="cmo-detail-desc">{desc}</p>}
      {path && <div className="cmo-detail-path">{path}</div>}
      {md && <div className="cmo-md" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} />}
    </div>
  );
}

function FileGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="cmo-fgroup">
      <div className="cmo-fgroup-head">
        <span className="cmo-fgroup-title">{title}</span>
        {hint && <span className="cmo-fgroup-hint">{hint}</span>}
      </div>
      <div className="cmo-fgroup-body">{children}</div>
    </div>
  );
}
function FileRow({ name, path, onClick, note }: { name: string; path?: string; onClick?: () => void; note?: string }) {
  return (
    <button className="cmo-frow" onClick={onClick}>
      <span className="cmo-frow-name">{name}</span>
      <span className="cmo-frow-path">{path}</span>
      <span className="cmo-frow-note">{note || "open →"}</span>
    </button>
  );
}

function CmoStyles() {
  return (
    <style>{`
  .cmo{max-width:1080px;margin:0 auto;padding:30px 30px 100px;font-feature-settings:"ss01";}
  .cmo-top{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:28px}
  .cmo-brand{display:flex;align-items:center;gap:16px}
  .cmo-brain-frame{flex:0 0 auto;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle at 50% 45%,rgba(201,169,110,.08),transparent 60%)}
  .cmo h1{font-size:26px;font-weight:800;letter-spacing:-.4px;color:var(--text-primary);margin:0 0 6px}
  .cmo-status{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);letter-spacing:.02em}
  .cmo-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#3fb27f);box-shadow:0 0 8px var(--green,#3fb27f)}
  .cmo-nav{display:inline-flex;gap:2px;padding:3px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px}
  .cmo-nav button{padding:7px 14px;border:none;background:transparent;color:var(--text-muted);font-size:12.5px;font-weight:600;border-radius:7px;cursor:pointer;font-family:inherit;transition:color .12s}
  .cmo-nav button:hover{color:var(--text-secondary)}
  .cmo-nav button.on{background:var(--bg-card);color:var(--text-primary);box-shadow:0 1px 2px rgba(0,0,0,.15)}
  .cmo-back{background:none;border:none;color:var(--text-muted);font-size:13px;font-weight:600;cursor:pointer;margin-bottom:16px;padding:0;font-family:inherit}
  .cmo-back:hover{color:var(--text-primary)}

  /* terminal feed */
  .cmo-term{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg-card)}
  .cmo-term-bar{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg-secondary)}
  .cmo-term-dots{display:inline-flex;gap:6px}
  .cmo-term-dots i{width:9px;height:9px;border-radius:50%;background:var(--border-hover)}
  .cmo-term-name{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;color:var(--text-secondary)}
  .cmo-term-count{margin-left:auto;font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-term-body{max-height:none}
  .cmo-row{border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s}
  .cmo-row:last-child{border-bottom:none}
  .cmo-row:hover{background:var(--hover-bg-subtle,rgba(127,127,127,.04))}
  .cmo-row-main{display:flex;align-items:center;gap:14px;padding:12px 16px}
  .cmo-row-time{flex:0 0 78px;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums}
  .cmo-row-bucket{flex:0 0 132px;font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--gold)}
  .cmo-row-title{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-row.open .cmo-row-title{white-space:normal}
  .cmo-row-caret{flex:0 0 auto;font-family:var(--font-mono,ui-monospace,Menlo,monospace);color:var(--text-muted);font-size:14px}
  .cmo-row-detail{padding:0 16px 16px 108px}
  .cmo-row-detail p{margin:0 0 10px;font-size:12.5px;color:var(--text-secondary);line-height:1.55}
  .cmo-row-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .cmo-where{font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-tag{font-size:10.5px;color:var(--text-secondary);background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:2px 7px}

  /* minimal cards */
  .cmo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
  .cmo-card{text-align:left;display:flex;flex-direction:column;gap:7px;padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);cursor:pointer;font-family:inherit;transition:border-color .14s,transform .1s,background .14s}
  .cmo-card:hover{border-color:var(--border-hover);transform:translateY(-2px)}
  .cmo-card-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .cmo-card-name{font-size:15px;font-weight:700;color:var(--text-primary)}
  .cmo-badge{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gold);border:1px solid color-mix(in srgb,var(--gold) 36%,transparent);padding:2px 7px;border-radius:999px;white-space:nowrap}
  .cmo-badge.muted{color:var(--text-muted);border-color:var(--border)}
  .cmo-card-tag{font-size:12px;color:var(--text-secondary)}
  .cmo-card-desc{font-size:12px;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .cmo-card-path{font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);margin-top:4px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-card-taglist{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}

  /* detail */
  .cmo-detail{max-width:760px}
  .cmo-detail-head{display:flex;align-items:center;gap:12px}
  .cmo-detail-head h2{font-size:22px;font-weight:800;color:var(--text-primary);margin:0}
  .cmo-detail-sub{font-size:13px;color:var(--text-secondary);margin-top:6px}
  .cmo-detail-desc{font-size:13.5px;color:var(--text-secondary);line-height:1.55;margin:14px 0 4px}
  .cmo-detail-path{font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);background:var(--bg-secondary);border:1px solid var(--border);border-radius:7px;padding:7px 11px;margin:10px 0 18px;display:inline-block}
  .cmo-md{font-size:13.5px;color:var(--text-secondary);line-height:1.62}
  .cmo-md h1{font-size:19px;font-weight:800;color:var(--text-primary);margin:2px 0 12px}
  .cmo-md h2{font-size:15px;font-weight:750;color:var(--text-primary);margin:22px 0 9px;padding-top:14px;border-top:1px solid var(--border)}
  .cmo-md h3{font-size:13px;font-weight:750;color:var(--text-primary);margin:14px 0 7px}
  .cmo-md p{margin:0 0 10px}
  .cmo-md strong{color:var(--text-primary);font-weight:700}
  .cmo-md ul,.cmo-md ol{margin:0 0 11px;padding-left:18px;display:flex;flex-direction:column;gap:6px}
  .cmo-md li{padding-left:2px}
  .cmo-md code{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:1px 5px;color:var(--text-primary)}
  .cmo-md pre{margin:0 0 11px;padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:9px;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.5}
  .cmo-md pre code{background:none;border:none;padding:0}
  .cmo-md hr{border:none;border-top:1px solid var(--border);margin:16px 0}

  /* files */
  .cmo-files{display:flex;flex-direction:column;gap:18px;max-width:820px}
  .cmo-fgroup{border:1px solid var(--border);border-radius:11px;overflow:hidden;background:var(--bg-card)}
  .cmo-fgroup-head{display:flex;align-items:baseline;gap:10px;padding:11px 16px;border-bottom:1px solid var(--border);background:var(--bg-secondary)}
  .cmo-fgroup-title{font-size:12.5px;font-weight:750;color:var(--text-primary);letter-spacing:.02em}
  .cmo-fgroup-hint{font-size:11px;color:var(--text-muted)}
  .cmo-frow{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:11px 16px;border:none;border-bottom:1px solid var(--border);background:transparent;cursor:pointer;font-family:inherit;transition:background .1s}
  .cmo-frow:last-child{border-bottom:none}
  .cmo-frow:hover{background:var(--hover-bg-subtle,rgba(127,127,127,.04))}
  .cmo-frow-name{flex:0 0 auto;font-size:13px;font-weight:600;color:var(--text-primary)}
  .cmo-frow-path{flex:1;min-width:0;font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-frow-note{flex:0 0 auto;font-size:11px;color:var(--gold);font-weight:600}
  .cmo-empty{text-align:center;padding:56px 24px;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);font-size:13px}
    `}</style>
  );
}
