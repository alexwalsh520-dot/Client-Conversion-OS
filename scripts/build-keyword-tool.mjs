// Build the keyword triage tool. Pulls the full "taken" set (Supabase fired
// keywords + organic + Tyson live ad names + Antwan live ad names), filters a
// large plain-word candidate pool against it, and writes a fast keyboard-driven
// HTML triage page to ~/Desktop/keyword-triage.html.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const envText = fs.readFileSync(".env.local", "utf8");
const env = (k) => {
  const line = envText.split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!line) return "";
  let v = line.slice(k.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
};
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const taken = new Set();
const addTokens = (raw) => {
  for (const tok of String(raw || "").split(/[^a-zA-Z]+/)) {
    const n = norm(tok);
    if (n.length >= 2) taken.add(n);
  }
};

// 1. Supabase: fired keywords (all clients) + organic.
for (const tbl of ["ads_keyword_events", "organic_keywords"]) {
  const { data, error } = await sb.from(tbl).select("keyword_normalized");
  if (error) { console.warn(`warn ${tbl}:`, error.message); continue; }
  for (const r of data || []) taken.add(norm(r.keyword_normalized));
}
// 2. Tyson live ad names.
try { for (const ln of fs.readFileSync("/tmp/tyson_adnames.txt", "utf8").split(/\r?\n/)) addTokens(ln); } catch {}
// 3. Antwan 38 live ad names.
`PRESS BOLD ELITE BOOST VITAL COMMITTED STEEL PUMPED VICTORY LOCKED SPARK PRIME CARVED LEGEND SURGE SWOLE EARN RISE SHARP LIFTED DIALED APEX JACKED FUEL FLEX IGNITE FORGE LIFT DEFINED THRIVE PUSH GRIT CHAMPION RIPPED UPGRADE FORGED CHISELED STACKED`
  .split(/\s+/).forEach((w) => taken.add(norm(w)));

console.log(`Taken set size: ${taken.size}`);

// ---- Candidate pool: SUPER SIMPLE NEUTRAL everyday words (Alex's taste) ----
// Standard = Fix, Change, Fit, Win, True, Real, Goal, Team, Set, Better. Plain
// words that could name anything. NO theme/flavor (no surf/coast/forge/ember),
// no ornate words, no slang. Short. Dedup + taken-filter happen below.
const POOL = `
fix change win set make plan move step build lead hold keep grow gain add reach find learn teach help give share show tell ask try work run lift push pull turn shift swap trade save earn fit shape train rest track log check test score rank sort pick aim focus tune guide count read write mark rate map list note boost raise fund back serve stand drive ride scan plan start open close cut drop carry catch
goal plan team win step path mark score level rank base core mind body life food meal gym rep set lap mile pace deal work job task list note point edge prize game match round rule code line grid chart map log unit crew group zone spot lane goal aim plan
fit real true new fresh clean clear calm cool fast easy hard big full half best more good strong lean light ready firm solid sure safe free bold whole flat tall fine able fair mild warm bright quick keen neat tidy steady stable level even plain
yes done next now first last more most plus extra
trim tone build shape lift firm
plan goal win team
total simple basic clear
solid stable steady ready
fresh clean clear bright
fast easy quick light
real true sure safe
big bold full best
keep grow gain rise
move step lead pace
mark score track rank
focus aim tune dial
check test rate sort
save earn fund deal
help give share show
learn teach guide coach
find pick choose select
fit lean firm tone
start begin set go
plan map chart list
work train rest reset
hold keep guard cover
turn shift swap trade
add boost raise lift
read write note log
count rate score mark
true real honest clear
calm cool easy mild
neat tidy clean plain
sure safe solid firm
ready set steady level
send bring take place put name call join meet pass order fill pack sign draw fold tie link merge pair file edit renew repeat review spell type
home area room door key card coin cash price cost class kit tool page book deal name
new old good less few many much high low deep wide short long thin soft dark dry warm cool main top size
hand foot face head step lap mile pace
day week year date time hour
left right up down near far
half full part whole each both
gold silver clay stone
calm easy plain basic total
fix mend patch fit form
size scale grade shape
plan list note page book
yes done set ready
more most less least
big small wide tall
soft firm hard fine
warm cool calm mild
clean neat tidy plain
safe sure solid firm
true real fair just
help give share show
lead guide teach coach
find pick choose match
hold keep guard mind
move shift turn swap
build make shape form
track mark score rate
check test sort rank
save earn fund deal
read write note log
`;

