// Mirrors the CMO brain's memory/*.md docs into the live cmo_docs table so the
// CMO tab's "Docs" group reflects them with no deploy. Run after writing/editing a doc.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const MEM = '/Users/alexwalsh/.claude/projects/-Users-alexwalsh-Documents-All-AI-Assets-Claude-Code-Experiment/memory';
const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
function envGet(k){
  const l = env.split(/\r?\n/).find(x => x.startsWith(k + '='));
  if (!l) return '';
  let v = l.slice(k.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
const sb = createClient(envGet('NEXT_PUBLIC_SUPABASE_URL'), envGet('SUPABASE_SERVICE_ROLE_KEY'));

function categoryFor(file) {
  if (file === 'current_state.md') return 'Source of Truth';
  if (file === 'MEMORY.md') return 'Index';
  if (/^antwan/i.test(file) || /icp/i.test(file)) return 'Antwan / ICP';
  if (/^project_/i.test(file)) return 'Project';
  if (/^reference_/i.test(file)) return 'Reference';
  if (/^feedback_/i.test(file)) return 'Feedback';
  return 'Note';
}
function titleFor(body, file) {
  const h = body.split(/\r?\n/).find(l => /^#\s+/.test(l));
  return h ? h.replace(/^#\s+/, '').trim() : file.replace(/\.md$/, '').replace(/[_-]/g, ' ');
}
function statusFor(body) {
  const l = body.split(/\r?\n/).slice(0, 12).find(x => /^status:\s*\w+/i.test(x.trim()));
  const s = l ? l.trim().replace(/^status:\s*/i, '').toLowerCase() : 'active';
  return ['archived', 'former', 'inactive'].includes(s) ? 'archived' : 'active';
}

const files = fs.readdirSync(MEM).filter(f => f.endsWith('.md'));
const rows = files.map(f => {
  const full = path.join(MEM, f);
  const body = fs.readFileSync(full, 'utf8');
  const updated = fs.statSync(full).mtime.toISOString().slice(0, 10);
  return {
    id: f.replace(/\.md$/, ''),
    mtime: fs.statSync(full).mtimeMs,
    data: { id: f.replace(/\.md$/, ''), title: titleFor(body, f), category: categoryFor(f), status: statusFor(body), updated, body, path: `memory/${f}` },
  };
});
// newest first by mtime -> position
rows.sort((a, b) => b.mtime - a.mtime);
const upserts = rows.map((r, i) => ({ id: r.id, position: i, data: r.data }));

const { error } = await sb.from('cmo_docs').upsert(upserts, { onConflict: 'id' });
if (error) { console.log('ERR', error.message); process.exit(1); }
// prune docs that no longer exist on disk
const ids = upserts.map(r => r.id);
const { data: existing } = await sb.from('cmo_docs').select('id');
const stale = (existing || []).map(r => r.id).filter(id => !ids.includes(id));
if (stale.length) await sb.from('cmo_docs').delete().in('id', stale);
const { count } = await sb.from('cmo_docs').select('*', { count: 'exact', head: true });
console.log(`synced ${upserts.length} docs (pruned ${stale.length}) | cmo_docs count: ${count}`);
console.log('categories:', [...new Set(upserts.map(r => r.data.category))].join(', '));
