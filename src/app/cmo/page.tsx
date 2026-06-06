"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ============================================================ *
 * Jarvis brain — a window into a living thing. All particles drift
 * constantly (neuro-bounce around their points), the whole shape
 * rotates slowly, and a soft premium glow intensifies + leans toward
 * the cursor. Color is preserved (no blown-out central dot).
 * ============================================================ */
// Detect whether the app is currently in dark mode by reading the live --bg-card
// CSS variable's luminance. Lets the canvas pick dot colours that stay visible
// in BOTH themes (so the brain window is never a hard black block on a light page).
function readThemeDark(): boolean {
  try {
    let v = getComputedStyle(document.documentElement).getPropertyValue("--bg-card").trim();
    if (!v) v = getComputedStyle(document.body).backgroundColor;
    let r = 12, g = 12, b = 14;
    if (v.startsWith("#")) {
      const h = v.slice(1);
      const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
      r = parseInt(f.slice(0, 2), 16); g = parseInt(f.slice(2, 4), 16); b = parseInt(f.slice(4, 6), 16);
    } else {
      const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  } catch { return true; }
}

type BP = { vx: number; vy: number; vz: number; a: number; b: number; s: number };
function JarvisBrain({ size = 196 }: { size?: number }) {
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

    const N = 600;
    const golden = Math.PI * (3 - Math.sqrt(5));
    // fixed viewing angle (no rotation — it just lives)
    const tY = 0.18, tX = -0.42;
    const cYf = Math.cos(tY), sYf = Math.sin(tY), cXf = Math.cos(tX), sXf = Math.sin(tX);
    const pts: BP[] = [];
    for (let i = 0; i < N; i++) {
      const yy = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = golden * i;
      let x = Math.cos(th) * rr, y = yy, z = Math.sin(th) * rr;
      // brain form: central fissure -> two hemispheres, wide + flatter, folded surface
      x += Math.sign(x) * 0.15 * (1 - Math.abs(x));
      x *= 1.16; y *= 0.8; z *= 1.04;
      const bump = 1 + 0.1 * Math.sin(x * 6 + z * 3) * Math.cos(y * 5 + x * 2);
      x *= bump; y *= bump; z *= bump;
      // bake the fixed view rotation in
      const x2 = x * cYf - z * sYf, z2 = x * sYf + z * cYf;
      const y3 = y * cXf - z2 * sXf, z3 = y * sXf + z2 * cXf;
      pts.push({ vx: x2, vy: y3, vz: z3, a: Math.random() * 6.28, b: Math.random() * 6.28, s: 0.4 + Math.random() * 0.8 });
    }
    // synapse web: 2 nearest neighbours per point (computed once)
    const edges: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      let n1 = -1, d1 = 1e9, n2 = -1, d2 = 1e9;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const dx = pts[i].vx - pts[j].vx, dy = pts[i].vy - pts[j].vy, dz = pts[i].vz - pts[j].vz;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < d1) { d2 = d1; n2 = n1; d1 = dd; n1 = j; } else if (dd < d2) { d2 = dd; n2 = j; }
      }
      if (n1 > i) edges.push([i, n1]);
      if (n2 > i) edges.push([i, n2]);
    }

    let mx = -9999, my = -9999, target = 0;
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      target = 0.45 + 0.55 * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 800);
    };
    const onLeave = () => (target = 0);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseout", onLeave);

    let raf = 0;
    const start = performance.now();
    let infl = 0;
    let frame = 0;
    let themeDark = readThemeDark();
    const sx = new Float32Array(N), sy = new Float32Array(N), sd = new Float32Array(N);
    const render = (now: number) => {
      const t = (now - start) / 1000;
      infl += (target - infl) * 0.04;
      if ((frame++ % 30) === 0) themeDark = readThemeDark(); // follow live light/dark toggle
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2, cy = size / 2, R = size * 0.36;
      const breathe = 1 + Math.sin(t * 0.5) * 0.025;
      // the brain BODY stays locked in the centre. The mouse only adds internal
      // energy (the points move more) + brightens the aura — it never translates.
      const energy = 0.78 + 0.7 * infl;
      const auraRGB = themeDark ? "150,156,176" : "118,126,148";
      const lineRGB = themeDark ? "150,156,176" : "118,126,148";
      const lineMul = themeDark ? 1 : 1.5;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.7);
      grad.addColorStop(0, `rgba(${auraRGB},${(themeDark ? 0.05 : 0.04) + (themeDark ? 0.1 : 0.08) * infl})`);
      grad.addColorStop(1, `rgba(${auraRGB},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.7, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < N; i++) {
        const p = pts[i];
        // lots of constant motion AROUND each home point (alive), in view space
        const ox = (0.085 * Math.sin(t * 0.8 * p.s + p.a) + 0.05 * Math.sin(t * 1.45 + p.b)) * energy;
        const oy = (0.085 * Math.sin(t * 0.7 * p.s + p.b) + 0.05 * Math.cos(t * 1.25 + p.a)) * energy;
        const oz = (0.085 * Math.cos(t * 0.74 * p.s + p.a) + 0.05 * Math.sin(t * 1.55 + p.b)) * energy;
        const px = cx + (p.vx + ox) * R * breathe;
        const py = cy + (p.vy + oy) * R * breathe;
        const depth = (p.vz + oz + 1) / 2;
        sx[i] = px; sy[i] = py; sd[i] = depth;
      }

      // flickering synapses (constant neural firing; fires faster on hover)
      ctx.lineWidth = 0.5;
      for (let k = 0; k < edges.length; k++) {
        const i = edges[k][0], j = edges[k][1];
        const fl = 0.5 + 0.5 * Math.sin(t * (1.5 + infl * 1.4) + k * 0.7);
        const al = (0.04 + 0.11 * fl) * (0.35 + 0.65 * ((sd[i] + sd[j]) / 2)) * lineMul;
        ctx.strokeStyle = `rgba(${lineRGB},${al})`;
        ctx.beginPath();
        ctx.moveTo(sx[i], sy[i]);
        ctx.lineTo(sx[j], sy[j]);
        ctx.stroke();
      }

      for (let i = 0; i < N; i++) {
        const d = sd[i], r = 0.5 + d * 1.4;
        let cr: number, cg: number, cb: number, a: number;
        if (themeDark) {
          // soft cool white — refined, not yellow/orange
          cr = Math.round(208 + d * 26); cg = Math.round(210 + d * 24); cb = Math.round(218 + d * 20); a = 0.2 + d * 0.55;
        } else {
          // refined graphite, darker toward the front so points pop on a light card
          cr = Math.round(96 - d * 32); cg = Math.round(102 - d * 32); cb = Math.round(118 - d * 30); a = 0.32 + d * 0.5;
        }
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
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
    <div className="cmo-brain-window" style={{ width: size + 18, height: size + 18 }}>
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
  let inSec = false; // each "## " starts a readable card section
  const close = () => { if (list) { html += "</" + list + ">"; list = null; } };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) { close(); i++; let c = ""; while (i < lines.length && !/^```/.test(lines[i])) { c += lines[i] + "\n"; i++; } i++; html += "<pre>" + esc(c.replace(/\n$/, "")) + "</pre>"; continue; }
    if (/^\s*$/.test(ln)) { close(); i++; continue; }
    if (/^---+\s*$/.test(ln)) { close(); html += "<hr/>"; i++; continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      close();
      const lvl = h[1].length;
      if (lvl <= 2) { if (inSec) { html += "</section>"; inSec = false; } if (lvl === 2) { html += '<section class="cmo-sec">'; inSec = true; } }
      html += "<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">";
      i++; continue;
    }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (list !== "ol") { close(); list = "ol"; html += "<ol>"; } html += "<li>" + inline(ol[1]) + "</li>"; i++; continue; }
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== "ul") { close(); list = "ul"; html += "<ul>"; } html += "<li>" + inline(ul[1]) + "</li>"; i++; continue; }
    close(); html += "<p>" + inline(ln) + "</p>"; i++;
  }
  close();
  if (inSec) html += "</section>";
  return html;
}

