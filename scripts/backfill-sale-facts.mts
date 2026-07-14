// One-time backfill of sale_attribution_facts using the canonical engine over a wide window.
// After this, the snapshot cron keeps recent facts fresh via computeAndStore's onSaleFact upsert.
// Run: node_modules/.bin/tsx scripts/backfill-sale-facts.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const { getAdsTrackerDashboard } = await import("../src/lib/ads-tracker/server.ts");
const { persistSaleFacts, persistAttributionSummary } = await import("../src/lib/ads-tracker/sale-facts.ts");

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
for (const account of ["tyson", "antwan"] as const) {
  const facts: any[] = [];
  const payload: any = await getAdsTrackerDashboard({ account, status: "all", level: "ad", dateFrom: "2026-03-01", dateTo: today } as any, { onSaleFact: (f: any) => facts.push(f) });
  const n = await persistSaleFacts(facts as any);
  await persistAttributionSummary(account, payload?.attribution, "2026-03-01", today);
  console.log(`${account}: persisted ${n} sale facts + summary`);
}
console.log("BACKFILL DONE");
