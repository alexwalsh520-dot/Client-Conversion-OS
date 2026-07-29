/**
 * BUILD 4, PHASE 2 GATE — UTARI'S TRIAL.
 *
 * Every question on the locked list is asked through the Utari MCP endpoint
 * exactly as an external caller would ask it: real HTTP, real bearer token,
 * real JSON-RPC. Nothing here reaches into the app's own functions.
 *
 * For every numeric answer the trial then compares Utari's number with the Ads
 * v2 tab's saved payload, read straight out of the database, and prints the
 * comparison as a table. The gate is 100 percent. A mismatch is never tuned
 * away; it is printed and the run fails.
 *
 * Run (with the dev server up on the port below):
 *   node_modules/.bin/tsx scripts/utari-trial.mts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const { getServiceSupabase } = await import("../src/lib/supabase.ts");
const { ADSV2_SERVED_CLIENTS } = await import("../src/lib/ads-v2/config.ts");

const BASE = process.env.TRIAL_BASE_URL || "http://127.0.0.1:4808";
const URL_MCP = `${BASE}/api/mcp/utari`;
const TOKEN = process.env.UTARI_MCP_TOKEN;
if (!TOKEN) throw new Error("UTARI_MCP_TOKEN is not set; the trial must authenticate exactly as Jeremy's agent does");

let rpcId = 0;
const latencies: number[] = [];

/** One real JSON-RPC call over HTTP, with the bearer token, like any external client. */
async function call(tool: string, args: Record<string, unknown>): Promise<{ result: unknown; ms: number; isError: boolean }> {
  const started = Date.now();
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const ms = Date.now() - started;
  latencies.push(ms);
  const body = await res.json() as { result?: { content?: Array<{ text: string }>; isError?: boolean } };
  const text = body?.result?.content?.[0]?.text ?? "null";
  return { result: JSON.parse(text), ms, isError: body?.result?.isError === true };
}

const askDoor = (question_key: string | null, params: Record<string, unknown> = {}) =>
  call("ask_question", question_key === null ? {} : { question_key, params });

function pad(s: unknown, n: number) { return String(s).padEnd(n); }
function padL(s: unknown, n: number) { return String(s).padStart(n); }

const failures: string[] = [];
function check(label: string, utari: unknown, tab: unknown, rows: string[][]) {
  const match = Object.is(utari, tab);
  rows.push([label, String(utari), String(tab), match ? "yes" : "NO"]);
  if (!match) failures.push(`${label}: utari says ${utari}, the tab's saved payload says ${tab}`);
}