type Skill = { id: string; name: string; tagline?: string; selfImproving?: boolean; path?: string; description?: string; markdown?: string };
type Meeting = { id: string; date?: string; title: string; creator?: string; tags?: string[]; summary?: string; notes?: string; archive?: string };
type FeedEntry = { at?: string; bucket?: string; title: string; detail?: string; tags?: string[]; where?: string };
type LoopStatus = "in-progress" | "waiting-on-alex" | "hypothesis" | "paused" | "backlog";
type Loop = { id: string; title: string; detail?: string; status: LoopStatus; priority?: "now" | "soon" | "later"; tags?: string[]; opened?: string; where?: string };
type LedgerEntry = { id: string; at?: string; kind?: string; title: string; value?: string; detail?: string; status?: string; result?: string };
const LOOP_META: Record<LoopStatus, { label: string; color: string }> = {
  "in-progress": { label: "In progress", color: "#5b8def" },
  "waiting-on-alex": { label: "Waiting on you", color: "#c9a96e" },
  "hypothesis": { label: "Hypothesis", color: "#a78bfa" },
  "paused": { label: "Paused", color: "#7c9cff" },
  "backlog": { label: "Backlog", color: "#8b8f98" },
};
const LOOP_ORDER: LoopStatus[] = ["in-progress", "waiting-on-alex", "hypothesis", "paused", "backlog"];

// Deuteran-safe palette: spread across blue / purple / teal / cyan / gold / amber / rose.
// No green-vs-red pairs (the dot is decorative anyway — the text label carries the meaning).
const BUCKET_COLOR: Record<string, string> = {
  "Copywriting rule": "#c9a96e",
  "Attribution rule": "#5b8def",
  "Coaching playbook": "#7c9cff",
  "Org / people": "#a78bfa",
  "How Alex thinks": "#d9a35b",
  "Company doctrine": "#c98bd6",
  "System / protocol": "#3fb6b2",
  "Meeting": "#a78bfa",
  "Creator context": "#e07ba0",
  "Feature spec": "#4cc4e0",
  "Identity": "#c9a96e",
};
const colorFor = (b?: string) => (b && BUCKET_COLOR[b]) || "#c9a96e";

/* ============================================================
 * BrainGraph — the CMO's knowledge as an Obsidian-style force
 * graph. Skills, meetings, and learnings become nodes; the tags
 * and "stored in" links they share pull related ideas into
 * clusters. A live force sim (repulsion + link springs + centre
 * gravity) lays it out. Drag a node to explore, scroll to zoom,
 * click to open it. Pure canvas, no deps, theme-aware.
 * ============================================================ */
