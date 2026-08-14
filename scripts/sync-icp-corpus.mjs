/**
 * Fills the tables behind the /icp tab from fathom_calls.
 *
 *   cd dashboard && node scripts/sync-icp-corpus.mjs
 *
 * Safe to re-run: it replaces the corpus wholesale, so re-running after new
 * calls land just brings it up to date. Extraction rules live in
 * scripts/lib/icp-extract.mjs, shared with build-vet-corpus.mjs.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { THEMES, extractMen } from './lib/icp-extract.mjs';

// Resolved from the working directory, not from this file: scripts/ is a
// symlink into the Client-Conversion-OS repo, so a relative path off
// import.meta.url lands in the wrong checkout. Run this from dashboard/.
const envPath = path.join(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.error(`No .env.local at ${envPath} — run this from the dashboard/ directory.`);
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(label, fn) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fn();
    if (!res.error) return res;
    console.error(`  ${label} failed (try ${attempt}/6): ${res.error.message}`);
    if (attempt === 6) { console.error('giving up'); process.exit(1); }
    await sleep(2000 * attempt);
  }
}

// ---- pull every call ----
let from = 0, batch = 100, all = [];
while (true) {
  const { data } = await withRetry(`rows ${from}-${from + batch - 1}`, () =>
    sb.from('fathom_calls')
      .select('fathom_id,title,recorded_at,duration_sec,transcript')
      .range(from, from + batch - 1));
  if (!data.length) break;
  all = all.concat(data);
  from += batch;
  if (data.length < batch) break;
}
console.log('calls read:', all.length);

const men = extractMen(all);
console.log('veterans (self-declared):', men.length);

// ---- replace the corpus ----
await withRetry('clear quotes', () => sb.from('icp_quotes').delete().neq('fathom_id', ''));
await withRetry('clear people', () => sb.from('icp_people').delete().neq('fathom_id', ''));

const people = men.map(m => ({
  fathom_id: m.fathom_id,
  name: m.name,
  call_title: m.title,
  closer: m.closer,
  recorded_on: m.date || null,
  duration_sec: m.duration_sec ?? null,
  words_spoken: m.prospectWords,
  quote_count: m.themeCount,
  vet_lines: m.vetHits,
  raw_lines: m.prospectTurns.map(t => t.text),
  synced_at: new Date().toISOString(),
}));

for (let i = 0; i < people.length; i += 25) {
  await withRetry(`people ${i}`, () => sb.from('icp_people').insert(people.slice(i, i + 25)));
}
console.log('people written:', people.length);

const quotes = [];
for (const m of men) {
  let pos = 0;
  for (const [theme] of THEMES) {
    for (const it of m.themed[theme] || []) {
      quotes.push({ fathom_id: m.fathom_id, theme, quote: it.text, context: it.ctx || null, position: pos++ });
    }
  }
}
for (let i = 0; i < quotes.length; i += 500) {
  await withRetry(`quotes ${i}`, () => sb.from('icp_quotes').insert(quotes.slice(i, i + 500)));
}
console.log('quotes written:', quotes.length);
console.log('done');
