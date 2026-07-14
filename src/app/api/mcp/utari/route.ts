// Remote HTTP MCP server for UTARI (Alex's hosted AI agent). Speaks MCP over JSON-RPC 2.0
// on POST, bearer-token gated, read-only, exposing the accurate CCOS Foundation layers.
// Deploys with the app at https://<domain>/api/mcp/utari. Auth: Authorization: Bearer $UTARI_MCP_TOKEN.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { readLatestAdSnapshot } from "@/lib/ads-tracker/snapshot";
import type { AdsTrackerAccount } from "@/lib/ads-tracker/server";
import {
  DM_CLIENT,
  dataFreshness,
  coverageFor,
  businessSnapshot,
  getAdFull,
  getCallTranscripts,
  getOrganicContent,
  SCHEMA_DOC,
} from "@/lib/utari/foundation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TOKEN = process.env.UTARI_MCP_TOKEN;

// Tools that get the standard response envelope (data_freshness + coverage). Excludes the
// static describe_schema and the factory proxy tools (drafts, not business reads).
const ENVELOPE_TOOLS = new Set([
  "list_ads", "get_ad", "get_dms_for_ad", "get_ad_day", "list_sales", "get_sales_with_ad",
  "freshness", "business_snapshot", "get_ad_full", "get_call_transcripts", "get_organic_content",
]);

// The CANONICAL per-ad funnel — the exact numbers on the Ads Dashboard. We read the freshest stored
// AD-LEVEL snapshot (computed by getAdsTrackerDashboard, kept warm by the snapshot cron) instead of
// re-deriving anything, so DMs/booked/shown/closes/collected/ROAS are the reconciled dashboard figures.
// Snapshot-only on purpose: the live recompute of a wide window blows the DB statement timeout, and the
// dashboard itself is fast for the same reason (it serves these bounded snapshots). We merge in the
// live ad_state extras (status/CPM/impressions/targeting/on-image copy) by keyword.
async function canonicalAds(client: string) {
  const sb = getServiceSupabase();
  const snap = await readLatestAdSnapshot(client as AdsTrackerAccount);
  const adRoas = (snap?.payload?.adRoas as Record<string, unknown>[] | undefined) || [];
  const { data: state } = await sb.from("ad_state").select("keyword,status,impressions,cpm,last_status_day,audience_type,is_advantage,age_min,age_max,has_lookalike,on_image_text").eq("client_key", client);
  const byKw: Record<string, Record<string, unknown>> = {};
  for (const s of state || []) byKw[String((s as { keyword: string }).keyword)] = s;
  const ads = adRoas.map((r) => {
    const st = byKw[String(r.label).toLowerCase()] || {};
    const booked = (r.bookedCalls as number) || 0;
    const calls = (r.callsTaken as number) || 0;
    return {
      keyword: r.label, status: st.status ?? null,
      spend: r.adSpend, dms: r.messages, booked_calls: r.bookedCalls, calls_taken: r.callsTaken,
      show_rate: booked > 0 ? Math.round(((calls / booked) as number) * 1000) / 1000 : null,
      closes: r.newClients, close_rate: calls > 0 ? Math.round(((((r.newClients as number) || 0) / calls) as number) * 1000) / 1000 : null,
      cash_collected: r.collectedRevenue, gross_profit: r.grossProfit,
      roas: r.collectedRoi, gross_profit_roas: r.grossProfitRoi,
      cost_per_dm: r.costPerMessage, cost_per_booked_call: r.costPerBookedCall,
      impressions: st.impressions ?? null, cpm: st.cpm ?? null, last_status_day: st.last_status_day ?? null,
      audience_type: st.audience_type ?? null, is_advantage: st.is_advantage ?? null,
      age: st.age_min ? `${st.age_min}-${st.age_max}` : null, on_image_text: st.on_image_text ?? null,
    };
  });
  return { ads, window: snap ? { dateFrom: snap.dateFrom, dateTo: snap.dateTo, computedAt: snap.computedAt } : null };
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
  return h === `Bearer ${TOKEN}`;
}