type GFam = "skill" | "meeting" | "feed" | "loop" | "tag";
type GType = "skill" | "section" | "meeting" | "topic" | "feed" | "loop" | "tag";
type GNode = { id: string; type: GType; fam: GFam; label: string; refId?: string | number; parent?: string; r: number; ph: number; x: number; y: number; vx: number; vy: number };
// Premium palette — colour by FAMILY so communities read cleanly (deuteran-safe: gold/violet/cyan/coral/slate, no green-red pair).
// One gold hue, separated by BRIGHTNESS only (colorblind-safe — lightness is the one
// channel that survives color blindness; subtle hue steps don't). Wide luminance spread
// so the levels are unmistakable. Loops also get a bright ring in the renderer so the
// action items pop without depending on color at all.
const NODE_RGB: Record<GFam, [number, number, number]> = {
  skill: [242, 212, 152],   // brightest cream-gold (the hubs)
  loop: [224, 170, 104],    // bright warm gold (live action items — also ringed below)
  meeting: [180, 150, 102], // mid gold
  feed: [146, 124, 90],     // dim amber
  tag: [104, 94, 76],       // darkest bronze (connective tissue, recedes)
};
const headings = (md?: string) =>
  (md || "").split("\n").filter((l) => /^##\s+/.test(l)).map((l) => l.replace(/^##\s+/, "").replace(/[*`]/g, "").replace(/\s*\(.*$/, "").trim()).filter(Boolean);
function BrainGraph({ skills, meetings, feed, loops, onOpen }: { skills: Skill[]; meetings: Meeting[]; feed: FeedEntry[]; loops: Loop[]; onOpen: (kind: "skill" | "meeting" | "feed" | "loop", id: string | number) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<GNode | null>(null); // node shown in the inspector

  const graph = useMemo(() => {
    const nodes: GNode[] = [];
    const byId = new Map<string, GNode>();
    const edges: [string, string][] = [];
    let k = 0;
    const ph = () => (k++ % 23) * 0.27;
    const add = (n: GNode) => { nodes.push(n); byId.set(n.id, n); return n; };
    const tag = (t: string) => {
      const id = "tag:" + t.toLowerCase().trim();
      if (!byId.has(id)) add({ id, type: "tag", fam: "tag", label: t, r: 3.2, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
      return id;
    };
    skills.forEach((s) => {
      const hub = "skill:" + s.id;
      add({ id: hub, type: "skill", fam: "skill", refId: s.id, label: s.name, r: 11, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
      headings(s.markdown).slice(0, 12).forEach((h, si) => {
        const id = "sec:" + s.id + ":" + si;
        add({ id, type: "section", fam: "skill", refId: s.id, parent: hub, label: h, r: 4, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
        edges.push([hub, id]);
      });
    });
    meetings.forEach((m) => {
      const hub = "meeting:" + m.id;
      add({ id: hub, type: "meeting", fam: "meeting", refId: m.id, label: m.title, r: 9, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
      headings(m.notes).slice(0, 10).forEach((h, ti) => {
        const id = "top:" + m.id + ":" + ti;
        add({ id, type: "topic", fam: "meeting", refId: m.id, parent: hub, label: h, r: 4, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
        edges.push([hub, id]);
      });
      (m.tags || []).forEach((t) => edges.push([hub, tag(t)]));
    });
    feed.forEach((e, i) => {
      const id = "feed:" + i;
      add({ id, type: "feed", fam: "feed", refId: i, label: e.title, r: 5.5, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
      (e.tags || []).forEach((t) => edges.push([id, tag(t)]));
      if (e.where) {
        const w = e.where.toLowerCase();
        const sk = skills.find((s) => w.includes(s.id) || w.includes(s.name.toLowerCase()));
        if (sk) edges.push([id, "skill:" + sk.id]);
      }
    });
    loops.forEach((l, i) => {
      const id = "loop:" + l.id;
      add({ id, type: "loop", fam: "loop", refId: i, label: l.title, r: 5.5, ph: ph(), x: 0, y: 0, vx: 0, vy: 0 });
      (l.tags || []).forEach((t) => edges.push([id, tag(t)]));
    });
    const adj = new Map<string, Set<string>>();
    nodes.forEach((n) => adj.set(n.id, new Set()));
    edges.forEach(([a, b]) => { adj.get(a)?.add(b); adj.get(b)?.add(a); });
    return { nodes, edges, byId, adj };
  }, [skills, meetings, feed, loops]);

  useEffect(() => {
    const canvas = ref.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { nodes, edges, byId, adj } = graph;
    if (!nodes.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const H = 600;
    let W = wrap.clientWidth || 800;
    const resize = () => { W = wrap.clientWidth || 800; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    nodes.forEach((n, i) => { const a = (i / nodes.length) * Math.PI * 2; const rad = 50 + (i % 9) * 20; n.x = W / 2 + Math.cos(a) * rad; n.y = H / 2 + Math.sin(a) * rad; });

    let scale = 1, ox = 0, oy = 0;
    let hover: GNode | null = null, drag: GNode | null = null;
    let panning = false, lastX = 0, lastY = 0, moved = false, lastHoverId: string | null = null;
    let themeDark = readThemeDark(), frame = 0;
    const start = performance.now();

    const rect = () => canvas.getBoundingClientRect();
    const toWorld = (px: number, py: number) => ({ x: (px - ox) / scale, y: (py - oy) / scale });
    const pick = (px: number, py: number) => {
      const w = toWorld(px, py); let best: GNode | null = null, bd = 1e9;
      for (const n of nodes) { const dx = n.x - w.x, dy = n.y - w.y, d = dx * dx + dy * dy, hit = (n.r + 8) * (n.r + 8); if (d < hit && d < bd) { bd = d; best = n; } }
      return best;
    };
    const syncSel = () => { const id = hover ? hover.id : null; if (id !== lastHoverId) { lastHoverId = id; if (hover) setSel(hover); } };
    const onDown = (e: MouseEvent) => { const r = rect(); const x = e.clientX - r.left, y = e.clientY - r.top; const n = pick(x, y); moved = false; if (n) { drag = n; setSel(n); lastHoverId = n.id; } else { panning = true; lastX = x; lastY = y; } };
    const onMove = (e: MouseEvent) => {
      const r = rect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) { const w = toWorld(x, y); drag.x = w.x; drag.y = w.y; drag.vx = 0; drag.vy = 0; moved = true; }
      else if (panning) { ox += x - lastX; oy += y - lastY; lastX = x; lastY = y; moved = true; }
      else { hover = pick(x, y); canvas.style.cursor = hover ? "pointer" : "grab"; syncSel(); }
    };
    const onUp = () => {
      if (drag && !moved && drag.refId !== undefined) {
        const t = drag.type;
        if (t === "skill" || t === "section") onOpen("skill", drag.refId);
        else if (t === "meeting" || t === "topic") onOpen("meeting", drag.refId);
        else if (t === "feed") onOpen("feed", drag.refId);
        else if (t === "loop") onOpen("loop", drag.refId);
      }
      drag = null; panning = false;
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = rect(); const x = e.clientX - r.left, y = e.clientY - r.top; const ns = Math.max(0.4, Math.min(2.6, scale * Math.exp(-e.deltaY * 0.0015))); ox = x - (x - ox) * (ns / scale); oy = y - (y - oy) * (ns / scale); scale = ns; };
    const onLeave = () => { hover = null; };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mouseleave", onLeave);
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    let raf = 0;
    const step = (now: number) => {
      const t = (now - start) / 1000;
      if ((frame++ % 30) === 0) themeDark = readThemeDark();
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]; if (a === drag) continue;
        a.vx += (cx - a.x) * 0.0018; a.vy += (cy - a.y) * 0.0018;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue; const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 0.02) { dx = (i - j) * 0.5 + 0.1; dy = 0.3; d2 = dx * dx + dy * dy; }
          const d = Math.sqrt(d2), rep = 360 / d2;
          a.vx += (dx / d) * rep; a.vy += (dy / d) * rep;
        }
      }
      for (const [ai, bi] of edges) {
        const a = byId.get(ai)!, b = byId.get(bi)!;
        // hub→child = short, stiff spokes (tight clusters); tag links = looser connective tissue
        const spoke = a.parent === bi || b.parent === ai;
        const L = spoke ? 34 : (a.fam === "tag" || b.fam === "tag" ? 56 : 72);
        const K = spoke ? 0.038 : 0.012;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - L) * K, fx = (dx / d) * f, fy = (dy / d) * f;
        if (a !== drag) { a.vx += fx; a.vy += fy; }
        if (b !== drag) { b.vx -= fx; b.vy -= fy; }
      }
      for (const n of nodes) { if (n === drag) continue; n.vx *= 0.85; n.vy *= 0.85; const sp = Math.hypot(n.vx, n.vy); if (sp > 6) { n.vx *= 6 / sp; n.vy *= 6 / sp; } n.x += n.vx; n.y += n.vy; const p = n.r + 6; n.x = Math.max(p, Math.min(W - p, n.x)); n.y = Math.max(p, Math.min(H - p, n.y)); }

      // ---- premium render ----
      ctx.clearRect(0, 0, W, H);
      // soft nebula behind everything (screen space)
      const neb = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, Math.max(W, H) * 0.62);
      if (themeDark) { neb.addColorStop(0, "rgba(46,44,68,0.40)"); neb.addColorStop(0.5, "rgba(20,22,34,0.18)"); neb.addColorStop(1, "rgba(0,0,0,0)"); }
      else { neb.addColorStop(0, "rgba(120,128,168,0.07)"); neb.addColorStop(1, "rgba(0,0,0,0)"); }
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);

      ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
      const hl = hover, nbr = hl ? adj.get(hl.id) : null;
      const textRGB = themeDark ? "236,234,228" : "40,40,46";

      // edges — synapse threads, glow brighter along the hovered node's connections
      for (const [ai, bi] of edges) {
        const a = byId.get(ai)!, b = byId.get(bi)!;
        const on = !!hl && (ai === hl.id || bi === hl.id);
        const [er, eg, eb] = NODE_RGB[(a.fam === "tag" ? b.fam : a.fam)];
        if (on) {
          ctx.strokeStyle = `rgba(${er},${eg},${eb},0.55)`; ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = `rgba(${er},${eg},${eb},${hl ? 0.03 : (themeDark ? 0.1 : 0.13)})`; ctx.lineWidth = 0.6;
        }
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      // nodes — refined SaaS dots (flat core + subtle top-light + hairline ring + tight glow). No cartoon shine.
      const isHub = (n: GNode) => n.type === "skill" || n.type === "meeting";
      for (const n of nodes) {
        const active = !hl || n === hl || !!(nbr && nbr.has(n.id));
        const [r, g, b] = NODE_RGB[n.fam];
        const pulse = 0.6 + 0.22 * Math.sin(t * 0.95 + n.ph);
        const focus = n === hl ? 1.4 : 1;
        const aMul = active ? 1 : 0.14;
        const rr = n.r * focus;
        // tight, subtle glow (not a fuzzy ball)
        const hmul = n.type === "tag" ? 1.5 : isHub(n) ? 2.1 : (n.type === "section" || n.type === "topic") ? 1.65 : 1.9;
        const hr = rr * hmul;
        const halo = ctx.createRadialGradient(n.x, n.y, rr * 0.55, n.x, n.y, hr);
        halo.addColorStop(0, `rgba(${r},${g},${b},${(n === hl ? 0.34 : 0.16) * pulse * aMul})`);
        halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(n.x, n.y, hr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = aMul;
        // core — solid fill with a subtle top-light gradient (refined, not glossy)
        const lr = (r + (255 - r) * 0.18) | 0, lg = (g + (255 - g) * 0.18) | 0, lb = (b + (255 - b) * 0.18) | 0;
        const core = ctx.createRadialGradient(n.x - rr * 0.34, n.y - rr * 0.42, rr * 0.1, n.x, n.y, rr * 1.25);
        core.addColorStop(0, `rgb(${lr},${lg},${lb})`); core.addColorStop(1, `rgb(${r},${g},${b})`);
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, Math.PI * 2); ctx.fill();
        // hairline ring (darker family colour) for crisp definition
        ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${(r * 0.45) | 0},${(g * 0.45) | 0},${(b * 0.45) | 0},${themeDark ? 0.55 : 0.42})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, rr - 0.5, 0, Math.PI * 2); ctx.stroke();
        // loops (action items) get a bright ring — a lightness/shape cue, not a colour cue (colorblind-safe)
        if (n.fam === "loop") { ctx.lineWidth = 1.4; ctx.strokeStyle = `rgba(248,232,196,${(themeDark ? 0.92 : 0.7) * aMul})`; ctx.beginPath(); ctx.arc(n.x, n.y, rr + 2.2, 0, Math.PI * 2); ctx.stroke(); }
        if (n === hl) { ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`; ctx.beginPath(); ctx.arc(n.x, n.y, rr + 3, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
        // labels: hubs always; the hovered node + its direct neighbours
        const showLabel = active && (isHub(n) || n === hl || !!(nbr && nbr.has(n.id)));
        if (showLabel) {
          const fs = isHub(n) ? 12 : 10;
          ctx.font = `${isHub(n) || n === hl ? 700 : 500} ${fs}px ui-sans-serif,system-ui,sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          const label = n.label.length > 24 ? n.label.slice(0, 23) + "…" : n.label;
          ctx.fillStyle = `rgba(${textRGB},${n === hl ? 0.98 : isHub(n) ? 0.82 : 0.7})`;
          ctx.fillText(label, n.x, n.y + n.r * focus + 4);
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("mouseleave", onLeave); ro.disconnect(); };
  }, [graph, onOpen]);

  // resolve the inspector contents from the selected node
  const counts = useMemo(() => ({
    skills: graph.nodes.filter((n) => n.type === "skill").length,
    meetings: graph.nodes.filter((n) => n.type === "meeting").length,
    learnings: graph.nodes.filter((n) => n.type === "feed").length,
    loops: graph.nodes.filter((n) => n.type === "loop").length,
    tags: graph.nodes.filter((n) => n.type === "tag").length,
    nodes: graph.nodes.length,
  }), [graph]);

  const info = useMemo(() => {
    if (!sel) return null;
    if (sel.type === "skill") { const s = skills.find((x) => x.id === sel.refId); return s ? { kind: "Skill", color: NODE_RGB.skill, title: s.name, sub: s.tagline, body: s.description, foot: s.path, open: () => onOpen("skill", s.id) } : null; }
    if (sel.type === "section") { const s = skills.find((x) => x.id === sel.refId); return s ? { kind: "Skill section", color: NODE_RGB.skill, title: sel.label, sub: "in " + s.name, body: "A section of the " + s.name + " skill.", open: () => onOpen("skill", s.id) } : null; }
    if (sel.type === "meeting") { const m = meetings.find((x) => x.id === sel.refId); return m ? { kind: "Meeting", color: NODE_RGB.meeting, title: m.title, sub: [m.date, m.creator].filter(Boolean).join(" · "), body: m.summary, tags: m.tags, open: () => onOpen("meeting", m.id) } : null; }
    if (sel.type === "topic") { const m = meetings.find((x) => x.id === sel.refId); return m ? { kind: "Meeting topic", color: NODE_RGB.meeting, title: sel.label, sub: "in " + m.title, body: "A topic from this meeting.", open: () => onOpen("meeting", m.id) } : null; }
    if (sel.type === "feed") { const e = feed[sel.refId as number]; return e ? { kind: e.bucket || "Learning", color: NODE_RGB.feed, title: e.title, body: e.detail, tags: e.tags, foot: e.where ? "stored in " + e.where : undefined, open: () => onOpen("feed", sel.refId as number) } : null; }
    if (sel.type === "loop") { const l = loops[sel.refId as number]; return l ? { kind: "Open loop", color: NODE_RGB.loop, title: l.title, sub: l.status, body: l.detail, tags: l.tags, open: () => onOpen("loop", sel.refId as number) } : null; }
    const conn = graph.adj.get(sel.id)?.size || 0;
    return { kind: "Tag", color: NODE_RGB.tag, title: "#" + sel.label, body: `Connects ${conn} ${conn === 1 ? "thing" : "things"} across skills, meetings, learnings and loops.` };
  }, [sel, skills, meetings, feed, loops, graph, onOpen]);

  const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  return (
    <div className="cmo-graph">
      <div className="cmo-graph-head">
        <div className="cmo-graph-legend">
          <span><i style={{ background: rgb(NODE_RGB.skill) }} /> Skills</span>
          <span><i style={{ background: rgb(NODE_RGB.meeting) }} /> Meetings</span>
          <span><i style={{ background: rgb(NODE_RGB.feed) }} /> Learnings</span>
          <span><i style={{ background: rgb(NODE_RGB.loop) }} /> Loops</span>
          <span><i style={{ background: rgb(NODE_RGB.tag) }} /> Tags</span>
        </div>
        <div className="cmo-graph-hint">{counts.nodes} nodes · drag · scroll to zoom · hover to inspect</div>
      </div>
      <div className="cmo-graph-body">
        <div className="cmo-graph-canvas" ref={wrapRef}><canvas ref={ref} /></div>
        <aside className="cmo-graph-info">
          {info ? (
            <div className="cmo-ins">
              <span className="cmo-ins-kind" style={{ color: rgb(info.color), borderColor: rgb(info.color, 0.4), background: rgb(info.color, 0.12) }}>{info.kind}</span>
              <h3 className="cmo-ins-title">{info.title}</h3>
              {info.sub && <div className="cmo-ins-sub">{info.sub}</div>}
              {info.body && <p className="cmo-ins-body">{info.body}</p>}
              {info.tags && info.tags.length > 0 && <div className="cmo-ins-tags">{info.tags.slice(0, 8).map((t, i) => <span key={i}>{t}</span>)}</div>}
              {info.foot && <div className="cmo-ins-foot">{info.foot}</div>}
              {info.open && <button className="cmo-ins-open" onClick={info.open}>Open →</button>}
            </div>
          ) : (
            <div className="cmo-ins cmo-ins-empty">
              <div className="cmo-ins-title">The CMO brain</div>
              <p className="cmo-ins-body">Every skill, meeting, and learning, wired by the tags they share. Hover any node to inspect it here.</p>
              <div className="cmo-ins-stats">
                <span><b style={{ color: rgb(NODE_RGB.skill) }}>{counts.skills}</b> skills</span>
                <span><b style={{ color: rgb(NODE_RGB.meeting) }}>{counts.meetings}</b> meetings</span>
                <span><b style={{ color: rgb(NODE_RGB.feed) }}>{counts.learnings}</b> learnings</span>
                <span><b style={{ color: rgb(NODE_RGB.loop) }}>{counts.loops}</b> open loops</span>
                <span><b style={{ color: rgb(NODE_RGB.tag) }}>{counts.tags}</b> tags</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const TRANSCRIPTS = [
  { name: "Team strategy (3h)", sub: "2026-06-05", path: "~/.claude/.../transcripts/2026-06-05-team-strategy-deep.md", meetingId: "2026-06-05-team-strategy" },
  { name: "Zakk coaching call", sub: "2026-06-04", path: "~/.claude/.../transcripts/2026-06-04-zakk-coaching-call.md", meetingId: "2026-06-04-zakk-coaching" },
];

type Tab = "brain" | "loops" | "ledger" | "feed" | "skills" | "meetings" | "files";

export default function CmoPage() {
  const [tab, setTab] = useState<Tab>("brain");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loops, setLoops] = useState<Loop[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [openLedger, setOpenLedger] = useState<string | null>(null);
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
    grab("/open-loops.json", "loops", (v) => setLoops(Array.isArray(v) ? (v as Loop[]) : []));
    grab("/cmo-ledger.json", "entries", (v) => setLedger(Array.isArray(v) ? (v as LedgerEntry[]) : []));
    return () => { off = true; };
  }, []);

  const activeSkill = useMemo(() => skills.find((s) => s.id === openSkill) || null, [skills, openSkill]);
  const activeMeeting = useMemo(() => meetings.find((m) => m.id === openMeeting) || null, [meetings, openMeeting]);
  const inDetail = activeSkill || activeMeeting;
  const decisionEntries = useMemo(() => ledger.filter((e) => e.kind === "decision"), [ledger]);
  const workEntries = useMemo(() => ledger.filter((e) => e.kind !== "decision"), [ledger]);
  const ledgerStats = useMemo(() => {
    const graded = decisionEntries.filter((e) => e.result && e.result.trim());
    return [
      { n: String(ledger.filter((e) => e.value).length), label: "value wins" },
      { n: String(decisionEntries.length), label: "decisions made" },
      { n: decisionEntries.length ? `${graded.length}/${decisionEntries.length}` : "0", label: "graded" },
      { n: String(ledger.length), label: "actions logged" },
    ];
  }, [ledger, decisionEntries]);
  const ledgerRow = (e: LedgerEntry) => {
    const open = openLedger === e.id;
    const dec = e.kind === "decision";
    return (
      <div key={e.id} className={"cmo-imp-row" + (open ? " open" : "") + (dec ? " dec" : "")} onClick={() => setOpenLedger(open ? null : e.id)}>
        <div className="cmo-imp-rowhead">
          <div className="cmo-imp-rowtext">
            <div className="cmo-imp-titleline">
              <span className="cmo-imp-title">{e.title}</span>
              {e.value && <span className="cmo-imp-val">{e.value}</span>}
            </div>
            <div className="cmo-imp-meta">
              <span className="cmo-imp-kind">{e.kind || "work"}</span>
              <span className="cmo-imp-sep">·</span>
              <span>{e.at}</span>
              {e.status && <span className={"cmo-imp-status s-" + e.status}>{e.status === "pending" ? "awaiting grade" : e.status}</span>}
            </div>
          </div>
          <span className="cmo-imp-chev">{open ? "−" : "+"}</span>
        </div>
        {open && (
          <div className="cmo-imp-detail">
            {e.detail && <p>{e.detail}</p>}
            {e.result && e.result.trim() && <p className="cmo-imp-result"><span>result</span>{e.result}</p>}
          </div>
        )}
      </div>
    );
  };

  // open a graph node → jump to the right tab + detail
  const openNode = useCallback((kind: "skill" | "meeting" | "feed" | "loop", id: string | number) => {
    if (kind === "skill") { setTab("skills"); setOpenSkill(id as string); }
    else if (kind === "meeting") { setTab("meetings"); setOpenMeeting(id as string); }
    else if (kind === "loop") { setTab("loops"); }
    else { setTab("feed"); setOpenFeed(id as number); }
  }, []);
  const fileMeeting = fileSel?.kind === "meeting" ? meetings.find((m) => m.id === fileSel.id) : fileSel?.kind === "transcript" ? meetings.find((m) => m.id === fileSel.id) : null;
  const fileSkill = fileSel?.kind === "skill" ? skills.find((s) => s.id === fileSel.id) : null;

  return (
    <div className="cmo">
      <CmoStyles />

      <header className="cmo-top">
        <div className="cmo-brand">
          <JarvisBrain size={200} />
          <div>
            <h1>CMO</h1>
            <div className="cmo-status"><span className="cmo-dot" /> active · self-improving · learning live</div>
          </div>
        </div>
        <nav className="cmo-nav">
          {(["brain", "ledger", "feed", "skills", "meetings", "files"] as Tab[]).map((tk) => (
            <button key={tk} className={tab === tk && !inDetail ? "on" : ""} onClick={() => { setTab(tk); setOpenSkill(null); setOpenMeeting(null); }}>
              {tk === "brain" ? "Brain" : tk === "ledger" ? "Impact" : tk === "feed" ? "Learning feed" : tk === "files" ? "Files" : tk === "skills" ? "Skills" : "Meetings"}
            </button>
          ))}
        </nav>
      </header>

      {inDetail && <button className="cmo-back" onClick={() => { setOpenSkill(null); setOpenMeeting(null); }}>← back</button>}

      {/* BRAIN — Obsidian-style knowledge graph */}
      {tab === "brain" && !inDetail && (
        <BrainGraph skills={skills} meetings={meetings} feed={feed} loops={loops} onOpen={openNode} />
      )}

      {/* OPEN LOOPS — what's in flight / waiting / unsure, so nothing falls into the abyss */}
      {tab === "loops" && !inDetail && (
        <section className="cmo-loops">
          <div className="cmo-loops-intro">Everything in flight, waiting on you, or still a hypothesis. The active priority is at the top.</div>
          {LOOP_ORDER.filter((st) => loops.some((l) => l.status === st)).map((st) => (
            <div key={st} className="cmo-loop-group">
              <div className="cmo-loop-grouphead"><span className="cmo-loop-gdot" style={{ background: LOOP_META[st].color }} />{LOOP_META[st].label}</div>
              {loops.filter((l) => l.status === st).map((l) => (
                <div key={l.id} className="cmo-loop" style={{ "--lc": LOOP_META[st].color } as React.CSSProperties}>
                  <div className="cmo-loop-top">
                    <span className="cmo-loop-title">{l.title}</span>
                    {l.priority && <span className={"cmo-loop-pri pri-" + l.priority}>{l.priority}</span>}
                  </div>
                  {l.detail && <p className="cmo-loop-detail">{l.detail}</p>}
                  {(l.tags || l.where) && (
                    <div className="cmo-loop-meta">
                      {(l.tags || []).map((t, i) => <span key={i} className="cmo-tag">{t}</span>)}
                      {l.where && <span className="cmo-where">{l.where}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {loops.length === 0 && <div className="cmo-empty">No open loops. Clean slate.</div>}
        </section>
      )}

      {/* LEDGER — proof of work: what I did, what it was worth, decisions + their graded results */}
      {tab === "ledger" && !inDetail && (
        <section className="cmo-imp">
          <div className="cmo-imp-hero">
            <div className="cmo-imp-herolead">
              <span className="cmo-imp-eyebrow">Impact · proof of value</span>
              <h2 className="cmo-imp-headline">What I&apos;ve produced &mdash; measured, not claimed.</h2>
            </div>
            <div className="cmo-imp-metrics">
              {ledgerStats.map((s, i) => (
                <div key={s.label} className={"cmo-imp-metric" + (i === 0 ? " lead" : "")}>
                  <span className="cmo-imp-metricn">{s.n}</span>
                  <span className="cmo-imp-metricl">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {decisionEntries.length > 0 && (
            <div className="cmo-imp-section">
              <div className="cmo-imp-sechead"><span className="cmo-imp-secdot dec" />Decisions<em>the calls I made &mdash; and how they played out</em></div>
              <div className="cmo-imp-rows">{decisionEntries.map(ledgerRow)}</div>
            </div>
          )}

          {workEntries.length > 0 && (
            <div className="cmo-imp-section">
              <div className="cmo-imp-sechead"><span className="cmo-imp-secdot" />Work shipped<em>the evidence</em></div>
              <div className="cmo-imp-rows">{workEntries.map(ledgerRow)}</div>
            </div>
          )}

          {ledger.length === 0 && <div className="cmo-empty">No work logged yet.</div>}
        </section>
      )}

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
  .cmo-brain-window{flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border);background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--text-primary) 4%,var(--bg-card)),var(--bg-card) 78%);box-shadow:inset 0 0 20px -12px rgba(0,0,0,.18)}
  .cmo h1{font-size:26px;font-weight:800;letter-spacing:-.4px;color:var(--text-primary);margin:0 0 6px}
  .cmo-status{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#3fb27f);box-shadow:0 0 8px var(--green,#3fb27f)}
  .cmo-nav{display:inline-flex;gap:2px;padding:3px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;margin-left:auto}
  .cmo-nav button{padding:7px 14px;border:none;background:transparent;color:var(--text-muted);font-size:12.5px;font-weight:600;border-radius:7px;cursor:pointer;font-family:inherit}
  .cmo-nav button:hover{color:var(--text-secondary)}
  .cmo-nav button.on{background:var(--bg-card);color:var(--text-primary);box-shadow:0 1px 2px rgba(0,0,0,.15)}
  .cmo-back{background:none;border:none;color:var(--text-muted);font-size:13px;font-weight:600;cursor:pointer;margin-bottom:16px;padding:0;font-family:inherit}
  .cmo-back:hover{color:var(--text-primary)}

  /* brain graph */
  .cmo-graph{border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--bg-card)}
  .cmo-graph-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);background:var(--bg-secondary);flex-wrap:wrap}
  .cmo-graph-legend{display:flex;gap:15px;flex-wrap:wrap}
  .cmo-graph-legend span{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--text-secondary)}
  .cmo-graph-legend i{width:9px;height:9px;border-radius:50%;display:inline-block;box-shadow:0 0 6px currentColor}
  .cmo-graph-hint{font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-graph-body{display:grid;grid-template-columns:1fr 300px}
  .cmo-graph-canvas{height:600px;cursor:grab;min-width:0}
  .cmo-graph-canvas canvas{display:block}
  .cmo-graph-info{height:600px;overflow:auto;border-left:1px solid var(--border);background:linear-gradient(180deg,color-mix(in srgb,var(--text-primary) 3%,var(--bg-card)),var(--bg-card));padding:20px 18px}
  .cmo-ins{display:flex;flex-direction:column;gap:11px}
  .cmo-ins-kind{align-self:flex-start;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:999px;border:1px solid}
  .cmo-ins-title{font-size:16px;font-weight:800;color:var(--text-primary);margin:0;line-height:1.3}
  .cmo-ins-sub{font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);margin-top:-4px}
  .cmo-ins-body{font-size:12.5px;color:var(--text-secondary);line-height:1.6;margin:0}
  .cmo-ins-tags{display:flex;flex-wrap:wrap;gap:5px}
  .cmo-ins-tags span{font-size:10px;color:var(--text-secondary);background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:2px 7px}
  .cmo-ins-foot{font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);word-break:break-word}
  .cmo-ins-open{align-self:flex-start;margin-top:4px;font-size:12px;font-weight:700;color:var(--text-primary);background:var(--bg-secondary);border:1px solid var(--border-hover,var(--border));border-radius:8px;padding:7px 13px;cursor:pointer;font-family:inherit;transition:transform .1s,border-color .14s}
  .cmo-ins-open:hover{transform:translateY(-1px);border-color:var(--gold)}
  .cmo-ins-empty{gap:14px}
  .cmo-ins-stats{display:flex;flex-direction:column;gap:7px;margin-top:4px;padding-top:14px;border-top:1px solid var(--border)}
  .cmo-ins-stats span{font-size:12.5px;color:var(--text-muted)}
  .cmo-ins-stats b{font-size:15px;font-weight:800;margin-right:6px}
  @media(max-width:720px){.cmo-graph-body{grid-template-columns:1fr}.cmo-graph-info{height:auto;border-left:none;border-top:1px solid var(--border)}}

  /* open loops */
  .cmo-loops{display:flex;flex-direction:column;gap:22px}
  .cmo-loops-intro{font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:-6px}
  .cmo-loop-group{display:flex;flex-direction:column;gap:10px}
  .cmo-loop-grouphead{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-primary)}
  .cmo-loop-gdot{width:8px;height:8px;border-radius:50%;box-shadow:0 0 7px currentColor}
  .cmo-loop{border:1px solid var(--border);border-left:3px solid var(--lc);border-radius:11px;background:var(--bg-card);padding:14px 16px;display:flex;flex-direction:column;gap:8px}
  .cmo-loop-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .cmo-loop-title{font-size:14.5px;font-weight:700;color:var(--text-primary)}
  .cmo-loop-pri{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .cmo-loop-pri.pri-now{color:#e0915b;background:color-mix(in srgb,#e0915b 14%,transparent);border:1px solid color-mix(in srgb,#e0915b 36%,transparent)}
  .cmo-loop-pri.pri-soon{color:var(--text-secondary);background:var(--bg-secondary);border:1px solid var(--border)}
  .cmo-loop-pri.pri-later{color:var(--text-muted);background:var(--bg-secondary);border:1px solid var(--border)}
  .cmo-loop-detail{margin:0;font-size:12.5px;color:var(--text-secondary);line-height:1.6}
  .cmo-loop-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}

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

  /* detail — always sits inside a readable card (matches the Files viewer Alex likes) */
  .cmo-detail{max-width:820px;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:24px 26px}
  .cmo-detail-head{display:flex;align-items:center;gap:12px}
  .cmo-detail-head h2{font-size:22px;font-weight:800;color:var(--text-primary);margin:0}
  .cmo-detail-sub{font-size:13px;color:var(--gold);margin-top:6px;font-weight:600}
  .cmo-detail-desc{font-size:13.5px;color:var(--text-secondary);line-height:1.55;margin:14px 0 4px}
  .cmo-detail-path{font-size:11px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace);background:var(--bg-secondary);border:1px solid var(--border);border-radius:7px;padding:7px 11px;margin:10px 0 18px;display:inline-block}
  .cmo-md{font-size:13.5px;color:var(--text-secondary);line-height:1.64}
  .cmo-md h1{font-size:19px;font-weight:800;color:var(--text-primary);margin:2px 0 14px}
  /* each "## " section is its own raised panel so dense skills read in chunks */
  .cmo-md .cmo-sec{background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:16px 18px 6px;margin:0 0 14px}
  .cmo-md .cmo-sec>h2:first-child{margin-top:0}
  .cmo-md h2{font-size:16.5px;font-weight:800;color:var(--text-primary);margin:4px 0 12px;line-height:1.32}
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
  .cmo-fgroup-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:11px 15px;background:var(--bg-secondary);border-bottom:1px solid var(--border)}
  .cmo-fgroup-title{font-size:13.5px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:var(--text-primary)}
  .cmo-fgroup-hint{font-size:10px;color:var(--text-muted)}
  .cmo-frow{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:9px 15px;border:none;border-bottom:1px solid var(--border);background:transparent;cursor:pointer;font-family:inherit;transition:background .1s}
  .cmo-frow:last-child{border-bottom:none}
  .cmo-frow:hover{background:color-mix(in srgb,var(--text-primary) 4%,transparent)}
  .cmo-frow.on{background:color-mix(in srgb,var(--gold) 12%,transparent);box-shadow:inset 2px 0 0 var(--gold)}
  .cmo-frow-name{font-size:12.5px;font-weight:600;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmo-frow.on .cmo-frow-name{color:var(--text-primary);font-weight:700}
  .cmo-frow-sub{flex:0 0 auto;font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono,ui-monospace,Menlo,monospace)}
  .cmo-files-view{min-width:0;min-height:300px}
  .cmo-files-empty{color:var(--text-muted);font-size:13px;padding:40px 0;text-align:center}
  .cmo-tnote{font-size:11.5px;color:var(--text-muted);background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:9px 12px;margin-bottom:16px}
  .cmo-empty{text-align:center;padding:56px 24px;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);font-size:13px}
  .cmo-imp{max-width:840px;margin:0 auto}
  .cmo-imp-hero{position:relative;display:flex;justify-content:space-between;align-items:flex-end;gap:28px;flex-wrap:wrap;border:1px solid var(--border);border-radius:16px;padding:26px 26px 24px;overflow:hidden;margin-bottom:26px;background:radial-gradient(130% 150% at 0% 0%, rgba(201,169,110,.12), transparent 55%), var(--bg-secondary)}
  .cmo-imp-herolead{flex:1;min-width:240px}
  .cmo-imp-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.18em;color:#d8b673;font-weight:700}
  .cmo-imp-headline{font-size:23px;font-weight:760;color:var(--text-primary);letter-spacing:-.025em;line-height:1.18;margin:11px 0 0;max-width:420px}
  .cmo-imp-metrics{display:flex;gap:18px;align-items:flex-end}
  .cmo-imp-metric{display:flex;flex-direction:column;gap:4px;text-align:right}
  .cmo-imp-metric.lead{padding-right:18px;margin-right:0;border-right:1px solid var(--border)}
  .cmo-imp-metricn{font-size:22px;font-weight:750;color:var(--text-secondary);font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1}
  .cmo-imp-metric.lead .cmo-imp-metricn{font-size:38px;color:#d8b673;text-shadow:0 0 24px rgba(201,169,110,.35)}
  .cmo-imp-metricl{font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);white-space:nowrap}
  .cmo-imp-section{margin-bottom:24px}
  .cmo-imp-sechead{display:flex;align-items:center;gap:9px;font-size:11.5px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:.09em;margin:0 2px 13px}
  .cmo-imp-sechead em{font-style:normal;font-weight:400;text-transform:none;letter-spacing:0;font-size:11.5px;color:var(--text-muted)}
  .cmo-imp-secdot{width:7px;height:7px;border-radius:50%;background:var(--text-muted);flex-shrink:0}
  .cmo-imp-secdot.dec{background:#d8b673;box-shadow:0 0 9px rgba(201,169,110,.6)}
  .cmo-imp-rows{display:flex;flex-direction:column;gap:8px}
  .cmo-imp-row{border:1px solid var(--border);border-radius:12px;background:var(--bg-secondary);cursor:pointer;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease}
  .cmo-imp-row:hover{transform:translateY(-1px);border-color:rgba(201,169,110,.4);box-shadow:0 6px 20px -12px rgba(0,0,0,.5)}
  .cmo-imp-row.dec{border-left:2.5px solid rgba(201,169,110,.6)}
  .cmo-imp-row.open{border-color:rgba(201,169,110,.4)}
  .cmo-imp-rowhead{display:flex;align-items:flex-start;gap:14px;padding:15px 16px}
  .cmo-imp-rowtext{flex:1;min-width:0}
  .cmo-imp-titleline{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  .cmo-imp-title{font-size:14px;font-weight:650;color:var(--text-primary);line-height:1.35;letter-spacing:-.01em}
  .cmo-imp-val{flex-shrink:0;font-size:11px;font-weight:700;color:#e3c281;background:rgba(201,169,110,.13);border:1px solid rgba(201,169,110,.3);padding:4px 10px;border-radius:7px;white-space:nowrap;letter-spacing:.01em;font-variant-numeric:tabular-nums}
  .cmo-imp-meta{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--text-muted)}
  .cmo-imp-kind{text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:10px;color:var(--text-secondary)}
  .cmo-imp-sep{opacity:.5}
  .cmo-imp-status{margin-left:4px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;font-weight:600;padding:2px 8px;border-radius:5px;border:1px solid var(--border)}
  .cmo-imp-status.s-shipped{color:#9ec9a6;border-color:rgba(158,201,166,.3)}
  .cmo-imp-status.s-pending{color:#e3c281;border-color:rgba(201,169,110,.35);background:rgba(201,169,110,.06)}
  .cmo-imp-chev{flex-shrink:0;font-size:17px;color:var(--text-muted);line-height:1;width:14px;text-align:center;font-weight:300}
  .cmo-imp-detail{margin:0 16px;padding:13px 0 16px;border-top:1px solid var(--border);color:var(--text-secondary);font-size:12.5px;line-height:1.62}
  .cmo-imp-detail p{margin:0 0 9px}
  .cmo-imp-detail p:last-child{margin-bottom:0}
  .cmo-imp-result{color:var(--text-primary)}
  .cmo-imp-result span{display:inline-block;color:#d8b673;text-transform:uppercase;font-size:9px;letter-spacing:.1em;margin-right:9px;font-weight:700}
  @media(max-width:760px){.cmo-files{grid-template-columns:1fr}.cmo-files-list{position:static}}
    `}</style>
  );
}