async function main(): Promise<void> {
  const db = getServiceSupabase();
  const clients = [...ADSV2_SERVED_CLIENTS];

  // 0. Auth must actually be enforced. A trial against an open door proves nothing.
  const noAuth = await fetch(URL_MCP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }) });
  console.log(`unauthenticated request status: ${noAuth.status} ${noAuth.status === 401 ? "(locked, as it should be)" : "*** NOT LOCKED ***"}`);
  if (noAuth.status !== 401) failures.push("the endpoint answered an unauthenticated request");

  // 1. The tool contract Jeremy depends on must still be there.
  const listRes = await fetch(URL_MCP, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list" }) });
  const tools = ((await listRes.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
  const EXPECTED_EXISTING = [
    "list_ads", "get_ad", "get_dms_for_ad", "get_ad_day", "list_sales", "get_sales_with_ad",
    "freshness", "business_snapshot", "get_ad_full", "get_call_transcripts", "get_organic_content",
    "describe_schema", "factory_list_projects", "factory_get_project", "factory_create", "factory_update",
  ];
  const missing = EXPECTED_EXISTING.filter((t) => !tools.includes(t));
  console.log(`\ntools exposed: ${tools.length} (was 16, plus ask_question = 17)`);
  console.log(`every pre-existing tool still present: ${missing.length === 0 ? "yes" : "NO, missing " + missing.join(", ")}`);
  console.log(`ask_question present: ${tools.includes("ask_question") ? "yes" : "NO"}`);
  if (missing.length) failures.push(`tools disappeared from Utari's contract: ${missing.join(", ")}`);
  if (!tools.includes("ask_question")) failures.push("ask_question was not exposed");

  // 2. The pinned version and every window the tab can serve right now.
  const { data: metaRow } = await db.from("adsv2_meta").select("value").eq("key", "data_version").maybeSingle();
  const version = Number((metaRow as { value: unknown } | null)?.value);
  const { data: snapRows } = await db
    .from("adsv2_window_snapshots")
    .select("account, date_from, date_to, status, payload")
    .eq("level", "tree").eq("data_version", version).order("date_from", { ascending: false });
  const saved = (snapRows || []) as Array<{ account: string; date_from: string; date_to: string; status: string; payload: { total: Record<string, number> } }>;
  console.log(`\ndata_version pinned for this trial: ${version}`);
  console.log(`saved windows the tab can serve right now: ${saved.length}`);

  // ── THE NUMERIC TRIAL ────────────────────────────────────────────────
  // metric_value, through Utari, for every saved window, against the payload.
  const rows: string[][] = [];
  const MONEY = [
    ["spend", "spendCents"], ["messages", "messages"], ["booked", "booked"],
    ["taken", "taken"], ["newClients", "newClients"], ["collected", "collectedCents"],
    ["impressions", "impressions"], ["clicks", "clicks"],
  ] as const;

  let windowsAsked = 0;
  for (const s of saved) {
    const r = await askDoor("metric_value", { client: s.account, date_from: s.date_from, date_to: s.date_to, status: s.status });
    const a = (r.result as { answers?: { total?: Record<string, number> }; refused?: boolean });
    const label = `${s.account} ${s.date_from}..${s.date_to} ${s.status}`;
    if (!a.answers) { failures.push(`${label}: utari could not answer: ${JSON.stringify(r.result).slice(0, 200)}`); continue; }
    windowsAsked++;
    for (const [metric, savedKey] of MONEY) {
      check(`${label} ${metric}`, a.answers.total?.[metric], s.payload.total[savedKey], rows);
    }
  }

  console.log(`\n─── THE TRIAL TABLE (every numeric answer, through the Utari MCP endpoint) ───`);
  console.log(`${pad("question", 46)} ${padL("utari", 12)} ${padL("the tab", 12)}  match`);
  const shown = rows.slice(0, 24);
  for (const [l, u, t, m] of shown) console.log(`${pad(l, 46)} ${padL(u, 12)} ${padL(t, 12)}  ${m}`);
  if (rows.length > shown.length) console.log(`  ... and ${rows.length - shown.length} more rows, all compared`);
  const matched = rows.filter((r) => r[3] === "yes").length;
  console.log(`\nnumeric comparisons: ${rows.length}   matched: ${matched}   mismatched: ${rows.length - matched}`);
  console.log(`windows asked through Utari: ${windowsAsked} of ${saved.length}`);

  // ── EVERY OTHER QUESTION, ASKED FOR REAL ─────────────────────────────
  console.log(`\n─── EVERY QUESTION ON THE LIST, ASKED THROUGH UTARI ───`);
  const thirty = { date_from: saved.find((s) => s.date_from < s.date_to)?.date_from ?? "2026-06-30", date_to: saved[0]?.date_to ?? "2026-07-29" };
  const asks: Array<[string, Record<string, unknown>]> = [];
  for (const c of clients) {
    asks.push(["yesterday_summary", { client: c }]);
    asks.push(["change_history", { client: c, ...thirty }]);
    asks.push(["ad_setup", { client: c, keyword: "fit" }]);
    asks.push(["sales_cycle", { client: c, ...thirty }]);
    asks.push(["kill_scale_inputs", { client: c, date_from: saved[0].date_from, date_to: saved[0].date_to, status: "all" }]);
    asks.push(["why_unattributed", { client: c, kind: "booking", name: "Hunter Chapman" }]);
    asks.push(["person_lookup", { client: c, name: "Hunter Chapman" }]);
  }
  asks.push(["attribution_share", thirty]);
  asks.push(["leak_map", thirty]);
  asks.push(["data_health", {}]);
  asks.push(["define", {}]);

  for (const [key, params] of asks) {
    const r = await askDoor(key, params);
    const res = r.result as { refused?: boolean; reason?: string; as_of?: Array<{ last_written_at: string | null }>; definitions_quoted?: unknown[]; answers?: unknown };
    const ok = !res.refused && !!res.answers;
    const asOf = res.as_of?.[0]?.last_written_at ?? "none";
    console.log(`${pad(key + " " + JSON.stringify(params).slice(0, 34), 62)} ${ok ? "answered" : "REFUSED "}  as_of=${String(asOf).slice(0, 19)}  ${r.ms}ms`);
    if (!ok) failures.push(`${key} ${JSON.stringify(params)} came back refused: ${res.reason}`);
    else if (!res.as_of?.length || !res.as_of[0].last_written_at) failures.push(`${key} answered without a real as-of time`);
  }

  // ── REFUSAL BEHAVIOUR, THROUGH THE SAME DOOR ─────────────────────────
  console.log(`\n─── REFUSALS (a locked door has to actually be locked) ───`);
  const refusals: Array<[string, string, Record<string, unknown>]> = [
    ["a question that is not on the list", "what is our profit margin", {}],
    ["a creator who has left the roster", "metric_value", { client: "antwan", date_from: saved[0].date_from, date_to: saved[0].date_to }],
    ["a window that was never saved", "metric_value", { client: "tyson", date_from: "2025-01-01", date_to: "2025-01-31" }],
    ["a malformed date", "metric_value", { client: "tyson", date_from: "yesterday", date_to: "today" }],
    ["a filter this question does not take", "data_health", { client: "tyson" }],
  ];
  for (const [what, key, params] of refusals) {
    const r = await askDoor(key, params);
    const res = r.result as { refused?: boolean; reason?: string; nearest?: unknown[] };
    const refused = res.refused === true;
    console.log(`${pad(what, 40)} ${refused ? "refused, in writing" : "*** ANSWERED ANYWAY ***"}`);
    if (refused) console.log(`   reason: ${String(res.reason).slice(0, 150)}`);
    if (!refused) failures.push(`${what}: the door answered when it should have refused`);
  }

  // ── FRESHNESS HONESTY ────────────────────────────────────────────────
  console.log(`\n─── FRESHNESS HONESTY (as-of times against the real write times) ───`);
  const health = await askDoor("metric_value", { client: clients[0], date_from: saved[0].date_from, date_to: saved[0].date_to, status: saved[0].status });
  const asOfList = (health.result as { as_of: Array<{ source: string; last_written_at: string }> }).as_of;
  const { data: realWrite } = await db
    .from("adsv2_window_snapshots").select("computed_at").eq("data_version", version)
    .order("computed_at", { ascending: false }).limit(1);
  const realNewest = (realWrite as Array<{ computed_at: string }> | null)?.[0]?.computed_at ?? null;
  const claimed = asOfList.find((x) => x.source === "warehouse.answers")?.last_written_at ?? null;
  const sameInstant = claimed && realNewest && Math.abs(new Date(claimed).getTime() - new Date(realNewest).getTime()) < 1000;
  console.log(`  utari's as-of for warehouse.answers: ${claimed}`);
  console.log(`  the newest saved answer's real write time: ${realNewest}`);
  console.log(`  same instant: ${sameInstant ? "yes" : "NO"}`);
  if (!sameInstant) failures.push("the as-of time does not match the real write time of the newest saved answer");

  // ── LIST_ADS, THE REPOINTED TOOL, IN ITS OLD SHAPE ───────────────────
  console.log(`\n─── list_ads: the repointed tool keeps its old shape and units ───`);
  for (const c of clients) {
    const r = await call("list_ads", { client: c });
    const res = r.result as { ads: Array<Record<string, unknown>>; window: { dateFrom: string; dateTo: string } | null };
    const top = res.ads?.[0];
    console.log(`  ${pad(c, 8)} ads=${padL(res.ads?.length ?? 0, 4)} window=${res.window?.dateFrom}..${res.window?.dateTo} ${r.ms}ms`);
    if (top) {
      console.log(`    top ad: keyword=${top.keyword} spend=$${top.spend} cash=$${top.cash_collected} roas=${top.roas} gross_profit=${top.gross_profit}`);
      // Units check: the saved answer holds cents, this tool must report dollars.
      const win = saved.find((s) => s.account === c && s.date_from === res.window?.dateFrom && s.date_to === res.window?.dateTo && s.status === "all");
      if (win) {
        const totalDollars = res.ads.reduce((sum, x) => sum + (Number(x.spend) || 0), 0);
        const savedDollars = Math.round(win.payload.total.spendCents) / 100;
        const close = Math.abs(totalDollars - savedDollars) < 0.02 * res.ads.length + 0.01;
        console.log(`    spend in DOLLARS: tool total $${totalDollars.toFixed(2)} vs saved answer $${savedDollars.toFixed(2)} ${close ? "(agrees, per-ad rounding only)" : "*** DISAGREES ***"}`);
        if (!close) failures.push(`list_ads spend for ${c} does not agree with the saved answer`);
      }
    }
  }

  // ── VERDICT ──────────────────────────────────────────────────────────
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  console.log(`\n─── TRIAL VERDICT ───`);
  console.log(`calls made over HTTP: ${latencies.length}   median ${p50}ms   95th percentile ${p95}ms   slowest ${latencies[latencies.length - 1]}ms`);
  console.log(`numeric match rate: ${matched}/${rows.length} (${rows.length ? ((matched / rows.length) * 100).toFixed(2) : "0"}%)`);
  if (failures.length) {
    console.log(`\nGATE FAILED. ${failures.length} problem(s):`);
    for (const f of failures.slice(0, 30)) console.log("  " + f);
    process.exitCode = 1;
  } else {
    console.log(`\nGATE PASSED: 100 percent match, every question answered or honestly refused, every answer carrying a real as-of time.`);
  }
}

await main().catch((e) => { console.error(e); process.exit(1); });
