#!/usr/bin/env tsx
/**
 * One-shot: import Nicole's Google Sheet onboarding backlog into the
 * new `onboarding_backlog` Supabase table.
 *
 * Delete this script after it runs successfully.
 *
 * Run: npx tsx scripts/import-onboarding-backlog.ts
 *
 * Sheet layout (Onboarding Backlog tab):
 *   Row 1: banner cell (skipped)
 *   Row 2: instructional text (skipped)
 *   Row 3: header row (Onboarder, Onboardee, Email, ...)
 *   Row 4+: data
 * Columns A–J.
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const SHEET_ID = "1XcQeG_ehg5BYCsSEJllelT0zVaJJwjRE1OZWf4gjeTo";
const TAB = "Onboarding Backlog";
const RANGE = `'${TAB}'!A4:J500`;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const gEmail = process.env.COACHING_GOOGLE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const gKey = process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!gEmail || !gKey) {
    throw new Error("missing Google service account credentials");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: gEmail,
      private_key: gKey.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: RANGE,
  });
  const rows = res.data.values ?? [];
  console.log(`✓ Pulled ${rows.length} rows from sheet`);

  // Column order per Nicole's sheet:
  //   A onboarder, B onboardee, C email, D closer, E amount_paid,
  //   F pif_status, G reschedule_email, H reminder_email,
  //   I closer_reachout, J comments
  const rowsToInsert = rows
    .map((r, i) => {
      const get = (c: number) => (r[c] ?? "").toString().trim();
      // Skip fully empty rows.
      if (r.every((c) => !((c ?? "").toString().trim()))) return null;
      return {
        onboarder: get(0),
        onboardee: get(1),
        email: get(2),
        closer: get(3),
        amount_paid: get(4),
        pif_status: get(5),
        reschedule_email: get(6),
        reminder_email: get(7),
        closer_reachout: get(8),
        comments: get(9),
        sort_order: (i + 1) * 10, // gaps of 10 so future inserts can slot in
        updated_by: "import-script",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  console.log(`✓ Prepared ${rowsToInsert.length} non-empty rows`);

  if (rowsToInsert.length === 0) {
    console.log("Nothing to insert.");
    return;
  }

  // Wipe existing data if the script was already run (idempotent).
  const { error: delErr } = await supabase
    .from("onboarding_backlog")
    .delete()
    .neq("id", -1);
  if (delErr) {
    console.error(`✗ Delete existing rows failed: ${delErr.message}`);
    process.exit(1);
  }

  const { error: insErr, data } = await supabase
    .from("onboarding_backlog")
    .insert(rowsToInsert)
    .select("id");
  if (insErr) {
    console.error(`✗ Insert failed: ${insErr.message}`);
    process.exit(1);
  }

  console.log(`✓ Inserted ${data?.length ?? 0} rows into onboarding_backlog`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
