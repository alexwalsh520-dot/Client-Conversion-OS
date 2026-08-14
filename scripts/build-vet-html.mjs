// Builds ONE self-contained HTML file from the veteran corpus already on disk.
// No database, no network, no dependencies. Just: node scripts/build-vet-html.mjs <corpus-folder>
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2] || '/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/Agency/VETERAN-INNER-WORLD';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pretty = t => t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// ---------- parse each man's dossier ----------
const men = [];
const themeOrder = [];
for (const file of fs.readdirSync(path.join(OUT, 'by-man')).filter(f => f.endsWith('.md'))) {
  const lines = fs.readFileSync(path.join(OUT, 'by-man', file), 'utf8').split('\n');
  const m = { n: '', d: '', c: '', id: '', w: 0, mins: null, vet: [], th: {}, raw: [] };
  let section = null, pendingCtx = '';

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;

    if (line.startsWith('# ')) { m.n = line.slice(2).trim(); continue; }
    if (line.startsWith('- Date:')) {
      m.d = (line.match(/Date:\s*([\d-]+)/) || [])[1] || '';
      m.c = (line.match(/Closer:\s*(.+?)\s*\|/) || [])[1] || '';
      m.id = (line.match(/Fathom ID:\s*(\S+)/) || [])[1] || '';
      continue;
    }
    if (line.startsWith('- Duration:')) {
      const mm = line.match(/(\d+)\s*min/); m.mins = mm ? +mm[1] : null; continue;
    }
    if (line.startsWith('- Words spoken by him:')) { m.w = +line.replace(/\D/g, '') || 0; continue; }
    if (line.startsWith('- Call:') || line.startsWith('- Transcript speaker') || line.startsWith('>') || line === '---') continue;

    if (line.startsWith('## ')) {
      const h = line.slice(3).trim();
      if (/^How he identified/i.test(h)) section = { kind: 'vet' };
      else if (/^Everything he said/i.test(h)) section = { kind: 'raw' };
      else {
        section = { kind: 'theme', name: h };
        if (!themeOrder.includes(h)) themeOrder.push(h);
        m.th[h] = m.th[h] || [];
      }
      pendingCtx = '';
      continue;
    }

    if (!section) continue;
    if (section.kind === 'vet' && line.startsWith('- ')) {
      m.vet.push(line.slice(2).replace(/^"|"$/g, ''));
    } else if (section.kind === 'raw' && line.startsWith('- ')) {
      m.raw.push(line.slice(2));
    } else if (section.kind === 'theme') {
      if (line.startsWith('[closer] ')) { pendingCtx = line.slice(9); continue; }
      if (line.startsWith('**HIM:** ')) {
        m.th[section.name].push([line.slice(9).replace(/^"|"$/g, ''), pendingCtx]);
        pendingCtx = '';
      }
    }
  }
  m.tc = Object.values(m.th).reduce((a, b) => a + b.length, 0);
  if (m.n) men.push(m);
}
men.sort((a, b) => b.tc - a.tc);

// ---------- curated sharpest lines ----------
let sharpHtml = '<p class="muted">THE-SHARPEST-LINES.md not found.</p>';
const sharpPath = path.join(OUT, 'THE-SHARPEST-LINES.md');
if (fs.existsSync(sharpPath)) {
  const out = [];
  let started = false; // the file's own preamble is replaced by the intro line in the page
  for (const raw of fs.readFileSync(sharpPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line === '---' || line.startsWith('# ')) continue;
    if (line.startsWith('## ')) { started = true; out.push(`<h3 class="grp">${esc(line.slice(3))}</h3>`); continue; }
    if (!started) continue;
    if (line.startsWith('- ')) {
      const body = line.slice(2);
      const cut = body.lastIndexOf('" — ');
      if (cut > -1) out.push(`<div class="q"><p>${esc(body.slice(0, cut + 1))}</p><cite>${esc(body.slice(cut + 4))}</cite></div>`);
      else out.push(`<div class="q"><p>${esc(body)}</p></div>`);
      continue;
    }
    out.push(`<p class="note">${esc(line)}</p>`);
  }
  sharpHtml = out.join('\n');
}

