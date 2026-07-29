/**
 * BUILD 4, PHASE 3 — run the thirteenth accuracy check on its own, against
 * live data, through Build 3's own runner, and show what it would record.
 * It writes nothing: the runner is handed just this one check and its rows are
 * printed rather than saved, so a manual run can never pollute the daily history.
 *
 * Run: node_modules/.bin/tsx scripts/run-check-13.mts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const { getServiceSupabase } = await import("../src/lib/supabase.ts");
const { ACCURACY_CHECKS } = await import("../src/lib/accuracy/checks.ts");
const { ADSV2_SERVED_CLIENTS } = await import("../src/lib/ads-v2/config.ts");
const { todayEt } = await import("../src/lib/ads-v2/time.ts");

const check = ACCURACY_CHECKS.find((c) => c.key === "one_front_door");
if (!check) throw new Error("the thirteenth check is not registered");

console.log(`checks registered: ${ACCURACY_CHECKS.length} (was 12, plus one_front_door = 13)`);
console.log(`running: ${check.key} — "${check.name}"`);
console.log(`its written tolerance: ${check.toleranceNote}\n`);

const started = Date.now();
const outcome = await check.run({
  db: getServiceSupabase(),
  now: new Date(),
  etDay: todayEt(),
  clients: [...ADSV2_SERVED_CLIENTS],
});
const ms = Date.now() - started;

console.log(`status:       ${outcome.status.toUpperCase()}`);
console.log(`${outcome.leftLabel}: ${outcome.leftValue}`);
console.log(`${outcome.rightLabel}: ${outcome.rightValue}`);
console.log(`difference:   ${outcome.diffValue === "" ? "(none)" : outcome.diffValue}`);
console.log(`what to do:   ${outcome.whatToDo ?? "(nothing, it is green)"}`);
console.log(`detail:       ${JSON.stringify(outcome.detail)}`);
console.log(`took:         ${ms}ms of its ${check.budgetMs}ms budget`);
console.log(`\nNOTHING WAS WRITTEN by this script; the row above is what the daily run would record.`);