const TOOLS = [
  { name: "list_ads", description: "Complete per-ad state for a creator: status, spend, 7-day spend, impressions, clicks, CPM, DMs, leads, closes, cash, ROAS, targeting (audience type, Advantage on/off, age, lookalike), and on-image copy. One row per ad. The trustworthy per-ad read.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] } }, required: ["client"] } },
  { name: "get_ad", description: "One ad's full state plus a sample of the DM conversations it started.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string" }, dm_limit: { type: "number" } }, required: ["client", "keyword"] } },
  { name: "get_dms_for_ad", description: "Every DM conversation tied to a given ad, full thread.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string" }, limit: { type: "number" } }, required: ["client", "keyword"] } },
  { name: "get_ad_day", description: "Per-day metrics for ads: spend, impressions, clicks, CPM, status. One row per ad per day.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string" }, since: { type: "string" } }, required: ["client"] } },
  { name: "list_sales", description: "The sales ledger: date, prospect, collected, closer, setter, objection, call notes.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, wins_only: { type: "boolean" } }, required: ["client"] } },
  { name: "get_sales_with_ad", description: "Every attributed sale tied to its ad keyword (the Ads Dashboard's own canonical per-sale attribution), each labeled with the method used (link_dm = tied to a real DM thread; name = name-matched). Returns `coverage` (the reconciled paid/organic/unattributed revenue split) + `facts_summary` (counts, DM-linked count). Optional `since` (ISO date) filters the sales list.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, since: { type: "string" } }, required: ["client"] } },
  { name: "freshness", description: "Minutes since each data source last synced.", inputSchema: { type: "object", properties: {} } },
  { name: "business_snapshot", description: "Per creator (Tyson, Antwan) + combined: current-week and prior-week canonical funnel (spend, dms, cost_per_dm, booked_calls, cost_per_booked_call, calls_taken, show_rate, closes, close_rate, cash_collected, roas), top 3 and bottom 3 funded ads, and the count of funded zero-DM ads. Sourced from the Ads Dashboard snapshot; matches the Ads tab to the dollar for the same stored window.",
    inputSchema: { type: "object", properties: {} } },
  { name: "get_ad_full", description: "Everything about ONE ad in a single call: canonical funnel row, placement lineage (every ad_id/campaign/adset/spend/status), on-image + primary copy, per-day spend/DM series, and thread digests (subscriber, first DM, message count, became_sale, 2-line excerpt). Full verbatim threads: use get_dms_for_ad.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string" }, since: { type: "string", description: "ISO date; filters the per-day series + thread digests (default = snapshot window start)" } }, required: ["client", "keyword"] } },
  { name: "get_call_transcripts", description: "Fathom call transcripts. List mode (no id) = summaries + fathom ids for a creator; single-id mode = the full transcript. Calls carry no hard key to an ad or DM thread, so linkage_status is always 'unlinked' (correlate on prospect_name only, non-authoritative).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, id: { type: "string", description: "fathom_id for the full transcript" }, since: { type: "string" }, limit: { type: "number" } }, required: ["client"] } },
  { name: "get_organic_content", description: "Organic Instagram posts for a creator with their buyer-fit grade. List mode = date, type, caption excerpt, engagement, permalink, grade (score/band/top miss). Single-post mode (pass id = ig_media_id) = full caption + transcript + full grade. Optional band filter.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, id: { type: "string" }, since: { type: "string" }, until: { type: "string" }, band: { type: "string", description: "grade band filter, e.g. off/weak/strong" }, limit: { type: "number" } }, required: ["client"] } },
  { name: "describe_schema", description: "Static, versioned documentation of every tool, field semantics, the three attribution_status meanings, the DM-count definition, and the known accuracy ceilings. No DB call. Read this first to understand what every number means.",
    inputSchema: { type: "object", properties: {} } },
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

async function dmsForAd(client: string, keyword: string, limit: number) {
  const sb = getServiceSupabase();
  const dmClient = DM_CLIENT[client];
  const { data: links } = await sb.from("dm_ad_links").select("ig_subscriber_id").eq("client_key", client).eq("keyword_normalized", keyword.toLowerCase()).limit(limit);
  const out: unknown[] = [];
  for (const l of links || []) {
    const { data: msgs } = await sb.from("dm_conversation_messages").select("direction,body,sent_at").eq("client", dmClient).eq("subscriber_id", (l as { ig_subscriber_id: string }).ig_subscriber_id).order("sent_at").limit(60);
    out.push({ subscriber: (l as { ig_subscriber_id: string }).ig_subscriber_id, messages: (msgs || []).map((m: { direction?: string; body?: string; sent_at?: string }) => ({ who: (m.direction || "").toLowerCase().startsWith("in") ? "lead" : "creator", text: m.body, at: m.sent_at })) });
  }
  return out;
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
    case "list_ads": {
      const { ads, window } = await canonicalAds(client);
      ads.sort((x, y) => ((y.spend as number) || 0) - ((x.spend as number) || 0));
      return { note: "CANONICAL Ads Dashboard attribution per ad (v2 field names): spend, dms, booked_calls, calls_taken, closes, cash_collected, roas, funnel ad->DM->booked->taken->closed. The exact reconciled dashboard numbers. Merged with live status/CPM/impressions/targeting/copy. `window` is the period these funnel numbers cover; spend uses the ad account's day (Pacific).", window, ads };
    }
    case "get_ad": {
      const kw = (a.keyword as string).toLowerCase();
      const { ads, window } = await canonicalAds(client);
      const dms = await dmsForAd(client, kw, (a.dm_limit as number) || 5);
      return { ad: ads.find((x) => String(x.keyword).toLowerCase() === kw) || null, window, sample_dms: dms };
    }
    case "get_dms_for_ad":
      return { keyword: a.keyword, conversations: await dmsForAd(client, a.keyword as string, (a.limit as number) || 20) };
    case "get_ad_day": {
      let q = sb.from("ad_day").select("*").eq("client_key", client).order("date", { ascending: false });
      if (a.keyword) q = q.eq("keyword", (a.keyword as string).toLowerCase());
      if (a.since) q = q.gte("date", a.since as string);
      const { data } = await q.limit(2000);
      return { note: "one row per ad per day", days: data };
    }
    case "list_sales": {
      const { data } = await sb.from("sales_tracker_rows").select("date,prospect_name,prospect_name_normalized,collected_revenue_cents,closer,setter,objection,call_notes,program_length").ilike("offer", `%${client}%`).order("date");
      // Stamp attribution_status per sale from the canonical facts (hard/deterministic links only).
      // A sale present in sale_attribution_facts = machine_attributed (with its ad_keyword + method);
      // absent = unresolved. resolved_organic is aggregate-only (see describe_schema).
      const { data: facts } = await sb.from("sale_attribution_facts").select("occurred_day,prospect_name,keyword_normalized,method").eq("client_key", client);
      const factByKey: Record<string, { keyword: string; method: string }> = {};
      for (const f of (facts as Record<string, unknown>[]) || []) {
        const key = `${String(f.prospect_name || "").toLowerCase().trim()}|${String(f.occurred_day || "").slice(0, 10)}`;
        factByKey[key] = { keyword: String(f.keyword_normalized || ""), method: String(f.method || "") };
      }
      let rows = (data || []).map((s: Record<string, unknown>) => {
        const norm = String(s.prospect_name_normalized || s.prospect_name || "").toLowerCase().trim();
        const hit = factByKey[`${norm}|${String(s.date || "").slice(0, 10)}`];
        return {
          date: s.date, name: s.prospect_name, cash_collected: Math.round(((s.collected_revenue_cents as number) || 0) / 100),
          closer: s.closer, setter: s.setter, objection: s.objection, program: s.program_length, notes: s.call_notes,
          attribution_status: hit ? "machine_attributed" : "unresolved",
          ad_keyword: hit ? hit.keyword : null,
          attribution_method: hit ? hit.method : null,
        };
      });
      if (a.wins_only !== false) rows = rows.filter((r) => r.cash_collected > 0);
      return { note: "Sales ledger (v2). Each sale carries attribution_status: machine_attributed (linked in sale_attribution_facts) or unresolved (no ad keyword). resolved_organic is aggregate-only; see coverage + describe_schema.", sales: rows };
    }
    case "get_sales_with_ad": {
      // Canonical per-sale attribution: the exact sale->ad-keyword links the Ads Dashboard computes
      // (via getAdsTrackerDashboard's onSaleFact sink), persisted to sale_attribution_facts. method
      // tells HOW each was tied: link_dm = deterministic ManyChat/DM keyword match (an actual DM
      // thread), name = matched by prospect name, link_booking = via the booking record.
      let fq = sb.from("sale_attribution_facts")
        .select("occurred_day,prospect_name,keyword_normalized,method,collected_cents,subscriber_id")
        .eq("client_key", client).order("occurred_day", { ascending: false });
      if (a.since) fq = fq.gte("occurred_day", a.since as string);
      const { data: facts } = await fq.limit(5000);
      const rows = (facts || []).map((f: Record<string, unknown>) => ({
        date: f.occurred_day, name: f.prospect_name, ad_keyword: f.keyword_normalized,
        attribution_status: "machine_attributed" as const,
        method: (f.method as string) || "unknown", dm_linked: f.method === "link_dm",
        cash_collected: Math.round(((f.collected_cents as number) || 0) / 100),
        subscriber_id: f.subscriber_id,
      }));
      const attributedCollected = rows.reduce((s, r) => s + r.cash_collected, 0);
      const byMethod: Record<string, { sales: number; cash_collected: number }> = {};
      for (const r of rows) { const m = r.method || "unknown"; byMethod[m] = byMethod[m] || { sales: 0, cash_collected: 0 }; byMethod[m].sales++; byMethod[m].cash_collected += r.cash_collected; }
      return {
        note: "CANONICAL sale->ad attribution (v2): the Dashboard's own per-sale links. Every row is attribution_status machine_attributed; method tells HOW - link_dm = real DM thread via a ManyChat keyword (hard key); link_booking = booking record (hard key); name = deterministic prospect-name match. `sales` lists every attributed sale. Reconciled revenue split is in the response `coverage` block. Sales with no ad keyword are unresolved - see list_sales.",
        facts_summary: { attributed_sales: rows.length, dm_linked: rows.filter((r) => r.dm_linked).length, attributed_cash_collected: attributedCollected, by_method: byMethod },
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
      return getOrganicContent(client, { id: a.id as string | undefined, since: a.since as string | undefined, until: a.until as string | undefined, band: a.band as string | undefined, limit: a.limit as number | undefined });
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
  if (client === "tyson" || client === "antwan") envelope.coverage = await coverageFor(sb, client);
  return { ...(result as Record<string, unknown>), ...envelope };
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }, origin: string) {
  const { id, method, params } = msg;
  if (method === "initialize")
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "utari-ccos-foundation", version: "2.0.0" } } };
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

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  const origin = req.nextUrl.origin;
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, origin)))).filter(Boolean);
    return NextResponse.json(out);
  }
  const res = await handle(body, origin);
  if (res === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(res);
}

export async function GET() {
  return NextResponse.json({ server: "utari-ccos-foundation", transport: "http-jsonrpc", auth: "Bearer token required", tools: TOOLS.map((t) => t.name) });
}
