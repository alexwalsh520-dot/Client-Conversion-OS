/**
 * Fills icp_highlights — the "Sharpest lines" tab on /icp.
 *
 *   cd dashboard && node scripts/sync-icp-highlights.mjs
 *
 * Source of truth is data/icp-sharpest-lines.md, a hand-picked selection from
 * the full corpus grouped under Alex's frames. Edit that file and re-run this
 * to change the tab. Safe to re-run: it replaces the table wholesale.
 *
 * The picking is editorial; the words are not. Every quote is copied verbatim
 * from what the person said on the call.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

const mdPath = path.join(process.cwd(), 'data', 'icp-sharpest-lines.md');
const rows = [];
let section = null;
let sectionPos = -1;
let pos = 0;

for (const raw of fs.readFileSync(mdPath, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line === '---' || line.startsWith('# ')) continue;

  if (line.startsWith('## ')) {
    section = line.slice(3).trim();
    sectionPos += 1;
    pos = 0;
    continue;
  }
  // anything before the first heading is the file's own preamble
  if (!section) continue;

  if (line.startsWith('- ')) {
    const body = line.slice(2);
    // "...quote..." — Name, YYYY-MM-DD
    const cut = body.lastIndexOf('" — ');
    if (cut > -1) {
      const quote = body.slice(0, cut + 1).replace(/^"|"$/g, '');
      const attribution = body.slice(cut + 4);
      const comma = attribution.lastIndexOf(', ');
      rows.push({
        section, section_pos: sectionPos, position: pos++, kind: 'quote',
        quote,
        person_name: comma > -1 ? attribution.slice(0, comma) : attribution,
        said_on: comma > -1 ? attribution.slice(comma + 2) : null,
      });
    } else {
      rows.push({ section, section_pos: sectionPos, position: pos++, kind: 'quote', quote: body.replace(/^"|"$/g, ''), person_name: null, said_on: null });
    }
    continue;
  }

  // a prose line inside a section is an editorial aside, kept in place
  rows.push({ section, section_pos: sectionPos, position: pos++, kind: 'note', quote: line, person_name: null, said_on: null });
}

console.log('sections:', sectionPos + 1);
console.log('quotes:', rows.filter(r => r.kind === 'quote').length);
console.log('notes:', rows.filter(r => r.kind === 'note').length);

const { error: delError } = await sb.from('icp_highlights').delete().neq('quote', '');
if (delError) { console.error(delError); process.exit(1); }

for (let i = 0; i < rows.length; i += 200) {
  const { error } = await sb.from('icp_highlights').insert(rows.slice(i, i + 200));
  if (error) { console.error(error); process.exit(1); }
}
console.log('written:', rows.length);
