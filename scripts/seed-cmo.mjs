import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import crypto from 'crypto';
const env = fs.readFileSync('.env.local','utf8');
function get(k){
  const l = env.split(/\r?\n/).find(x=>x.startsWith(k+'='));
  if(!l) return '';
  let v = l.slice(k.length+1).trim();
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  return v;
}
const url = get('NEXT_PUBLIC_SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY');
console.log('url ok:', /^https?:\/\//.test(url), '| key len:', key.length);
const sb = createClient(url, key);
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0,16);
const jobs = [
  ['cmo_open_loops', 'public/open-loops.json', 'loops', e => e.id],
  ['cmo_learning_feed', 'public/memory-log.json', 'entries', e => 'feed-'+hash((e.at||'')+(e.title||''))],
  ['cmo_impact', 'public/cmo-ledger.json', 'entries', e => e.id],
  ['cmo_meetings', 'public/meetings-data.json', 'meetings', e => e.id],
];
for (const [table, file, key2, idfn] of jobs) {
  const arr = JSON.parse(fs.readFileSync(file,'utf8'))[key2] || [];
  const rows = arr.map((e,i)=>({ id: idfn(e), position: i, data: e }));
  const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' });
  if (error) { console.log('ERR', table, error.message); process.exit(1); }
  const { count } = await sb.from(table).select('*',{count:'exact',head:true});
  console.log('seeded', table, '->', rows.length, 'rows | table count:', count);
}