const totalQuotes = men.reduce((a, b) => a + b.tc, 0);
const totalWords = men.reduce((a, b) => a + b.w, 0);
const DATA = { men, themes: themeOrder };

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veteran Inner World</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#e8e8ea;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid #1e1e24;padding:34px 0 0}
h1{font-size:23px;font-weight:650;letter-spacing:-.02em}
.sub{color:#8a8a94;font-size:14px;margin-top:6px}
.stats{display:flex;gap:28px;margin:20px 0 24px;flex-wrap:wrap}
.stat b{display:block;font-size:24px;font-weight:650;color:#c9a96e;letter-spacing:-.02em}
.stat span{font-size:12px;color:#8a8a94;text-transform:uppercase;letter-spacing:.07em}
nav{display:flex;gap:2px;flex-wrap:wrap}
nav button{background:none;border:0;border-bottom:2px solid transparent;color:#8a8a94;font:inherit;font-size:14px;padding:11px 15px;cursor:pointer}
nav button:hover{color:#e8e8ea}
nav button.on{color:#e8e8ea;border-bottom-color:#c9a96e}
main{padding:30px 0 90px}
.tab{display:none}.tab.on{display:block}
.q{border-left:2px solid #26262e;padding:2px 0 2px 16px;margin:0 0 15px}
.q p{font-size:15.5px;line-height:1.62}
.q cite{display:block;font-style:normal;color:#8a8a94;font-size:12.5px;margin-top:6px}
.q .ctx{color:#6e6e78;font-size:12.5px;margin-bottom:6px;font-style:italic}
h3.grp{font-size:17px;font-weight:600;margin:36px 0 18px;padding-bottom:9px;border-bottom:1px solid #1e1e24;letter-spacing:-.01em}
h3.grp:first-child{margin-top:0}
.note{color:#8a8a94;font-size:13.5px;margin:0 0 16px}
.muted{color:#8a8a94}
.cols{display:grid;grid-template-columns:290px 1fr;gap:34px;align-items:start}
.side{position:sticky;top:16px;max-height:calc(100vh - 40px);overflow-y:auto;border:1px solid #1e1e24;border-radius:9px;background:#0f0f12}
.side button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #17171c;color:#c8c8d0;font:inherit;font-size:13.5px;padding:10px 13px;cursor:pointer}
.side button:hover{background:#15151a;color:#fff}
.side button.on{background:#15151a;color:#c9a96e;box-shadow:inset 2px 0 0 #c9a96e}
.side small{display:block;color:#6e6e78;font-size:11.5px;margin-top:2px}
input[type=search]{width:100%;background:#0f0f12;border:1px solid #26262e;border-radius:8px;color:#e8e8ea;font:inherit;font-size:14px;padding:10px 13px;margin-bottom:16px}
input[type=search]:focus{outline:0;border-color:#c9a96e}
.meta{display:flex;gap:20px;flex-wrap:wrap;color:#8a8a94;font-size:12.5px;border:1px solid #1e1e24;background:#0f0f12;border-radius:9px;padding:13px 16px;margin-bottom:24px}
.meta b{color:#e8e8ea;font-weight:600}
h2.man{font-size:21px;font-weight:650;letter-spacing:-.02em;margin-bottom:4px}
details{border-top:1px solid #1e1e24;margin-top:30px;padding-top:16px}
summary{cursor:pointer;color:#8a8a94;font-size:14px}
summary:hover{color:#e8e8ea}
details ul{margin:16px 0 0 18px;color:#b4b4be;font-size:14px}
details li{margin-bottom:7px}
.built p{margin-bottom:15px;max-width:76ch;color:#c8c8d0}
.built h3{font-size:16px;font-weight:600;margin:30px 0 12px}
.built ol{margin-left:20px;max-width:76ch}
.built li{margin-bottom:12px;color:#c8c8d0}
.warn{border:1px solid #3a2f1c;background:#16130c;border-radius:9px;padding:16px 18px;margin:22px 0}
.warn strong{color:#c9a96e}
code{background:#15151a;border:1px solid #26262e;border-radius:5px;padding:1px 6px;font-size:13px;word-break:break-all}
.hits{color:#6e6e78;font-size:12.5px;margin-bottom:18px}
@media(max-width:820px){.cols{grid-template-columns:1fr}.side{position:static;max-height:340px}}
</style></head><body>
<header><div class="wrap">
<h1>Veteran Inner World</h1>
<div class="sub">Built entirely from what they said on our own recorded calls. Verbatim. Nothing concluded.</div>
<div class="stats">
<div class="stat"><b>${men.length}</b><span>veterans</span></div>
<div class="stat"><b>${totalQuotes.toLocaleString()}</b><span>quotes</span></div>
<div class="stat"><b>${themeOrder.length}</b><span>themes</span></div>
<div class="stat"><b>${totalWords.toLocaleString()}</b><span>of their words</span></div>
</div>
<nav>
<button class="on" data-t="sharp">Sharpest lines</button>
<button data-t="man">By man</button>
<button data-t="theme">By theme</button>
<button data-t="search">Search everything</button>
<button data-t="built">How this was built</button>
</nav>
</div></header>
<main class="wrap">

<section id="sharp" class="tab on">
<p class="note">Hand-picked from all ${totalQuotes.toLocaleString()} quotes, grouped under the frames you named. The grouping is filing, not analysis.</p>
${sharpHtml}
</section>

<section id="man" class="tab">
<div class="cols">
<div><input type="search" id="manq" placeholder="Filter men..."><div class="side" id="manlist"></div></div>
<div id="manbody"></div>
</div>
</section>

<section id="theme" class="tab">
<div class="cols">
<div><div class="side" id="themelist"></div></div>
<div id="themebody"></div>
</div>
</section>

<section id="search" class="tab">
<input type="search" id="allq" placeholder="Search every word all ${men.length} of them said. Try: drinking, mirror, my wife, excuse, got out">
<div id="allbody"><p class="muted">Type at least 3 characters.</p></div>
</section>

<section id="built" class="tab built">
<h3>What this is</h3>
<p>Every sales call we record goes into Fathom. This pulls all of them, keeps only the ones where the man told us <em>himself</em> that he served, throws away everything our closers said, and files what is left by subject.</p>
<h3>How it was filtered</h3>
<ol>
<li>Started from 463 recorded calls, 458 with usable transcripts, covering 2 Dec 2025 to 11 Aug 2026.</li>
<li>Kept only prospect calls (Strategy Sessions and Onboarding). Team huddles, C Suite, creator calls and interviews are gone.</li>
<li>Split every line by who was speaking, then deleted our side: Austin Richard, Jacob Broz, Will Rincan, Matthew Conder and the rest. Only his words are quoted.</li>
<li>A man is only in here if <strong>he himself</strong> said he served or is serving. Austin is ex-Army and raises the military on nearly every call, so filtering on keywords alone would have dragged in dozens of civilians. His words qualify nobody. Only theirs do.</li>
<li>Closer lines appear only where marked as context, so his answer makes sense.</li>
</ol>
<div class="warn">
<p><strong>Before you use a line as a weapon, read this.</strong></p>
<p><strong>1. Check the recording first.</strong> Speaker labels come from Fathom's automatic transcription and it does get them wrong. On at least one other call in this database the labels visibly swap mid-conversation. Every man's Fathom ID is on his page. Confirm he said it before you say it back to him.</p>
<p><strong>2. The blank gaps are swearing.</strong> Fathom censors profanity, which is why lines read "all the drinking and dumb that I was doing". Nothing is missing except the swear word.</p>
<p><strong>3. Some quotes landed in a theme by coincidence.</strong> Filing is done by word matching, so a protein bar can land near drinking. Skim, do not trust blindly.</p>
<p><strong>4. Not everyone here is a man.</strong> The filter was "veteran", not "male veteran". At least two identified themselves as women in their own words: MJ Kirker and Taylor Alonzo. A few others carry traditionally female names (Elizabeth Stanek, Emma DeRosier, Kate Hoit). Check before using them for a male-veteran angle.</p>
<p><strong>5. This is real people's private disclosure</strong> pulled from our own recorded calls: drinking, divorce, depression, a man who threw up blood, a father whose son nearly drowned. Keep it internal. Do not publish anyone's words with their name on them.</p>
</div>
<h3>Picking up new calls</h3>
<p>Two steps, both from Terminal. The first re-reads the database (needs the network to be up), the second rebuilds this page:</p>
<p><code>cd "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard" && node scripts/build-vet-corpus.mjs "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/Agency/VETERAN-INNER-WORLD"</code></p>
<p><code>cd "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard" && node scripts/build-vet-html.mjs "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/Agency/VETERAN-INNER-WORLD"</code></p>
<p class="muted">The second one alone rebuilds this page from what is already saved, and never touches the network.</p>
</section>

</main>
<script>
const D = ${JSON.stringify(DATA).replace(/[<\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pretty = t => t.toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase());

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  document.getElementById(b.dataset.t).classList.add('on');
  window.scrollTo(0,0);
});

let curMan = 0;
function drawManList(filter) {
  const f = (filter||'').toLowerCase();
  document.getElementById('manlist').innerHTML = D.men.map((m,i) =>
    (!f || m.n.toLowerCase().includes(f))
      ? '<button data-i="'+i+'"'+(i===curMan?' class="on"':'')+'>'+esc(m.n)+'<small>'+m.d+' \\u00b7 '+m.tc+' quotes</small></button>'
      : '').join('');
  document.querySelectorAll('#manlist button').forEach(b => b.onclick = () => { curMan = +b.dataset.i; drawManList(f); drawMan(); });
}
function drawMan() {
  const m = D.men[curMan];
  let h = '<h2 class="man">'+esc(m.n)+'</h2>';
  h += '<div class="meta"><span>Called <b>'+m.d+'</b></span><span>Closer <b>'+esc(m.c)+'</b></span><span>Spoke <b>'+m.w.toLocaleString()+'</b> words</span>'
     + (m.mins?'<span>Call was <b>'+m.mins+' min</b></span>':'')+'<span>Fathom ID <b>'+m.id+'</b></span></div>';
  h += '<h3 class="grp">How he told us he served</h3>';
  h += m.vet.map(v => '<div class="q"><p>"'+esc(v)+'"</p></div>').join('');
  for (const t of D.themes) {
    if (!m.th[t] || !m.th[t].length) continue;
    h += '<h3 class="grp">'+pretty(t)+'</h3>';
    h += m.th[t].map(p => '<div class="q">'+(p[1]?'<div class="ctx">'+esc(p[1])+'</div>':'')+'<p>"'+esc(p[0])+'"</p></div>').join('');
  }
  h += '<details><summary>Everything he said, in order ('+m.raw.length+' lines, unfiltered)</summary><ul>'
     + m.raw.map(r => '<li>'+esc(r)+'</li>').join('') + '</ul></details>';
  document.getElementById('manbody').innerHTML = h;
}
document.getElementById('manq').oninput = e => drawManList(e.target.value);
drawManList(''); drawMan();

let curTheme = D.themes[0];
function drawThemeList() {
  document.getElementById('themelist').innerHTML = D.themes.map(t => {
    const n = D.men.reduce((a,m) => a + (m.th[t] ? m.th[t].length : 0), 0);
    return '<button data-t="'+t+'"'+(t===curTheme?' class="on"':'')+'>'+pretty(t)+'<small>'+n+' quotes</small></button>';
  }).join('');
  document.querySelectorAll('#themelist button').forEach(b => b.onclick = () => { curTheme = b.dataset.t; drawThemeList(); drawTheme(); });
}
function drawTheme() {
  let h = '<h2 class="man">'+pretty(curTheme)+'</h2><p class="note">Every veteran who said it, in his own words.</p>';
  for (const m of D.men) {
    if (!m.th[curTheme] || !m.th[curTheme].length) continue;
    h += '<h3 class="grp">'+esc(m.n)+' <span class="muted" style="font-weight:400;font-size:13px">'+m.d+'</span></h3>';
    h += m.th[curTheme].map(p => '<div class="q"><p>"'+esc(p[0])+'"</p></div>').join('');
  }
  document.getElementById('themebody').innerHTML = h;
}
drawThemeList(); drawTheme();

document.getElementById('allq').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  const box = document.getElementById('allbody');
  if (q.length < 3) { box.innerHTML = '<p class="muted">Type at least 3 characters.</p>'; return; }
  let n = 0, people = 0, h = '';
  for (const m of D.men) {
    const hits = m.raw.filter(r => r.toLowerCase().includes(q));
    if (!hits.length) continue;
    n += hits.length; people++;
    h += '<h3 class="grp">'+esc(m.n)+' <span class="muted" style="font-weight:400;font-size:13px">'+m.d+'</span></h3>'
       + hits.map(r => '<div class="q"><p>"'+esc(r)+'"</p></div>').join('');
  }
  box.innerHTML = n ? '<p class="hits">'+n+' lines from '+people+' people</p>'+h : '<p class="muted">Nothing.</p>';
};
</script></body></html>`;

const dest = path.join(OUT, 'Veteran-Inner-World.html');
fs.writeFileSync(dest, html);
console.log('men parsed:', men.length);
console.log('themed quotes:', totalQuotes);
console.log('themes:', themeOrder.length);
console.log('written:', dest, (html.length / 1048576).toFixed(1) + ' MB');
