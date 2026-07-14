// Remote HTTP MCP server for UTARI (Alex's hosted AI agent). Speaks MCP over JSON-RPC 2.0
// on POST, bearer-token gated, read-only, exposing the accurate CCOS Foundation layers.
// Deploys with the app at https://<domain>/api/mcp/utari. Auth: Authorization: Bearer $UTARI_MCP_TOKEN.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = process.env.UTARI_MCP_TOKEN;
const DM_CLIENT: Record<string, string> = { tyson: "tyson_sonnek", antwan: "antwan_rarcus" };

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
  { name: "get_sales_with_ad", description: "The wins ledger, each resolved to the ad it came from where deterministically possible (ad_keyword null when unresolved, never guessed).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] } }, required: ["client"] } },
  { name: "freshness", description: "Minutes since each data source last synced.", inputSchema: { type: "object", properties: {} } },
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

async function callTool(name: string, a: Record<string, unknown>): Promise<unknown> {
  const sb = getServiceSupabase();
  const client = a.client as string;
  switch (name) {
    case "list_ads": {
      const { data } = await sb.from("ad_state").select("*").eq("client_key", client).order("spend", { ascending: false });
      return { note: "roas = collected cash / meta spend, all-time per ad.", ads: data };
    }
    case "get_ad": {
      const kw = (a.keyword as string).toLowerCase();
      const { data } = await sb.from("ad_state").select("*").eq("client_key", client).eq("keyword", kw);
      const dms = await dmsForAd(client, kw, (a.dm_limit as number) || 5);
      return { ad: data?.[0] || null, sample_dms: dms };
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
      const { data } = await sb.from("sales_tracker_rows").select("date,prospect_name,collected_revenue_cents,closer,setter,objection,call_notes,program_length").ilike("offer", `%${client}%`).order("date");
      let rows = (data || []).map((s: Record<string, unknown>) => ({ date: s.date, name: s.prospect_name, collected: Math.round(((s.collected_revenue_cents as number) || 0) / 100), closer: s.closer, setter: s.setter, objection: s.objection, program: s.program_length, notes: s.call_notes }));
      if (a.wins_only !== false) rows = rows.filter((r) => r.collected > 0);
      return { sales: rows };
    }
    case "get_sales_with_ad": {
      const { data } = await sb.from("sale_attribution").select("*").ilike("offer", `%${client}%`).order("date");
      return { note: "ad_keyword null = not deterministically resolvable to an ad (never guessed).", sales: data };
    }
    case "freshness": {
      const { data } = await sb.from("feed_watermarks").select("source,last_run_at");
      const now = Date.now();
      return { sources: (data || []).map((w: { source: string; last_run_at?: string }) => ({ source: w.source, minutes_since_sync: w.last_run_at ? Math.round((now - new Date(w.last_run_at).getTime()) / 60000) : null })) };
    }
    default:
      throw new Error("unknown tool: " + name);
  }
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }) {
  const { id, method, params } = msg;
  if (method === "initialize")
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "utari-ccos-foundation", version: "1.0.0" } } };
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    try {
      const result = await callTool((params?.name as string) || "", (params?.arguments as Record<string, unknown>) || {});
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
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return NextResponse.json(out);
  }
  const res = await handle(body);
  if (res === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(res);
}

export async function GET() {
  return NextResponse.json({ server: "utari-ccos-foundation", transport: "http-jsonrpc", auth: "Bearer token required", tools: TOOLS.map((t) => t.name) });
}