// Filter: alpha only, length 3-9, not taken, unique. Keep first-seen order.
const seen = new Set();
const candidates = [];
for (const w of POOL.split(/\s+/)) {
  const n = norm(w);
  if (n.length < 3 || n.length > 7) continue;
  if (taken.has(n)) continue;
  if (seen.has(n)) continue;
  seen.add(n);
  candidates.push(n.toUpperCase());
}
console.log(`Candidates after filter/dedupe: ${candidates.length}`);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keyword Bank Triage</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
  :root{--bg:#0a0a0c;--panel:#131318;--line:#26262e;--muted:#7c7c89;--keep:#37d67a;--rej:#ff5a5a;--gold:#c9a96e;--ink:#f4f4f6}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#16161c,#0a0a0c 60%);color:var(--ink);font-family:'Space Grotesk',system-ui,sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line)}
  .brand{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
  .counts{display:flex;gap:18px;font-family:'JetBrains Mono',monospace;font-size:13px}
  .counts b{font-weight:700}
  .c-keep{color:var(--keep)} .c-rej{color:var(--rej)} .c-left{color:var(--muted)}
  .bar{height:3px;background:var(--line)}
  .bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),#e9d3a6);width:0%}
  main{flex:1;display:flex;align-items:center;justify-content:center;position:relative}
  .card{width:min(560px,86vw);background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:54px 40px 40px;text-align:center;position:relative;transition:border-color .12s, box-shadow .12s, transform .06s}
  .card.keep{border-color:var(--keep);box-shadow:0 0 0 1px var(--keep),0 14px 60px -20px rgba(55,214,122,.5)}
  .card.rej{border-color:var(--rej);box-shadow:0 0 0 1px var(--rej),0 14px 60px -20px rgba(255,90,90,.45)}
  .idx{position:absolute;top:16px;left:20px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)}
  .verdict{position:absolute;top:14px;right:18px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;opacity:0}
  .verdict.show{opacity:1}
  .verdict.keep{color:var(--keep)} .verdict.rej{color:var(--rej)}
  .word{font-size:clamp(46px,9vw,86px);font-weight:700;letter-spacing:.02em;line-height:1;margin:6px 0 30px;word-break:break-word}
  .btns{display:flex;gap:14px;justify-content:center}
  button.act{font-family:inherit;font-size:15px;font-weight:700;letter-spacing:.04em;padding:13px 26px;border-radius:12px;border:1px solid var(--line);background:#1b1b22;color:var(--ink);cursor:pointer;transition:transform .06s,background .12s}
  button.act:hover{transform:translateY(-1px)}
  button.keepb{border-color:#1f6e42} button.keepb:hover{background:#11331f}
  button.rejb{border-color:#7a2727} button.rejb:hover{background:#341212}
  .kbd{font-family:'JetBrains Mono',monospace;font-size:11px;background:#000;border:1px solid var(--line);border-radius:6px;padding:2px 7px;margin-right:6px;color:var(--gold)}
  footer{display:flex;align-items:center;justify-content:space-between;padding:13px 22px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
  footer .hint span{margin-right:18px}
  .tools{display:flex;gap:10px}
  button.tool{font-family:'JetBrains Mono',monospace;font-size:12px;padding:8px 14px;border-radius:9px;border:1px solid var(--line);background:#15151b;color:var(--ink);cursor:pointer}
  button.tool:hover{border-color:var(--gold)}
  .done{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(10,10,12,.86);backdrop-filter:blur(4px)}
  .done.show{display:flex}
  .done h2{font-size:30px;margin:0}
  .done p{color:var(--muted);margin:0}
  .flash{position:absolute;inset:0;border-radius:22px;pointer-events:none;opacity:0}
</style></head>
<body>
<header>
  <div class="brand">Keyword Bank · Triage</div>
  <div class="counts">
    <span class="c-keep">keep <b id="nKeep">0</b></span>
    <span class="c-rej">reject <b id="nRej">0</b></span>
    <span class="c-left">left <b id="nLeft">0</b></span>
  </div>
</header>
<div class="bar"><i id="prog"></i></div>
<main>
  <div class="card" id="card">
    <div class="idx" id="idx"></div>
    <div class="verdict" id="verdict"></div>
    <div class="word" id="word">—</div>
    <div class="btns">
      <button class="act keepb" onclick="decide(true)">A · Keep</button>
      <button class="act rejb" onclick="decide(false)">S · Reject</button>
    </div>
  </div>
  <div class="done" id="done">
    <h2>All <span id="dTotal"></span> reviewed</h2>
    <p><span id="dKeep"></span> kept · <span id="dRej"></span> rejected</p>
    <button class="tool" onclick="exportJSON()">⤓ Download keyword-bank.json</button>
    <button class="tool" onclick="copyKept()">Copy kept words</button>
  </div>
</main>
<footer>
  <div class="hint">
    <span><span class="kbd">A</span>keep</span>
    <span><span class="kbd">S</span>reject</span>
    <span><span class="kbd">←</span><span class="kbd">→</span>move</span>
    <span><span class="kbd">U</span>unset</span>
  </div>
  <div class="tools">
    <button class="tool" onclick="exportJSON()">⤓ Export JSON</button>
    <button class="tool" onclick="copyKept()">Copy kept</button>
    <button class="tool" onclick="jumpNext()">Next undecided →</button>
  </div>
</footer>
<script>
const WORDS = ${JSON.stringify(candidates)};
const LS = 'kwbank.v2';
let state = JSON.parse(localStorage.getItem(LS) || '{}');   // word -> true(keep)/false(reject)
let i = Math.max(0, WORDS.findIndex(w => !(w in state)));
if (i < 0) i = 0;

const $ = id => document.getElementById(id);
function save(){ localStorage.setItem(LS, JSON.stringify(state)); }
function counts(){
  let k=0,r=0; for(const w of WORDS){ if(state[w]===true)k++; else if(state[w]===false)r++; }
  return {k,r,left:WORDS.length-k-r};
}
function render(){
  const w = WORDS[i];
  $('word').textContent = w || '—';
  $('idx').textContent = (i+1)+' / '+WORDS.length;
  const v = state[w];
  const card=$('card'), ver=$('verdict');
  card.classList.toggle('keep', v===true);
  card.classList.toggle('rej', v===false);
  ver.className='verdict'+(v===undefined?'':(' show '+(v?'keep':'rej')));
  ver.textContent = v===true?'KEPT':v===false?'REJECTED':'';
  const c=counts();
  $('nKeep').textContent=c.k; $('nRej').textContent=c.r; $('nLeft').textContent=c.left;
  $('prog').style.width = (100*(c.k+c.r)/WORDS.length)+'%';
  $('done').classList.toggle('show', c.left===0);
  if(c.left===0){ $('dTotal').textContent=WORDS.length; $('dKeep').textContent=c.k; $('dRej').textContent=c.r; }
}
function decide(keep){
  const w=WORDS[i]; if(!w) return;
  state[w]=keep; save();
  // brief flash then advance
  setTimeout(()=>{ if(i<WORDS.length-1){ i++; } render(); }, 60);
  render();
}
function unset(){ const w=WORDS[i]; delete state[w]; save(); render(); }
function move(d){ i=Math.min(WORDS.length-1,Math.max(0,i+d)); render(); }
function jumpNext(){ const n=WORDS.findIndex((w,idx)=>idx>i && !(w in state)); i = n>=0?n:i; render(); }
function keptList(){ return WORDS.filter(w=>state[w]===true); }
function exportJSON(){
  const c=counts();
  const data={ generatedAt:new Date().toISOString(), total:WORDS.length, kept:keptList(),
    rejected:WORDS.filter(w=>state[w]===false), keptCount:c.k, rejectedCount:c.r };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='keyword-bank.json'; a.click();
}
function copyKept(){ navigator.clipboard.writeText(keptList().join(', ')); }
window.addEventListener('keydown', e=>{
  const k=e.key.toLowerCase();
  if(k==='a'){ e.preventDefault(); decide(true); }
  else if(k==='s'){ e.preventDefault(); decide(false); }
  else if(e.key==='ArrowRight'){ e.preventDefault(); move(1); }
  else if(e.key==='ArrowLeft'){ e.preventDefault(); move(-1); }
  else if(k==='u'){ e.preventDefault(); unset(); }
});
render();
</script>
</body></html>`;

const out = path.join(os.homedir(), "Desktop", "keyword-triage.html");
fs.writeFileSync(out, html);
console.log(`Wrote ${out} with ${candidates.length} candidates`);
