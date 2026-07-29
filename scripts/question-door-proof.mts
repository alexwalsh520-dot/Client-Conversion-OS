/**
 * BUILD 4, PHASE 1 GATE — the live proof.
 *
 * For every window the tab can serve RIGHT NOW, for every account and status,
 * this asks the question door for every numeric metric and compares its answer
 * with the saved payload, read back through a SEPARATE raw query.
 *
 * Two things make this a real check rather than a restatement:
 *   1. The saved payload is re-read here with a plain select, not through the
 *      door's own reader, so a mistake in the door's reading shows up.
 *   2. The eleven calculated metrics are recomputed HERE from the definitions'
 *      own written sentences, not by calling the tab's derive(). If the door
 *      and this file disagree about what "collected ROAS" means, the run fails.
 *
 * Run: node_modules/.bin/tsx scripts/question-door-proof.mts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const { getServiceSupabase } = await import("../src/lib/supabase.ts");
const { askQuestion } = await import("../src/lib/question-door/service.ts");
const { isRefusal } = await import("../src/lib/question-door/types.ts");
type DoorAnswer = import("../src/lib/question-door/types.ts").DoorAnswer;
const { ANSWERABLE_METRIC_KEYS } = await import("../src/lib/question-door/answers.ts");
const { ADSV2_SERVED_CLIENTS } = await import("../src/lib/ads-v2/config.ts");

interface Base {
  spendCents: number; impressions: number; clicks: number; messages: number;
  booked: number; taken: number; takenPeople: number; showedPeople: number;
  upcoming: number; newClients: number; collectedCents: number; contractedCents: number;
}

// The eleven calculated metrics, written out from the stored definitions'
// own source sentences. Deliberately a second, independent statement of them.
function expected(key: string, b: Base): number | null {
  const div = (n: number, d: number) => (d ? n / d : null);
  switch (key) {
    case "spend": return b.spendCents;
    case "impressions": return b.impressions;
    case "clicks": return b.clicks;
    case "messages": return b.messages;
    case "booked": return b.booked;
    case "taken": return b.taken;
    case "newClients": return b.newClients;
    case "collected": return b.collectedCents;
    // "Ad spend divided by impressions, times one thousand."
    case "cpm": return b.impressions ? Math.round((b.spendCents / b.impressions) * 1000) : null;
    // "Link clicks divided by impressions."
    case "ctr": return div(b.clicks, b.impressions);
    // "Ad spend divided by link clicks."
    case "cpc": return b.clicks ? Math.round(b.spendCents / b.clicks) : null;
    // "Ad spend divided by DMs."
    case "costPerMessage": return b.messages ? Math.round(b.spendCents / b.messages) : null;
    // "Ad spend divided by calls booked."
    case "costPerBooked": return b.booked ? Math.round(b.spendCents / b.booked) : null;
    // "Ad spend divided by calls taken."
    case "costPerTaken": return b.taken ? Math.round(b.spendCents / b.taken) : null;
    // "People booked in this window who have a matching taken record, divided by
    //  people booked in this window minus upcoming."
    case "showRate": { const due = b.booked - b.upcoming; return due > 0 ? (b.showedPeople ?? 0) / due : null; }
    // "New clients divided by calls taken."
    case "closeRate": return div(b.newClients, b.taken);
    // "Calls booked divided by DMs."
    case "msgToCall": return div(b.booked, b.messages);
    // "Ad spend divided by new clients."
    case "costPerClient": return b.newClients ? Math.round(b.spendCents / b.newClients) : null;
    // "Collected revenue divided by ad spend."
    case "collectedRoi": return div(b.collectedCents, b.spendCents);
    default: throw new Error(`the proof does not know the metric ${key}`);
  }
}

const same = (a: unknown, b: unknown) => Object.is(a, b);

async function main(): Promise<void> {
  const db = getServiceSupabase();
  const { data: metaRow } = await db.from("adsv2_meta").select("value").eq("key", "data_version").maybeSingle();
  const version = Number((metaRow as { value: unknown } | null)?.value);
  console.log(`data_version pinned for this run: ${version}`);
  console.log(`active roster: ${ADSV2_SERVED_CLIENTS.join(", ")}\n`);

  const { data: rows, error } = await db
    .from("adsv2_window_snapshots")
    .select("account, date_from, date_to, status, computed_at, payload")
    .eq("level", "tree")
    .eq("data_version", version)
    .order("date_from", { ascending: false });
  if (error) throw new Error(error.message);
  const saved = (rows || []) as Array<{
    account: string; date_from: string; date_to: string; status: string;
    computed_at: string; payload: { total: Base; campaigns: unknown[] };
  }>;
  console.log(`saved windows at this version: ${saved.length}\n`);

  let comparisons = 0, mismatches = 0, windowsChecked = 0, adRowsChecked = 0;
  const failures: string[] = [];
  const sampleLines: string[] = [];

  for (const s of saved) {
    const r = await askQuestion({
      question_key: "metric_value",
      params: { client: s.account, date_from: s.date_from, date_to: s.date_to, status: s.status, scope: "per_ad" },
    });
    const label = `${s.account} ${s.date_from}..${s.date_to} ${s.status}`;
    if (isRefusal(r)) { failures.push(`${label}: door refused a window it should serve: ${r.reason}`); mismatches++; continue; }
    const answer = r as DoorAnswer;
    const a = answer.answers as { total: Record<string, number | null>; ads: Array<Record<string, unknown>> };
    windowsChecked++;

    for (const key of ANSWERABLE_METRIC_KEYS) {
      comparisons++;
      const want = expected(key, s.payload.total);
      const got = a.total[key];
      if (!same(want, got)) { mismatches++; failures.push(`${label} total.${key}: saved says ${want}, door says ${got}`); }
    }

    // Every ad row, against the same leaf in the saved tree.
    const leaves: Array<{ id: string; base: Base }> = [];
    for (const camp of (s.payload.campaigns || []) as Array<{ children?: Array<{ children?: Array<Record<string, unknown>> }> }>) {
      for (const set of camp.children || []) {
        for (const ad of set.children || []) leaves.push({ id: String(ad.id), base: ad as unknown as Base });
      }
    }
    const byId = new Map(a.ads.map((x) => [String(x.ad_id), x]));
    if (leaves.length !== a.ads.length) {
      mismatches++; failures.push(`${label}: saved tree has ${leaves.length} ads, door returned ${a.ads.length}`);
    }
    for (const leaf of leaves) {
      const got = byId.get(leaf.id);
      adRowsChecked++;
      if (!got) { mismatches++; failures.push(`${label}: door is missing ad ${leaf.id}`); continue; }
      for (const key of ANSWERABLE_METRIC_KEYS) {
        comparisons++;
        const want = expected(key, leaf.base);
        if (!same(want, got[key])) { mismatches++; failures.push(`${label} ad ${leaf.id}.${key}: saved says ${want}, door says ${got[key]}`); }
      }
    }

    if (sampleLines.length < 8 && (s.account === "tyson" || s.account === "jake") && s.status === "all") {
      sampleLines.push(
        `${label.padEnd(38)} spend=${a.total.spend} dms=${a.total.messages} booked=${a.total.booked} closes=${a.total.newClients} cash=${a.total.collected} roas=${a.total.collectedRoi}`,
      );
    }
    // Law 5, proved on every single answer rather than sampled.
    if (!answer.definitions_quoted.length) { mismatches++; failures.push(`${label}: no definitions quoted`); }
    if (!answer.as_of.length || !answer.as_of[0].last_written_at) {
      mismatches++; failures.push(`${label}: no real as-of time`);
    }
  }

  console.log("SAMPLE OF THE DOOR'S OWN ANSWERS (money in cents):");
  for (const l of sampleLines) console.log("  " + l);

  console.log(`\nwindows checked:      ${windowsChecked}`);
  console.log(`ad rows checked:      ${adRowsChecked}`);
  console.log(`number comparisons:   ${comparisons}`);
  console.log(`mismatches:           ${mismatches}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures.slice(0, 40)) console.log("  " + f);
    process.exitCode = 1;
  } else {
    console.log("\nGATE PASSED: every number the door returned equals the saved answer, and every answer carried its definitions and a real as-of time.");
  }
}

await main().catch((e) => { console.error(e); process.exit(1); });
