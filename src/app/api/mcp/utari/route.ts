// Remote HTTP MCP server for UTARI (Alex's hosted AI agent). Speaks MCP over JSON-RPC 2.0
// on POST, bearer-token gated, read-only, exposing the accurate CCOS Foundation layers.
// Deploys with the app at https://<domain>/api/mcp/utari. Auth: Authorization: Bearer $UTARI_MCP_TOKEN.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { dedupeSalesRows, type DedupableSaleRow } from "@/lib/ads-tracker/dedupe-sales";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { askQuestion, describeDoor } from "@/lib/question-door/service";
import { canonicalAdsFromDoor, UTARI_DOOR_NOTE } from "@/lib/question-door/utari-adapter";

// Attribution certainty from the stamp method. HARD keys only are machine_attributed; a prospect-name
// match is its own explicitly-at-risk status (name_matched), never machine certainty; no fact = unresolved.
const methodRank = (m: string) => (m === "link_dm" ? 3 : m === "link_booking" ? 2 : m === "name" ? 1 : 0);
function statusForMethod(method: string | undefined | null): "machine_attributed" | "name_matched" | "unresolved" {
  if (method === "link_dm" || method === "link_booking") return "machine_attributed";
  if (method === "name") return "name_matched";
  return "unresolved";
}
import {
  dataFreshness,
  coverageFor,
  businessSnapshot,
  getAdFull,
  getCallTranscripts,
  getOrganicContent,
  dmThreadsForKeyword,
  SCHEMA_DOC,
} from "@/lib/utari/foundation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TOKEN = process.env.UTARI_MCP_TOKEN;

// The creators this endpoint serves, read from the engine's own active roster and
// never hardcoded. BUILD 4 CHANGE, and the one thing Jeremy needs telling about:
// the `client` enum used to be a fixed ["tyson", "antwan"]. Antwan left the roster
// on 21 July 2026, so asking for him now returns an honest refusal rather than a
// silently empty answer, and Jake is available. Every other tool name, field name
// and unit is unchanged.
const SERVED: string[] = [...ADSV2_SERVED_CLIENTS];

// Tools that get the standard response envelope (data_freshness + coverage). Excludes the
// static describe_schema and the factory proxy tools (drafts, not business reads).
const ENVELOPE_TOOLS = new Set([
  "list_ads", "get_ad", "get_dms_for_ad", "get_ad_day", "list_sales", "get_sales_with_ad",
  "freshness", "business_snapshot", "get_ad_full", "get_call_transcripts", "get_organic_content",
]);

// The CANONICAL per-ad funnel — the exact numbers on the Ads v2 tab.
//
// BUILD 4 REPOINT. This used to read the older ads-tracker snapshot. It now goes
// through the LOCKED QUESTION DOOR to warehouse.answers: the very row the Ads v2
// tab paints from, so Utari and the screen cannot disagree. Field names and units
// are deliberately unchanged (money in DOLLARS); the one honest gap, gross profit,
// is returned as null with a written reason rather than estimated. See
// src/lib/question-door/utari-adapter.ts.
//
// We still merge in the live ad_state extras (status / CPM / impressions /
// targeting / on-image copy) by keyword. That is a read Utari already had; this
// build widens nothing.
async function canonicalAds(client: string) {
  const sb = getServiceSupabase();
  const { data: state } = await sb.from("ad_state").select("keyword,status,impressions,cpm,last_status_day,audience_type,is_advantage,age_min,age_max,has_lookalike,on_image_text").eq("client_key", client);
  const byKw: Record<string, Record<string, unknown>> = {};
  for (const s of state || []) byKw[String((s as { keyword: string }).keyword)] = s;
  const out = await canonicalAdsFromDoor(sb, client, byKw);
  return { ads: out.ads, window: out.window, refused: out.refused, as_of: out.as_of };
}

