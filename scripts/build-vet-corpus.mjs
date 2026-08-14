import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = '/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard/.env.local';
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const OUT = process.argv[2] || '/tmp/vet-corpus';

// ---- internal / our-side speakers (closers, setters, owners, coaches) ----
const INTERNAL = [
  'austin richard', 'jacob broz', 'will rincan', 'will  rincan', 'matthew conder', 'matt conder',
  'alex walsh', 'tyson', 'amara', 'erin', 'debbie', 'gideon', 'kelechi', 'wobbe', 'misha',
  'nicole', 'chris ', 'jake ', 'antwan', 'lucy', 'keith', 'coach jacob', 'broz',
];
const isInternal = (name) => {
  const n = name.toLowerCase().trim();
  return INTERNAL.some(i => n === i.trim() || n.startsWith(i.trim()) || i.trim().startsWith(n));
};

// ---- veteran self-identification: must come from the PROSPECT ----
const VET_SELF = [
  /\bi(?:'m| am)\s+(?:a\s+)?(?:combat\s+)?veteran\b/i,
  /\bi(?:'m| am)\s+(?:currently\s+)?(?:in|active duty|still in)\b.{0,25}\b(?:army|navy|marines?|marine corps|air force|military|guard|reserve)/i,
  /\bi\s+(?:was|served|did)\b.{0,30}\b(?:army|navy|marines?|marine corps|air force|military|infantry|guard|reserve)\b/i,
  /\bi\s+joined\s+the\s+(?:army|navy|marines?|marine corps|air force|military|service|guard)\b/i,
  /\b(?:when|after|since|before)\s+i\s+(?:got out|separated|was discharged|joined|enlisted|deployed)\b/i,
  /\bi\s+(?:deployed|enlisted|reenlisted|re-enlisted)\b/i,
  /\bi(?:'ve| have)?\s+(?:been\s+)?deployed\b/i,
  /\bmy\s+(?:deployment|enlistment|discharge|platoon|battalion|squadron|unit|command|chain of command|first sergeant|drill sergeant)\b/i,
  /\bi(?:'m| am)\s+(?:still\s+)?active duty\b/i,
  /\bmy\s+(?:etsr?|ets)\b/i,
  /\bi\s+got\s+out\s+(?:of|in)\b/i,
  /\bi\s+go\s+to\s+boot camp\b/i,
  /\bi(?:'m| am)\s+(?:going|shipping)\s+(?:to|out)\b.{0,20}\bboot camp\b/i,
  /\b(?:i|we)\s+(?:do|did|had)\b.{0,20}\b(?:pft|acft|apft|pt test|ruck|rucking|formation)\b/i,
  /\bi(?:'m| am)\s+(?:in|at)\b.{0,20}\b(?:11 bravo|11b|68w|infantry|air national guard|national guard)\b/i,
  /\b(?:11 bravo|11b|mos)\b/i,
];

// ---- themes: Alex's brief, expanded ----
const THEMES = [
  ['IDENTITY_SERVICE', /\b(?:army|navy|marines?|marine corps|air force|military|infantry|deployed|deployment|active duty|boot camp|basic training|my unit|platoon|battalion|got out|separated|discharge|enlist|reenlist|veteran|the va\b|national guard|reserve|ets\b|pft|acft|apft|ruck|formation|drill|barracks|base\b|overseas|iraq|afghanistan|combat|tour\b|mos\b|first sergeant|chain of command)/i],
  ['WHO_I_USED_TO_BE', /\b(?:used to (?:be|weigh|run|lift|look|do)|back then|back when|i was (?:in the best|shredded|jacked|lean|fast|strong|fit|a beast|an athlete)|prime|my peak|when i was younger|in high school|in college|playing (?:ball|football|sports)|athlete|i could (?:run|do|lift)\b.{0,30}(?:then|back)|before i|two years ago|five years ago|ten years ago|since then|not the same|shell of|used to be able)/i],
  ['DRINKING_VICES', /\b(?:drink|drinking|drank|alcohol|beer|beers|liquor|whiskey|bourbon|vodka|booze|hungover|hangover|drunk|buzz|sober|sobriety|(?:at|to|in) the bar\b|bar scene|going out|party|partying|dip\b|dipping|zyn|nicotine|smok|vape|weed|cigarette|chew\b|porn|gambl)/i],
  ['THE_JOB_EXCUSE', /\b(?:my (?:job|work|schedule|shift)|work schedule|shift work|night shift|12 hour|twelve hour|24 hour|long hours|overtime|no time|don'?t have (?:the )?time|too busy|busy schedule|between work|after work|by the time i get home|travel for work|on the road|deploy(?:ing|ed) so|field exercise|duty day|staff duty|cq\b|underway|shore duty|sea duty)/i],
  ['HELPLESS_STUCK', /\b(?:stuck|plateau|helpless|hopeless|no matter what|nothing (?:works|worked)|tried everything|that'?s just (?:how|who) i am|always been (?:this|that|the)|genetics|slow metabolism|impossible|never been able|keep failing|failed again|gave up|give up on|fall(?:en|ing)? off|fell off|start(?:ing)? over|restart|square one|yo-?yo|on and off|every time i (?:try|start|get)|lost (?:the )?motivation|lose motivation|two weeks in|last(?:s|ed)? (?:a|two|three|about)? ?(?:week|month)|burn(?:t|ed) out|spiral|rut\b|slipp?(?:ed|ing)|slid|backslide|self.?sabotage|excuse)/i],
  ['KNOW_BUT_DONT_DO', /\b(?:i know what (?:to do|i (?:need|should))|i know i (?:should|need|have to)|it'?s not (?:a )?knowledge|i have the knowledge|i just don'?t (?:do it|apply)|not applying|execution|accountability|discipline|willpower|motivation|consistent|consistency|inconsistent|follow through|follow-through|stick to it|stick with it|hold me accountable|someone to tell me|need structure|need a plan|need somebody)/i],
  ['FAMILY_LETTING_DOWN', /\b(?:my (?:wife|husband|girlfriend|fianc|kids?|son|daughter|family|marriage|boy|girl|children|partner)|letting (?:them|her|him|my family|everyone) down|let (?:her|them|him|my family) down|be there for|be around for|my kids? (?:see|watch|look)|role model|example for|dad bod|be a (?:better )?(?:dad|father|husband)|divorce|separated from|she says|she tells me|argu|resent)/i],
  ['SHAME_MIRROR_BODY', /\b(?:mirror|shirt off|take my shirt|photos?|pictures?|see myself|look at myself|disgust|ashamed|shame|embarrass|hate (?:the way|how) i look|hate my|self.?conscious|insecure|belly|gut\b|love handles|man boob|moobs|fat\b|fatter|overweight|obese|out of shape|slob|let myself|gross|the pool|beach|shirtless|clothes don'?t fit|pants)/i],
  ['MENTAL_HEALTH_PAIN', /\b(?:depress|anxiety|anxious|ptsd|mental health|therapy|therapist|meds?\b|medication|antidepress|zoloft|prozac|suicid|dark place|rock bottom|numb|empty|lost\b|no purpose|purpose|meaning|mission|direction|angry|anger|rage|irritab|snapp|mood|isolat|alone|lonely|withdraw)/i],
  ['SLEEP_ENERGY_STRESS', /\b(?:sleep|insomnia|tired|exhausted|fatigue|no energy|low energy|drained|stress|stressed|burnt out|burned out|cortisol|wake up|can'?t sleep|4 hours|five hours|caffeine|energy drink|monster|celsius|pre.?workout|coffee)/i],
  ['INJURY_PAIN_VA', /\b(?:injur|hurt my|torn|tore|acl|mcl|meniscus|shoulder|back pain|my back|knee|knees|hip|surgery|rehab|physical therapy|pt\b.{0,10}appointment|disability|rated|percent|va\b|chronic pain|arthritis|herniat|disc\b|limitation|bad (?:back|knee|shoulder))/i],
  ['CONFIDENCE_SOCIAL', /\b(?:confiden|self.?esteem|self.?worth|respect|how i carry|presence|attract|dating|single|women|girls|social|friends|isolat|hiding|avoid people|don'?t go out|proud|pride)/i],
  ['MONEY_OBJECTION', /\b(?:afford|expensive|budget|money|cost|price|pay for|paycheck|financ|broke\b|tight right now|card|invest|worth it|spend|too much|cheap|deposit|paid in full|payment plan)/i],
  ['FAILED_PROGRAMS', /\b(?:tried|program|app\b|macro|myfitnesspal|coach before|another coach|last coach|online coach|gym membership|planet fitness|youtube|tiktok|instagram|free plan|cookie cutter|generic|template|noom|weight watchers|keto|carnivore|intermittent fasting|crash diet|cut before|bulk before)/i],
  ['DEADLINE_EVENT', /\b(?:wedding|vacation|deadline|by (?:the )?(?:summer|christmas|june|july|august|september|october|new year)|in (?:three|3|six|6|four|4) months|birthday|reunion|competition|selection|tryout|pt test|weigh.?in|tape|height and weight|body fat (?:test|standard)|promotion|board\b|flagged|profile)/i],
  ['WHAT_HE_WANTS', /\b(?:i want to (?:feel|be|look|get|have)|my goal|goals?\b|ideally|dream|if i could|end goal|where i want|be able to (?:run|play|keep up|do)|keep up with|feel like myself|feel good|feel confident|be proud|prove)/i],
];

// ---------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the connection to Supabase drops now and then; retry rather than dying halfway
async function fetchPage(from, batch) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await sb.from('fathom_calls')
      .select('fathom_id,title,recorded_at,duration_sec,attendees,transcript,summary')
      .range(from, from + batch - 1);
    if (!res.error) return res.data;
    console.error(`  rows ${from}-${from + batch - 1} failed (try ${attempt}/6): ${res.error.message}`);
    if (attempt === 6) { console.error('giving up'); process.exit(1); }
    await sleep(2000 * attempt);
  }
}

let from = 0, batch = 100, all = [];
while (true) {
  const data = await fetchPage(from, batch);
  if (!data.length) break;
  all = all.concat(data);
  from += batch;
  if (data.length < batch) break;
}

function parse(transcript) {
  const out = [];
  for (const raw of transcript.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:]{1,45}):\s*(.*)$/);
    if (m) out.push({ speaker: m[1].trim(), text: m[2].trim() });
    else if (out.length) out[out.length - 1].text += ' ' + line;
  }
  return out;
}

const men = [];
for (const c of all) {
  if (!c.transcript || c.transcript.length < 3000) continue;
  const title = c.title || '';
  if (!/^(strategy session|onboarding call)/i.test(title)) continue;

  const turns = parse(c.transcript);
  if (turns.length < 20) continue;

  // speaker tally
  const tally = {};
  for (const t of turns) tally[t.speaker] = (tally[t.speaker] || 0) + t.text.length;
  const speakers = Object.keys(tally);
  const prospectSpeakers = speakers.filter(s => !isInternal(s));
  if (!prospectSpeakers.length) continue;

  const prospectTurns = turns.filter(t => prospectSpeakers.includes(t.speaker));
  const prospectText = prospectTurns.map(t => t.text).join('\n');

  // veteran must be self-declared by the prospect
  const vetHits = [];
  for (const t of prospectTurns) {
    if (VET_SELF.some(r => r.test(t.text))) vetHits.push(t.text);
  }
  if (vetHits.length < 1) continue;

  // named prospect from title
  let name = title.replace(/^(strategy session|onboarding call)\s*-\s*/i, '')
                  .split(/<>|\sx\s/)[0].replace(/\s+/g, ' ').trim();
  const closer = speakers.filter(isInternal).sort((a, b) => tally[b] - tally[a])[0] || 'unknown';

  // theme extraction over prospect turns, with the closer's preceding line as context
  const themed = {};
  for (const [theme] of THEMES) themed[theme] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (!prospectSpeakers.includes(t.speaker)) continue;
    if (t.text.length < 25) continue;
    for (const [theme, re] of THEMES) {
      if (re.test(t.text)) {
        let ctx = '';
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          if (isInternal(turns[j].speaker) && turns[j].text.length > 20) { ctx = `${turns[j].speaker}: ${turns[j].text}`; break; }
        }
        themed[theme].push({ ctx, speaker: t.speaker, text: t.text });
      }
    }
  }
  const themeCount = Object.values(themed).reduce((a, b) => a + b.length, 0);

  men.push({
    fathom_id: c.fathom_id, name, title, closer,
    date: (c.recorded_at || '').slice(0, 10),
    duration_sec: c.duration_sec,
    prospectSpeakers, vetHits, themed, themeCount,
    prospectWords: prospectText.split(/\s+/).length,
    prospectTurns, summary: c.summary,
  });
}

men.sort((a, b) => b.themeCount - a.themeCount);
fs.mkdirSync(path.join(OUT, 'by-man'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'by-theme'), { recursive: true });

const slug = s => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

for (const m of men) {
  const L = [];
  L.push(`# ${m.name}`);
  L.push('');
  L.push(`- Call: ${m.title}`);
  L.push(`- Date: ${m.date}  |  Closer: ${m.closer}  |  Fathom ID: ${m.fathom_id}`);
  L.push(`- Duration: ${m.duration_sec ? Math.round(m.duration_sec / 60) + ' min' : 'not recorded'}`);
  L.push(`- Words spoken by him: ${m.prospectWords}`);
  L.push(`- Transcript speaker label(s) for him: ${m.prospectSpeakers.join(', ')}`);
  L.push('');
  L.push('> Everything below is VERBATIM from the recording. Lines marked `[closer]` are what our side asked, included only so his answer has context. No interpretation added.');
  L.push('');
  L.push('## How he identified himself as military (his words)');
  L.push('');
  for (const v of m.vetHits) L.push(`- "${v}"`);
  L.push('');
  for (const [theme] of THEMES) {
    const items = m.themed[theme];
    if (!items.length) continue;
    L.push(`## ${theme.replace(/_/g, ' ')}`);
    L.push('');
    for (const it of items) {
      if (it.ctx) L.push(`[closer] ${it.ctx}`);
      L.push(`**HIM:** "${it.text}"`);
      L.push('');
    }
  }
  L.push('---');
  L.push('');
  L.push('## Everything he said, in order (raw, unfiltered)');
  L.push('');
  for (const t of m.prospectTurns) L.push(`- ${t.text}`);
  L.push('');
  fs.writeFileSync(path.join(OUT, 'by-man', `${slug(m.name)}__${m.fathom_id}.md`), L.join('\n'));
}

// by-theme files
for (const [theme] of THEMES) {
  const L = [`# ${theme.replace(/_/g, ' ')}`, '', 'Verbatim, every veteran who said it. Format: quote — who, date.', ''];
  let n = 0;
  for (const m of men) {
    const items = m.themed[theme];
    if (!items.length) continue;
    L.push(`### ${m.name} — ${m.date}`);
    L.push('');
    for (const it of items) { L.push(`- "${it.text}"`); n++; }
    L.push('');
  }
  L.unshift(`<!-- ${n} quotes -->`);
  fs.writeFileSync(path.join(OUT, 'by-theme', `${slug(theme)}.md`), L.join('\n'));
}

// index
const idx = [`# Veteran call corpus`, '', `${men.length} people who told us in their OWN words on a recorded call that they served or are serving. Overwhelmingly men; see README caveat 4.`, '',
  'Ranked by how much they gave up. "His words" = words he spoke on the call.', '',
  '| # | Name | Date | Closer | His words | Themed quotes | File |', '|---|---|---|---|---|---|---|'];
men.forEach((m, i) => idx.push(`| ${i + 1} | ${m.name} | ${m.date} | ${m.closer} | ${m.prospectWords} | ${m.themeCount} | by-man/${slug(m.name)}__${m.fathom_id}.md |`));
fs.writeFileSync(path.join(OUT, 'INDEX.md'), idx.join('\n'));

// ============================================================
// ONE SELF-CONTAINED HTML FILE WITH TABS
// ============================================================
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pretty = t => t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// hand-picked sharpest lines, rendered from the curated markdown if it is there
let sharpHtml = '<p class="muted">THE-SHARPEST-LINES.md not found next to this file.</p>';
const sharpPath = path.join(OUT, 'THE-SHARPEST-LINES.md');
if (fs.existsSync(sharpPath)) {
  const out = [];
  for (const raw of fs.readFileSync(sharpPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    if (line.startsWith('## ')) { out.push(`<h3 class="grp">${esc(line.slice(3))}</h3>`); continue; }
    if (line.startsWith('# ')) continue;
    if (line.startsWith('- ')) {
      const body = line.slice(2);
      const cut = body.lastIndexOf('" — ');
      if (cut > -1) {
        out.push(`<div class="q"><p>${esc(body.slice(0, cut + 1))}</p><cite>${esc(body.slice(cut + 4))}</cite></div>`);
      } else out.push(`<div class="q"><p>${esc(body)}</p></div>`);
      continue;
    }
    out.push(`<p class="note">${esc(line)}</p>`);
  }
  sharpHtml = out.join('\n');
}

const DATA = {
  men: men.map(m => ({
    n: m.name, d: m.date, c: m.closer, id: m.fathom_id,
    w: m.prospectWords, tc: m.themeCount,
    mins: m.duration_sec ? Math.round(m.duration_sec / 60) : null,
    vet: m.vetHits,
    th: Object.fromEntries(THEMES.map(([t]) => [t, m.themed[t].map(i => [i.text, i.ctx])]).filter(([, v]) => v.length)),
    raw: m.prospectTurns.map(t => t.text),
  })),
  themes: THEMES.map(([t]) => t),
};

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
code{background:#15151a;border:1px solid #26262e;border-radius:5px;padding:1px 6px;font-size:13px}
.hits{color:#6e6e78;font-size:12.5px;margin-bottom:18px}
@media(max-width:820px){.cols{grid-template-columns:1fr}.side{position:static;max-height:340px}}
</style></head><body>
<header><div class="wrap">
<h1>Veteran Inner World</h1>
<div class="sub">Built entirely from what they said on our own recorded calls. Verbatim. Nothing concluded.</div>
<div class="stats">
<div class="stat"><b>${men.length}</b><span>veterans</span></div>
<div class="stat"><b>${men.reduce((a, b) => a + b.themeCount, 0).toLocaleString()}</b><span>quotes</span></div>
<div class="stat"><b>${THEMES.length}</b><span>themes</span></div>
<div class="stat"><b>${men.reduce((a, b) => a + b.prospectWords, 0).toLocaleString()}</b><span>of their words</span></div>
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
<p class="note">Hand-picked from all ${men.reduce((a, b) => a + b.themeCount, 0).toLocaleString()} quotes, grouped under the frames you named. The grouping is filing, not analysis.</p>
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
<input type="search" id="allq" placeholder="Search every word all 82 of them said. Try: drinking, mirror, my wife, excuse, got out">
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
<h3>Refreshing it</h3>
<p>It reads live from the database, so re-running it picks up every call booked since. One command, from Terminal:</p>
<p><code>cd "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard" && node scripts/build-vet-corpus.mjs "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/Agency/VETERAN-INNER-WORLD"</code></p>
<p class="muted">That rewrites this HTML file in place.</p>
</section>

</main>
<script>
const D = ${JSON.stringify(DATA).replace(/</g, '\\u003c')};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pretty = t => t.replace(/_/g,' ').toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase());

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  document.getElementById(b.dataset.t).classList.add('on');
  window.scrollTo(0,0);
});

// ---- by man ----
let curMan = 0;
function drawManList(filter) {
  const f = (filter||'').toLowerCase();
  document.getElementById('manlist').innerHTML = D.men.map((m,i) =>
    (!f || m.n.toLowerCase().includes(f))
      ? '<button data-i="'+i+'"'+(i===curMan?' class="on"':'')+'>'+esc(m.n)+'<small>'+m.d+' · '+m.tc+' quotes</small></button>'
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
    if (!m.th[t]) continue;
    h += '<h3 class="grp">'+pretty(t)+'</h3>';
    h += m.th[t].map(([txt,ctx]) =>
      '<div class="q">'+(ctx?'<div class="ctx">'+esc(ctx)+'</div>':'')+'<p>"'+esc(txt)+'"</p></div>').join('');
  }
  h += '<details><summary>Everything he said, in order ('+m.raw.length+' lines, unfiltered)</summary><ul>'
     + m.raw.map(r => '<li>'+esc(r)+'</li>').join('') + '</ul></details>';
  document.getElementById('manbody').innerHTML = h;
}
document.getElementById('manq').oninput = e => drawManList(e.target.value);
drawManList(''); drawMan();

// ---- by theme ----
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
    if (!m.th[curTheme]) continue;
    h += '<h3 class="grp">'+esc(m.n)+' <span class="muted" style="font-weight:400;font-size:13px">'+m.d+'</span></h3>';
    h += m.th[curTheme].map(([txt]) => '<div class="q"><p>"'+esc(txt)+'"</p></div>').join('');
  }
  document.getElementById('themebody').innerHTML = h;
}
drawThemeList(); drawTheme();

// ---- search everything ----
document.getElementById('allq').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  const box = document.getElementById('allbody');
  if (q.length < 3) { box.innerHTML = '<p class="muted">Type at least 3 characters.</p>'; return; }
  let n = 0, h = '';
  for (const m of D.men) {
    const hits = m.raw.filter(r => r.toLowerCase().includes(q));
    if (!hits.length) continue;
    n += hits.length;
    h += '<h3 class="grp">'+esc(m.n)+' <span class="muted" style="font-weight:400;font-size:13px">'+m.d+'</span></h3>'
       + hits.map(r => '<div class="q"><p>"'+esc(r)+'"</p></div>').join('');
  }
  box.innerHTML = n ? '<p class="hits">'+n+' lines from '+h.split('<h3').length+' people</p>'+h : '<p class="muted">Nothing.</p>';
};
</script></body></html>`;

fs.writeFileSync(path.join(OUT, 'Veteran-Inner-World.html'), html);
console.log('HTML:', path.join(OUT, 'Veteran-Inner-World.html'), (html.length / 1048576).toFixed(1) + ' MB');
console.log('veterans (self-declared):', men.length);
console.log('total themed quotes:', men.reduce((a, b) => a + b.themeCount, 0));
console.log(men.slice(0, 40).map(m => `${m.themeCount}\t${m.prospectWords}w\t${m.date}\t${m.name}`).join('\n'));
