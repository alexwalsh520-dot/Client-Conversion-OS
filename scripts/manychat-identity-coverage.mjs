#!/usr/bin/env node
// The headline number for Phase 4, measured the same way every time.
//
// "Thread readable" means: this person sent a magic word, and we can follow their
// ManyChat id to an Instagram id that actually appears in the stored DM threads.
// That is the difference between knowing somebody messaged and being able to read
// what they said.
//
// Run it before the backfill and again after. Both numbers go in the report.
//
//   node --env-file=.env.local scripts/manychat-identity-coverage.mjs

import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await sb.rpc("manychat_identity_coverage");
if (error) {
  console.error("could not measure coverage:", error.message);
  process.exit(1);
}

console.log(`\nKeyword senders that can be tied to a readable Instagram thread`);
console.log(`measured ${new Date().toISOString()}\n`);
console.log("client".padEnd(12) + "senders".padStart(9) + "readable".padStart(10) + "share".padStart(8) + "still unlinked".padStart(16));
for (const r of data) {
  const pct = r.keyword_senders ? ((100 * r.thread_readable) / r.keyword_senders).toFixed(1) + "%" : "n/a";
  console.log(
    String(r.client).padEnd(12) +
      String(r.keyword_senders).padStart(9) +
      String(r.thread_readable).padStart(10) +
      pct.padStart(8) +
      String(r.still_unlinked).padStart(16),
  );
}
console.log("");
