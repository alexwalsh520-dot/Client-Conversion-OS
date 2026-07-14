// UTARI MCP server — read-only bridge from the CCOS Foundation to an external AI agent.
// Exposes ONLY the accurate, reconciled layers: ad_state (per-ad status/spend/closes/ROAS/creative),
// dm_ad_links + dm_conversation_messages (DMs tied to their ad), the sales ledger, and freshness.
// It deliberately does NOT expose a per-person DM->sale join, because that is not accurate yet
// (the id systems don't share a key — see README). Money numbers are the reconciled per-ad figures
// from ad_state; deep canonical ROAS lives in the CCOS Deep Dive, not re-derived here.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DM_CLIENT = { tyson: "tyson_sonnek", antwan: "antwan_rarcus" };
const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const err = (m) => ({ content: [{ type: "text", text: JSON.stringify({ error: m }) }], isError: true });

const TOOLS = [
  { name: "list_ads", description: "Complete per-ad state for a creator: on/off status, spend, last-7-day spend, leads, closes, cash, ROAS (collected cash / meta spend), and the on-image copy. One row per ad keyword. This is the trustworthy per-ad money+status read.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] } }, required: ["client"] } },
  { name: "get_ad", description: "One ad's full state plus a sample of the DM conversations it started (via the DM-to-ad bridge).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string", description: "the ad keyword, e.g. fit" }, dm_limit: { type: "number", default: 5 } }, required: ["client", "keyword"] } },
  { name: "get_dms_for_ad", description: "Every DM conversation tied to a given ad, with the full message thread. Accurate (first inbound message equals the ad keyword).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string" }, limit: { type: "number", default: 20 } }, required: ["client", "keyword"] } },
  { name: "list_sales", description: "The sales ledger for a creator: date, prospect, collected, closer, setter, objection, and call notes.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, wins_only: { type: "boolean", default: true } }, required: ["client"] } },
  { name: "get_ad_day", description: "Per-day metrics for ads: spend, impressions, clicks, CPM, status, one row per ad per day. The granular history behind list_ads.",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] }, keyword: { type: "string", description: "optional: one ad keyword" }, since: { type: "string", description: "optional ISO date lower bound, e.g. 2026-07-01" } }, required: ["client"] } },
  { name: "get_sales_with_ad", description: "The sales ledger with each win resolved to the ad it came from where determinable (sale -> ManyChat -> contact -> first ad keyword). ad_keyword is null when it could not be resolved deterministically (never guessed).",
    inputSchema: { type: "object", properties: { client: { type: "string", enum: ["tyson", "antwan"] } }, required: ["client"] } },
  { name: "freshness", description: "How current each data source is (minutes since last sync), so the agent never acts on stale data.",
    inputSchema: { type: "object", properties: {} } },
];

async function listAds(client) {
  const { data, error } = await sb.from("ad_state").select("keyword,status,active_ads,total_ads,spend,spend_7d,leads,closes,cash,roas,last_status_day,on_image_text").eq("client_key", client).order("spend", { ascending: false });
  if (error) return err(error.message);
  return ok({ note: "roas = collected cash / meta spend, all-time per ad. status ACTIVE if any of its ads is live.", ads: data });
}
async function dmsForAd(client, keyword, limit) {
  const dmClient = DM_CLIENT[client];
  const { data: links } = await sb.from("dm_ad_links").select("ig_subscriber_id").eq("client_key", client).eq("keyword_normalized", keyword.toLowerCase()).limit(limit);
  const out = [];
  for (const l of links || []) {
    const { data: msgs } = await sb.from("dm_conversation_messages").select("direction,body,sent_at").eq("client", dmClient).eq("subscriber_id", l.ig_subscriber_id).order("sent_at").limit(60);
    out.push({ subscriber: l.ig_subscriber_id, messages: (msgs || []).map((m) => ({ who: (m.direction || "").toLowerCase().startsWith("in") ? "lead" : "creator", text: m.body, at: m.sent_at })) });
  }
  return out;
}

const server = new Server({ name: "utari-ccos-foundation", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = req.params.arguments || {};
  try {
    switch (req.params.name) {
      case "list_ads": return await listAds(a.client);
      case "get_ad": {
        const { data } = await sb.from("ad_state").select("*").eq("client_key", a.client).eq("keyword", a.keyword.toLowerCase());
        const dms = await dmsForAd(a.client, a.keyword, a.dm_limit || 5);
        return ok({ ad: data?.[0] || null, sample_dms: dms });
      }
      case "get_dms_for_ad": return ok({ keyword: a.keyword, conversations: await dmsForAd(a.client, a.keyword, a.limit || 20) });
      case "list_sales": {
        let q = sb.from("sales_tracker_rows").select("date,prospect_name,collected_revenue_cents,closer,setter,objection,call_notes,program_length").ilike("offer", `%${a.client}%`).order("date");
        const { data, error } = await q;
        if (error) return err(error.message);
        let rows = (data || []).map((s) => ({ date: s.date, name: s.prospect_name, collected: Math.round((s.collected_revenue_cents || 0) / 100), closer: s.closer, setter: s.setter, objection: s.objection, program: s.program_length, notes: s.call_notes }));
        if (a.wins_only !== false) rows = rows.filter((r) => r.collected > 0);
        return ok({ sales: rows });
      }
      case "get_ad_day": {
        let q = sb.from("ad_day").select("*").eq("client_key", a.client).order("date", { ascending: false });
        if (a.keyword) q = q.eq("keyword", a.keyword.toLowerCase());
        if (a.since) q = q.gte("date", a.since);
        const { data, error } = await q.limit(2000);
        if (error) return err(error.message);
        return ok({ note: "one row per ad per day", days: data });
      }
      case "get_sales_with_ad": {
        const { data, error } = await sb.from("sale_attribution").select("*").ilike("offer", `%${a.client}%`).order("date");
        if (error) return err(error.message);
        return ok({ note: "ad_keyword is null when the sale couldn't be resolved to an ad deterministically (never guessed). Most wins lack a ManyChat id in the tracker, so resolution is partial.", sales: data });
      }
      case "freshness": {
        const { data } = await sb.from("feed_watermarks").select("source,last_run_at,rows_last_run");
        const now = Date.now();
        return ok({ sources: (data || []).map((w) => ({ source: w.source, minutes_since_sync: w.last_run_at ? Math.round((now - new Date(w.last_run_at).getTime()) / 60000) : null })) });
      }
      default: return err("unknown tool: " + req.params.name);
    }
  } catch (e) { return err(e.message); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("UTARI MCP server running (stdio). Read-only Foundation bridge.");
