// TRUTH LAYER, Brick 1 - re-runnable registry seed.
//
// Re-seeds the three registries from their owner-signed source of truth:
//   registry_entities     via registry_seed_entities()      (upsert by canonical_key)
//   registry_definitions  via registry_seed_definitions()   (upsert by name+version)
//   registry_keywords     via registry_reseed_keywords()    (upsert by primary key)
//
// Every step is an UPSERT. Running this twice changes nothing; running it after
// new ad data lands refreshes keyword status and last_used. Nothing is deleted.
//
// The seed logic itself lives in SQL (migrations 064-067) so there is exactly
// ONE source of truth. This script only calls it and reports what happened.
//
// Usage:
//   node scripts/seed-registries.mjs
//   node scripts/seed-registries.mjs --keywords-only   (skip entities/definitions)
//
// Auth: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
function envGet(k) {
  const l = env.split(/\r?\n/).find((x) => x.startsWith(k + '='));
  if (!l) throw new Error(`Missing ${k} in .env.local`);
  return l.slice(k.length + 1).replace(/^["']|["']$/g, '').trim();
}

const sb = createClient(envGet('NEXT_PUBLIC_SUPABASE_URL'), envGet('SUPABASE_SERVICE_ROLE_KEY'));

const keywordsOnly = process.argv.includes('--keywords-only');

async function rpc(fn) {
  const { data, error } = await sb.rpc(fn);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

async function main() {
  console.log('TRUTH LAYER Brick 1 - seeding registries\n');

  if (!keywordsOnly) {
    // Entities MUST go first: registry_keywords.client_key references them.
    // This call also raises if any alias value maps to two entities, which
    // would make resolution ambiguous.
    const entities = await rpc('registry_seed_entities');
    console.log(`  entities     ${entities} rows upserted`);

    const definitions = await rpc('registry_seed_definitions');
    console.log(`  definitions  ${definitions} rows upserted`);
  } else {
    console.log('  entities     skipped (--keywords-only)');
    console.log('  definitions  skipped (--keywords-only)');
  }

  const kw = await rpc('registry_reseed_keywords');
  const row = Array.isArray(kw) ? kw[0] : kw;
  console.log(
    `  keywords     ${row.keywords_upserted} rows upserted ` +
    `(${row.ad_rows} ad, ${row.organic_rows} organic)`,
  );

  // Surface the state of the all-time uniqueness law every run, so a blocked
  // constraint can never quietly become invisible.
  const { data: collisions, error } = await sb
    .from('registry_keyword_active_collisions')
    .select('keyword_normalized, clients');
  if (error) throw new Error(`collision check failed: ${error.message}`);

  console.log('');
  if (!collisions.length) {
    console.log('  Keyword uniqueness: NO active collisions.');
    console.log('  The signed all-time law can be armed:');
    console.log('    select registry_enforce_keyword_uniqueness();');
  } else {
    console.log(`  Keyword uniqueness: BLOCKED by ${collisions.length} active collision(s).`);
    for (const c of collisions) {
      console.log(`    ${c.keyword_normalized} -> ${(c.clients || []).join(', ')}`);
    }
    console.log('  Resolve these (retire the loser, or confirm shared use is intended),');
    console.log('  then run: select registry_enforce_keyword_uniqueness();');
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error('\nSEED FAILED:', e.message);
  process.exit(1);
});