// Factory (the /factory tab) is a copy/content workspace: projects -> groups -> items
// (ad copy, image direction, docs) -> named batch snapshots. We proxy to the SAME /api/factory
// route the tab uses (in-process, same origin) so behaviour never drifts from the UI. Read + write.
// No money, Meta, or publishing surface here — worst case is messy drafts, and batches snapshot
// before a restore replaces cards.
async function factoryProxy(origin: string, method: "GET" | "POST" | "PATCH", opts: { query?: Record<string, string>; body?: unknown }) {
  const qs = opts.query ? "?" + new URLSearchParams(opts.query).toString() : "";
  const res = await fetch(`${origin}/api/factory${qs}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const text = await res.text();
  let json: unknown; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) return { error: (json as { error?: string })?.error || `factory ${method} failed (${res.status})` };
  return json;
}

function authed(req: NextRequest): boolean {
  if (!TOKEN) return false; // no token configured = locked shut
  const h = req.headers.get("authorization") || "";
  if (h === `Bearer ${TOKEN}` || h === TOKEN) return true;
  // Some MCP connectors pass the token in the URL query instead of a header (e.g. ?k=<token>).
  const q = req.nextUrl.searchParams;
  const qk = q.get("k") || q.get("token") || q.get("key") || q.get("apiKey") || "";
  return qk === TOKEN || qk === `Bearer ${TOKEN}`;
}

const TOOLS = [
  { name: "list_ads", description: "Complete per-ad state for a creator: status, spend, 7-day spend, impressions, clicks, CPM, DMs, leads, closes, cash, ROAS, targeting (audience type, Advantage on/off, age, lookalike), and on-image copy. One row per ad. The trustworthy per-ad read.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED } }, required: ["client"] } },
  { name: "get_ad", description: "One ad by its KEYWORD (the keyword is the ad's identity). Returns a keyword-level canonical funnel aggregate (money + funnel are keyword-level truths), a placements[] array of every ad_id/campaign/adset/status/spend that ran that keyword (spend is placement-level), and a sample of the DM conversations the keyword started. When a keyword ran as more than one placement this never silently returns just the first; it aggregates and lists all. Pass ad_id to scope the spend fields to one placement.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, keyword: { type: "string" }, ad_id: { type: "string", description: "optional: scope the placement/spend fields to one ad_id" }, dm_limit: { type: "number" } }, required: ["client", "keyword"] } },
  { name: "get_dms_for_ad", description: "Every DM conversation a keyword started, full verbatim thread. Threads are derived live from the keyword's ManyChat subscribers bridged to their Instagram threads (instagram_lead_links), so the count tracks the funnel's unique-DM count for the window, not a stale prebuilt table. Includes a coverage block (keyword_subscribers vs threads_resolved). Optional since (ISO date) windows the subscribers.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, keyword: { type: "string" }, since: { type: "string", description: "ISO date; only subscribers whose first keyword DM is on/after this" }, limit: { type: "number" } }, required: ["client", "keyword"] } },
  { name: "get_ad_day", description: "Per-day metrics for ads: spend, impressions, clicks, CPM, status. One row per ad per day.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, keyword: { type: "string" }, since: { type: "string" } }, required: ["client"] } },
  { name: "list_sales", description: "The sales ledger: date, prospect, collected, closer, setter, objection, call notes.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, wins_only: { type: "boolean" } }, required: ["client"] } },
  { name: "get_sales_with_ad", description: "The DEDUPED sales ledger, each win annotated with its canonical ad attribution and an honest certainty: attribution_status machine_attributed (hard key: link_dm DM thread or link_booking), name_matched (prospect-name match, at risk, NOT a hard key), or unresolved (no ad keyword). Returns `counts`, a `reconciliation` block (itemized vs the canonical all-time attributed figure), and `coverage`. Close counts match the dashboard. Optional `since` (ISO date).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, since: { type: "string" } }, required: ["client"] } },
  { name: "freshness", description: "Minutes since each data source last synced.", inputSchema: { type: "object", properties: {} } },
  { name: "business_snapshot", description: "Per creator (Tyson, Antwan) + combined: current-week and prior-week canonical funnel (spend, dms, cost_per_dm, booked_calls, cost_per_booked_call, calls_taken, show_rate, closes, close_rate, cash_collected, roas), top 3 and bottom 3 funded ads, and the count of funded zero-DM ads. Sourced from the Ads Dashboard snapshot; matches the Ads tab to the dollar for the same stored window.",
    inputSchema: { type: "object", properties: {} } },
  { name: "get_ad_full", description: "Everything about ONE ad in a single call: canonical funnel row, placement lineage (every ad_id/campaign/adset/spend/status), on-image + primary copy, per-day spend/DM series, and thread digests (subscriber, first DM, message count, became_sale, 2-line excerpt). Full verbatim threads: use get_dms_for_ad.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, keyword: { type: "string" }, since: { type: "string", description: "ISO date; filters the per-day series + thread digests (default = snapshot window start)" } }, required: ["client", "keyword"] } },
  { name: "get_call_transcripts", description: "Fathom call transcripts. List mode (no id) = summaries + fathom ids for a creator; single-id mode = the full transcript. Calls carry no hard key to an ad or DM thread, so linkage_status is always 'unlinked' (correlate on prospect_name only, non-authoritative).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, id: { type: "string", description: "fathom_id for the full transcript" }, since: { type: "string" }, limit: { type: "number" } }, required: ["client"] } },
  { name: "get_organic_content", description: "RAW organic Instagram posts for a creator (no AI grading by default). List mode per post: taken_at, media_type, caption excerpt, transcript_available + transcript_words, engagement (views/plays/likes/comments; not_tracked when IG omits them), permalink. Single-post mode (pass id = ig_media_id) = full caption + full transcript. Pass include_grades:true to append the internal AI grade (opt-in, advisory). Also returns follower_history. Optional since/until/band/limit.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: SERVED }, id: { type: "string" }, since: { type: "string" }, until: { type: "string" }, band: { type: "string", description: "grade band filter (only applies with include_grades)" }, limit: { type: "number" }, include_grades: { type: "boolean", description: "opt in to the internal AI grade (advisory)" } }, required: ["client"] } },
  { name: "describe_schema", description: "Static, versioned documentation of every tool, field semantics, the three attribution_status meanings, the DM-count definition, and the known accuracy ceilings. No DB call. Read this first to understand what every number means.",
    inputSchema: { type: "object", properties: {} } },
  // ---- The locked question door (Build 4). The full front door, same one the app uses. ----
  { name: "ask_question", description:
      "THE FRONT DOOR. Ask one of a fixed, locked list of questions about the money system and get back the saved answer, the stored meaning of every number it names, and how fresh the underlying data is. " +
      "This is the trustworthy path: every question is answered by one fixed, tested query that reads numbers computed and saved BEFORE you asked, so asking twice gives the same answer and the Ads v2 tab shows the identical figure. " +
      "No query is composed on your behalf and there is no free-form SQL. A question that is not on the list comes back refused in writing, naming the nearest allowed question. " +
      "Call it with no question_key to get the whole list with each question's parameters. " +
      "The fourteen questions: metric_value (any defined metric for a saved window, total or per ad), yesterday_summary (yesterday's numbers plus every ad change made yesterday), change_history (what changed on an ad, ad set or campaign, with exact times and who), why_unattributed (the written reason a booking or sale carries no ad), ad_setup (how one ad is configured), person_lookup (a person by an exact id; a name returns a candidate list only), sales_cycle (days from first keyword to close), attribution_share (where a window's cash sits), leak_map (where attribution leaks), kill_scale_inputs (the facts behind a kill-or-scale call over a SAVED window, inputs only, never a verdict), kill_scale_read (the full kill-or-scale read over any trailing window), health_check (whether the ads can actually deliver right now, read LIVE from Meta), data_health (the latest daily accuracy run), define (any number's stored meaning). " +
      "READ THIS IF YOU ARE ADVISING ON ADS. kill_scale_read has three modes and the difference matters. mode=facts returns the complete certified decision inputs with NO VERDICTS AT ALL: every ad and ad set with spend, run rate, DMs, bookings, calls taken, closes, cash, collected ROI, days live, the 72-hour fatigue measurement, prior-window history, per-creator economics, the budget map reconciled to yesterday's real spend, and the named closes. That mode exists FOR YOU: form your own judgement from the same numbers the owner uses. mode=decide returns those identical numbers plus this system's own verdicts under a named, versioned ruleset (default zakk_v1), every verdict stamped `under_ruleset` and carrying a `basis` naming the signed definitions and the numbers that earned it; a verdict is advice under a lens, never the truth. mode=watch is the daily read and returns FLAGS ONLY, with no recommendation of any kind. " +
      "MONEY IS IN CENTS in these answers, unlike the older per-ad tools which report dollars; each metric's quoted definition names its format.",
    inputSchema: { type: "object", properties: {
      question_key: { type: "string", description: "one of the fourteen allowed questions. Leave it out to list them all." },
      params: { type: "object", description: "the named parameters that question takes, exactly as its entry describes them" },
    }, required: [] } },
  // ---- Factory (the /factory content workspace): full read + write ----
  { name: "factory_list_projects", description: "List every Factory project (id, name, client). Factory = the copy/content workspace where ad copy, image directions, and docs are drafted, organized into groups, and snapshotted as batches.",
    inputSchema: { type: "object", properties: {} } },
  { name: "factory_get_project", description: "One Factory project's full tree: its groups, all items (each with kind, label, copy_text, body_md, image_direction, stage, status, image_url, tags, comments, checklist), batch snapshots, and per-stage counts.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "factory_create", description: "Create Factory content. action=createProject{name,client?} | createGroup{projectId,name,kind?,description?} | createItem{projectId,groupId?,kind?(doc|image_ad),label?,copyText?,bodyMd?,imageDirection?,bucket?,style?,status?} | createBatch{projectId,groupId?,label?,note?} (snapshots current cards) | restoreBatch{batchId} (auto-saves current cards first, then replaces them with the batch).",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["createProject", "createGroup", "createItem", "createBatch", "restoreBatch"] }, projectId: { type: "string" }, groupId: { type: "string" }, batchId: { type: "string" }, name: { type: "string" }, client: { type: "string" }, kind: { type: "string" }, label: { type: "string" }, copyText: { type: "string" }, bodyMd: { type: "string" }, imageDirection: { type: "string" }, bucket: { type: "string" }, style: { type: "string" }, status: { type: "string" }, description: { type: "string" }, note: { type: "string" } }, required: ["action"] } },
  { name: "factory_update", description: "Update one Factory item (pass id) or one group (pass groupId). Item fields: label, bodyMd, copyText, imageDirection, status, stage(copy_written|image_generated|revision|completed), imageUrl, bucket, style, tags[], approve(true=>completed), revisionNote, groupIdSet(move to a group), sortOrder. Group fields: name, collapsed, sortOrder, kind, description. This is how you write a rewritten draft back.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, groupId: { type: "string" }, label: { type: "string" }, bodyMd: { type: "string" }, copyText: { type: "string" }, imageDirection: { type: "string" }, status: { type: "string" }, stage: { type: "string" }, imageUrl: { type: "string" }, bucket: { type: "string" }, style: { type: "string" }, tags: { type: "array", items: { type: "string" } }, approve: { type: "boolean" }, revisionNote: { type: "string" }, groupIdSet: { type: "string" }, sortOrder: { type: "number" }, name: { type: "string" }, collapsed: { type: "boolean" }, kind: { type: "string" }, description: { type: "string" } }, required: [] } },
];

// Keyword-level funnel = sum of its placements' primitives, ratios recomputed from the sums (a keyword
// is one ad identity across placements). Spend/dms/closes/cash are keyword truths; ratios never averaged.
function aggregateKeywordFunnel(rows: Array<Record<string, unknown>>) {
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const sum = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
  const spend = Math.round(sum("spend") * 100) / 100;
  const dms = sum("dms"), booked = sum("booked_calls"), calls = sum("calls_taken"), closes = sum("closes");
  const cash = sum("cash_collected");
  const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    placements_count: rows.length,
    spend, dms, cost_per_dm: ratio(spend, dms),
    booked_calls: booked, cost_per_booked_call: ratio(spend, booked),
    calls_taken: calls, show_rate: ratio(calls, booked),
    closes, close_rate: ratio(closes, calls),
    cash_collected: cash, roas: spend > 0 ? Math.round((cash / spend) * 100) / 100 : null,
    // Null, not zero. Gross profit came from the v1 unit-economics model, which the
    // saved answers do not carry. A zero here would read as "made no profit", which
    // is a different and wrong statement from "we are not reporting this".
    gross_profit: null, gross_profit_roas: null,
    gross_profit_note: "not carried by the saved answers; see the note on list_ads",
  };
}

// DM threads for an ad keyword, via the LIVE ManyChat->Instagram bridge (dmThreadsForKeyword). The
// old static dm_ad_links path returned zero because its id scoping diverged from the messages table.
async function dmsForAd(client: string, keyword: string, limit: number, since?: string) {
  const sb = getServiceSupabase();
  const { threads, coverage } = await dmThreadsForKeyword(sb, client, keyword, { limit, since });
  const conversations = threads.map((t) => ({ subscriber: t.subscriber_manychat, ig_subscriber_id: t.ig_subscriber_id, message_count: t.message_count, messages: t.messages }));
  return { conversations, coverage };
}

async function callTool(name: string, a: Record<string, unknown>, origin: string): Promise<unknown> {
  const sb = getServiceSupabase();
  const client = a.client as string;
  switch (name) {
    case "factory_list_projects":
      return factoryProxy(origin, "GET", {});
    case "factory_get_project":
      return factoryProxy(origin, "GET", { query: { projectId: a.projectId as string } });
    case "factory_create":
      return factoryProxy(origin, "POST", { body: a });
    case "factory_update":
      return factoryProxy(origin, "PATCH", { body: a });
    case "ask_question": {
      // The whole locked list, when no question is named. Not an error: a caller
      // that does not know what it may ask should be told, not refused.
      if (!a.question_key) {
        return {
          note: "These are the only questions this door answers. Anything else comes back refused in writing, with the nearest allowed question named. Money in these answers is in CENTS.",
          questions: describeDoor(),
        };
      }
      return askQuestion(
        {
          question_key: a.question_key,
          params: (a.params as Record<string, unknown>) || {},
        },
        { caller: "utari" },
      );
    }
    case "list_ads": {
      const { ads, window, refused, as_of } = await canonicalAds(client);
      if (refused) return { note: "The saved answers could not serve this window, so no numbers are being returned rather than estimated ones.", refused, window: null, ads: [] };
      ads.sort((x, y) => ((y.spend as number) || 0) - ((x.spend as number) || 0));
      return { note: "CANONICAL Ads v2 attribution per ad: spend, dms, booked_calls, calls_taken, closes, cash_collected, roas, funnel ad->DM->booked->taken->closed. Merged with live status/CPM/impressions/targeting/copy. `window` is the period these funnel numbers cover. " + UTARI_DOOR_NOTE, window, as_of, ads };
    }
    case "get_ad": {
      const kw = (a.keyword as string).toLowerCase();
      const adId = a.ad_id ? String(a.ad_id) : null;
      const { ads, window } = await canonicalAds(client);
      // Bug 3: a keyword IS the ad's identity across placements. Return the keyword-level canonical
      // aggregate (money + funnel are keyword-level truths) PLUS every placement (spend is placement-
      // level). Never silently pick the first match. Optional ad_id scopes the placement view.
      const placements = ads.filter((x) => String(x.keyword).toLowerCase() === kw);
      if (!placements.length) return { found: false, keyword: kw, window, note: "keyword not present in the latest snapshot" };
      const scoped = adId ? placements.filter((p) => String(p.ad_id ?? "") === adId) : placements;
      const funnel = aggregateKeywordFunnel(
        (scoped.length ? scoped : placements) as unknown as Array<Record<string, unknown>>,
      );
      const dms = await dmsForAd(client, kw, (a.dm_limit as number) || 5, a.since as string | undefined);
      return {
        found: true, keyword: kw, window,
        funnel,
        placements: placements.map((p) => ({ ad_id: p.ad_id ?? null, campaign_name: p.campaign_name ?? null, adset_name: p.adset_name ?? null, status: p.status ?? null, spend: p.spend ?? 0 })),
        placement_scope: adId || "all",
        sample_dms: dms.conversations,
        dm_coverage: dms.coverage,
        note: "funnel = keyword-level canonical aggregate across placements (spend/dms/closes/cash are keyword truths). placements[] splits spend per ad_id. Pass ad_id to scope the funnel to one placement. sample_dms is a live sample; full threads via get_dms_for_ad.",
      };
    }
    case "get_dms_for_ad": {
      const { conversations, coverage } = await dmsForAd(client, a.keyword as string, (a.limit as number) || 20, a.since as string | undefined);
      return { keyword: a.keyword, conversations, thread_coverage: coverage, note: "Verbatim DM threads for the ad keyword, resolved live (ManyChat->Instagram bridge). thread_coverage.threads_resolved vs keyword_subscribers shows how many of the keyword's unique DMs have a linked thread. (The envelope's separate `coverage` is the window cash attribution %, a different metric.)" };
    }
    case "get_ad_day": {
      let q = sb.from("ad_day").select("*").eq("client_key", client).order("date", { ascending: false });
      if (a.keyword) q = q.eq("keyword", (a.keyword as string).toLowerCase());
      if (a.since) q = q.gte("date", a.since as string);
      const { data } = await q.limit(2000);
      return { note: "one row per ad per day", days: data };
    }
    case "list_sales": {
      const { data } = await sb.from("sales_tracker_rows").select("date,prospect_name,prospect_name_normalized,call_number,collected_revenue_cents,contracted_revenue_cents,offer,synced_at,closer,setter,objection,call_notes,program_length").ilike("offer", `%${client}%`).order("date");
      // Dedupe the ledger the SAME way the Ads tab does, so a sync-created duplicate never appears twice.
      const ledger = dedupeSalesRows((data as unknown as DedupableSaleRow[]) || []) as unknown as Record<string, unknown>[];
      // Stamp attribution_status per sale from the canonical facts. HARD keys (link_dm/link_booking) =
      // machine_attributed; a prospect-name match = name_matched (at risk, not certainty); absent = unresolved.
      const { data: facts } = await sb.from("sale_attribution_facts").select("occurred_day,prospect_name,keyword_normalized,method").eq("client_key", client);
      const factByKey: Record<string, { keyword: string; method: string }> = {};
      for (const f of (facts as Record<string, unknown>[]) || []) {
        const key = `${String(f.prospect_name || "").toLowerCase().trim()}|${String(f.occurred_day || "").slice(0, 10)}`;
        const cur = factByKey[key];
        if (!cur || methodRank(String(f.method || "")) > methodRank(cur.method)) factByKey[key] = { keyword: String(f.keyword_normalized || ""), method: String(f.method || "") };
      }
      let rows = ledger.map((s: Record<string, unknown>) => {
        const norm = String(s.prospect_name_normalized || s.prospect_name || "").toLowerCase().trim();
        const hit = factByKey[`${norm}|${String(s.date || "").slice(0, 10)}`];
        return {
          date: s.date, name: s.prospect_name, cash_collected: Math.round(((s.collected_revenue_cents as number) || 0) / 100),
          closer: s.closer, setter: s.setter, objection: s.objection, program: s.program_length, notes: s.call_notes,
          attribution_status: statusForMethod(hit?.method),
          ad_keyword: hit ? hit.keyword : null,
          attribution_method: hit ? hit.method : null,
        };
      });
      if (a.wins_only !== false) rows = rows.filter((r) => r.cash_collected > 0);
      return { note: "Deduped sales ledger (v2). attribution_status per sale: machine_attributed (hard key link_dm/link_booking), name_matched (prospect-name match, at risk, not a hard key), or unresolved (no ad keyword). resolved_organic is aggregate-only; see coverage + describe_schema.", sales: rows };
    }
    case "get_sales_with_ad": {
      // Drive off the DEDUPED sales ledger (same dedupe the Ads tab uses) so close counts match the
      // dashboard and stale/superseded facts (e.g. an old amount for the same person+day) can't inflate
      // the count. Each win is annotated with its canonical attribution + honest certainty status.
      const { data: ledgerRaw } = await sb.from("sales_tracker_rows")
        .select("date,prospect_name,prospect_name_normalized,call_number,collected_revenue_cents,contracted_revenue_cents,offer,synced_at")
        .ilike("offer", `%${client}%`).order("date");
      const ledger = dedupeSalesRows((ledgerRaw as unknown as DedupableSaleRow[]) || []) as unknown as Record<string, unknown>[];
      let wins = ledger.filter((r) => ((r.collected_revenue_cents as number) || 0) > 0);
      if (a.since) wins = wins.filter((r) => String(r.date || "") >= String(a.since));
      const { data: facts } = await sb.from("sale_attribution_facts").select("occurred_day,prospect_name,keyword_normalized,method,subscriber_id").eq("client_key", client);
      const factByKey: Record<string, { keyword: string; method: string; subscriber_id: unknown }> = {};
      for (const f of (facts as Record<string, unknown>[]) || []) {
        const key = `${String(f.prospect_name || "").toLowerCase().trim()}|${String(f.occurred_day || "").slice(0, 10)}`;
        const cur = factByKey[key];
        if (!cur || methodRank(String(f.method || "")) > methodRank(cur.method)) factByKey[key] = { keyword: String(f.keyword_normalized || ""), method: String(f.method || ""), subscriber_id: f.subscriber_id };
      }
      const rows = wins.map((s: Record<string, unknown>) => {
        const norm = String(s.prospect_name_normalized || s.prospect_name || "").toLowerCase().trim();
        const hit = factByKey[`${norm}|${String(s.date || "").slice(0, 10)}`];
        return {
          date: s.date, name: s.prospect_name, cash_collected: Math.round(((s.collected_revenue_cents as number) || 0) / 100),
          ad_keyword: hit ? hit.keyword : null,
          attribution_status: statusForMethod(hit?.method),
          attribution_method: hit ? hit.method : null,
          dm_linked: hit?.method === "link_dm",
          subscriber_id: hit?.subscriber_id ?? null,
        };
      });
      const byStatus: Record<string, { sales: number; cash: number }> = {};
      for (const r of rows) { const k = r.attribution_status; byStatus[k] = byStatus[k] || { sales: 0, cash: 0 }; byStatus[k].sales++; byStatus[k].cash += r.cash_collected; }
      const hardKeyCash = byStatus.machine_attributed?.cash || 0;
      const nameMatchedCash = byStatus.name_matched?.cash || 0;
      const itemizedAttributedCash = hardKeyCash + nameMatchedCash;
      // Canonical reconciliation: the Dashboard's own all-time attributed figure (attribution_summary).
      const { data: sum } = await sb.from("attribution_summary").select("all_time_paid_attributed,computed_at").eq("client_key", client).maybeSingle();
      const canonicalAllTimePaid = sum ? Math.round((sum as Record<string, number>).all_time_paid_attributed) : null;
      return {
        note: "Deduped sales ledger annotated with canonical per-sale ad attribution. attribution_status: machine_attributed (HARD key: link_dm ManyChat/DM thread, or link_booking booking record), name_matched (deterministic prospect-name match, AT RISK, not a hard key), unresolved (no ad keyword). Close counts match the dashboard (same dedupe). Totals reconcile to the canonical figure below.",
        counts: { wins: rows.length, machine_attributed: byStatus.machine_attributed?.sales || 0, name_matched: byStatus.name_matched?.sales || 0, unresolved: byStatus.unresolved?.sales || 0 },
        reconciliation: {
          itemized_attributed_cash: itemizedAttributedCash,
          hard_key_linked_cash: hardKeyCash,
          name_matched_cash: nameMatchedCash,
          canonical_all_time_paid_attributed: canonicalAllTimePaid,
          manual_resolution_remainder: canonicalAllTimePaid != null ? canonicalAllTimePaid - itemizedAttributedCash : null,
          computed_at: sum ? (sum as Record<string, unknown>).computed_at : null,
          note: "canonical_all_time_paid_attributed is the Dashboard's own reconciled attributed total (attribution_summary) and is authoritative. itemized_attributed_cash is the per-sale sum here; manual_resolution_remainder is cash attributed via manual Attribution Workspace verdicts that are not itemized per sale. name_matched_cash is counted in itemized but is NOT a hard key.",
        },
        sales: rows,
      };
    }
    case "freshness":
      return dataFreshness(sb);
    case "business_snapshot":
      return businessSnapshot();
    case "get_ad_full":
      return getAdFull(client, a.keyword as string, a.since as string | undefined);
    case "get_call_transcripts":
      return getCallTranscripts(client, a.id as string | undefined, a.since as string | undefined, a.limit as number | undefined);
    case "get_organic_content":
      return getOrganicContent(client, { id: a.id as string | undefined, since: a.since as string | undefined, until: a.until as string | undefined, band: a.band as string | undefined, limit: a.limit as number | undefined, include_grades: a.include_grades === true });
    case "describe_schema":
      return SCHEMA_DOC;
    default:
      throw new Error("unknown tool: " + name);
  }
}

// Attach the standard response envelope (data_freshness + coverage) to business-data tools.
// describe_schema and factory tools are excluded (static / drafts). coverage needs a single
// creator in scope; multi-creator tools (business_snapshot) embed coverage per creator instead.
async function withEnvelope(name: string, args: Record<string, unknown>, result: unknown): Promise<unknown> {
  if (!ENVELOPE_TOOLS.has(name) || result === null || typeof result !== "object") return result;
  const sb = getServiceSupabase();
  const client = args.client as string | undefined;
  const envelope: Record<string, unknown> = { data_freshness: await dataFreshness(sb) };
  if (client && SERVED.includes(client)) envelope.coverage = await coverageFor(sb, client);
  return { ...(result as Record<string, unknown>), ...envelope };
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }, origin: string) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    // Echo the client's requested protocol version (it knows what it supports); fall back to a recent one.
    const pv = (params?.protocolVersion as string) || "2025-06-18";
    return { jsonrpc: "2.0", id, result: { protocolVersion: pv, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "utari-ccos-foundation", version: "2.2.0" } } };
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    try {
      const toolName = (params?.name as string) || "";
      const toolArgs = (params?.arguments as Record<string, unknown>) || {};
      const raw = await callTool(toolName, toolArgs, origin);
      const result = await withEnvelope(toolName, toolArgs, raw);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
    } catch (e) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : "failed" }) }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } };
}

// MCP clients connect cross-origin (a hosted agent builder like Utari) and follow the Streamable HTTP
// transport: they may run in a browser (so CORS + an OPTIONS preflight are required) and they advertise
// Accept: application/json, text/event-stream (so a compliant server must be able to reply as SSE, not
// only JSON). Missing either of these is why a client sees "no tools found" even with the right token.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function wantsSse(req: NextRequest): boolean {
  return (req.headers.get("accept") || "").includes("text/event-stream");
}

// Frame one or more JSON-RPC messages as a Streamable-HTTP SSE response (event name "message", per spec).
function sse(payload: unknown): NextResponse {
  const arr = Array.isArray(payload) ? payload : [payload];
  const body = arr.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join("");
  return new NextResponse(body, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }, { status: 401, headers: CORS });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400, headers: CORS });
  const origin = req.nextUrl.origin;
  const useSse = wantsSse(req);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, origin)))).filter(Boolean);
    if (!out.length) return new NextResponse(null, { status: 202, headers: CORS });
    return useSse ? sse(out) : NextResponse.json(out, { headers: CORS });
  }
  const res = await handle(body, origin);
  if (res === null) return new NextResponse(null, { status: 202, headers: CORS }); // notification, no reply
  return useSse ? sse(res) : NextResponse.json(res, { headers: CORS });
}

export async function GET(req: NextRequest) {
  // A GET with Accept: text/event-stream is a client trying to open a server->client stream. We don't
  // push server-initiated messages, so return 405 (per the Streamable HTTP spec) telling it to use POST.
  if (wantsSse(req)) return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
  return NextResponse.json(
    { server: "utari-ccos-foundation", transport: "streamable-http", auth: "Bearer token required", tools: TOOLS.map((t) => t.name) },
    { headers: CORS },
  );
}
