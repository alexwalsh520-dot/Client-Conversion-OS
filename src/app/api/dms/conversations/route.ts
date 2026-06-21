import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// DMs tab — read-only inbox of AD-KEYWORD-LINKED conversations.
//
// SCOPE (revised 2026-06-21): show ONLY leads that fired an ad keyword, and show
// EVERY one of them (no silent drops). We therefore ANCHOR the list on
// `ads_keyword_events` — each row is a keyword fire, and that table is the reliable
// complete set of ad-attributable leads. We dedupe to the LATEST fire per subscriber,
// then LEFT-JOIN the DM conversation thread. A keyword-fired lead with no captured
// conversation still appears (header + status pills), it just has an empty thread.
//
// Bridge chain (ids live in different namespaces, so the bridge is required):
//   ads_keyword_events.subscriber_id  (ManyChat id)
//     → instagram_lead_links.manychat_subscriber_id ↔ .instagram_user_id
//       → dm_conversation_messages.subscriber_id  (IG numeric id, conversation_id "instagram:<id>")
//   ads_keyword_events.keyword_normalized
//     → ads_meta_insights_daily (campaign / adset / ad names + effective status)
//
// Status:
//   Booked = ads_keyword_events.appointment_id populated (cross-checked vs ghl_appointments)
//   Closed = sales_tracker_rows.collected_revenue_cents > 0 (join via manychat_subscriber_id)
//   Stage  = dm_conversation_stage_state (booking_readiness_score etc), LEFT join.
//
// Filter OPTIONS (campaign / keyword / ad / adset) come from ads_meta_insights_daily
// for the SELECTED client (short key like "antwan"/"tyson"), NOT from the thread set —
// so they populate even before any conversation loads. Campaigns carry their
// effective status so the UI can group Active vs Off.
// ---------------------------------------------------------------------------

// dm_conversation_messages.client uses the long form (tyson_sonnek), while
// ads_keyword_events / ads_meta_insights_daily use the short form (tyson).
const CLIENT_LONG_TO_SHORT: Record<string, string> = {
  tyson_sonnek: "tyson",
  antwan_rarcus: "antwan",
  keith_holland: "keith",
  lucy_hubbard: "lucy",
};

function shortClient(longOrShort: string | null | undefined): string | null {
  if (!longOrShort) return null;
  return CLIENT_LONG_TO_SHORT[longOrShort] || longOrShort;
}

// Hard cap on assembled leads per request.
const MAX_LEADS = 4000;

interface KeywordEvent {
  subscriber_id: string;
  subscriber_name: string | null;
  contact_name: string | null;
  keyword_normalized: string | null;
  client_key: string | null;
  appointment_id: string | null;
  event_at: string;
}

interface LeadLink {
  instagram_user_id: string | null;
  manychat_subscriber_id: string | null;
  instagram_handle: string | null;
  lead_name: string | null;
  client: string | null;
}

interface MessageRow {
  conversation_id: string;
  subscriber_id: string;
  direction: string | null;
  body: string | null;
  sent_at: string;
  setter_name: string | null;
  client: string | null;
  message_type: string | null;
}

interface InsightLabel {
  keyword_normalized: string;
  client_key: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_effective_status: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
}

interface StageRow {
  conversation_id: string;
  booking_readiness_score: number | null;
  qualified: boolean | null;
  goal_clear: boolean | null;
  gap_clear: boolean | null;
  stakes_clear: boolean | null;
}

interface ThreadMessage {
  direction: string;
  body: string;
  sentAt: string;
  type: string | null;
}

interface Stage {
  score: number | null;
  qualified: boolean;
  goalClear: boolean;
  gapClear: boolean;
  stakesClear: boolean;
  label: string;
}

interface Thread {
  conversationId: string; // the keyword-event subscriber_id (stable per lead)
  client: string | null;
  leadName: string | null;
  handle: string | null;
  keyword: string | null;
  campaignName: string | null;
  campaignId: string | null;
  campaignStatus: string | null;
  adsetName: string | null;
  adsetId: string | null;
  adName: string | null;
  adId: string | null;
  setterName: string | null;
  lastMessage: string;
  lastDirection: string;
  lastAt: string; // latest of conversation message / keyword fire
  messageCount: number;
  hasConversation: boolean;
  booked: boolean;
  closed: boolean;
  collectedCents: number;
  stage: Stage | null;
  messages: ThreadMessage[];
}

function previewBody(type: string | null, body: string | null): string {
  const t = (type || "").toLowerCase();
  if (body && body.trim() && !body.startsWith("[")) return body.trim();
  if (t.includes("reel")) return "Sent a reel";
  if (t.includes("image") || t.includes("photo")) return "Sent a photo";
  if (t.includes("video")) return "Sent a video";
  if (t.includes("audio")) return "Sent a voice note";
  if (t.includes("story")) return "Story reply";
  if (t.includes("share")) return "Shared a post";
  if (body && body.trim()) return body.trim();
  return "Attachment";
}

function cleanName(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t.includes("{{")) return null;
  return t;
}

function stageLabel(score: number | null, qualified: boolean): string {
  if (qualified) return "Qualified";
  if (score == null) return "";
  if (score >= 70) return "Hot lead";
  if (score >= 40) return "Warm";
  if (score >= 15) return "In contact";
  return "New";
}

export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const params = req.nextUrl.searchParams;

    const clientFilter = shortClient(params.get("client")); // short form or null = all
    const campaignId = params.get("campaign") || "";
    const keywordFilter = (params.get("keyword") || "").toLowerCase();
    const adsetId = params.get("adset") || "";
    const adId = params.get("ad") || "";
    const dateFrom = params.get("dateFrom"); // YYYY-MM-DD
    const dateTo = params.get("dateTo");
    const search = (params.get("search") || "").trim().toLowerCase();
    const sort = params.get("sort") || "recent"; // recent | booked | closed
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const pageSize = Math.min(80, Math.max(10, parseInt(params.get("pageSize") || "40", 10)));

    // --------------------------------------------------------------------
    // 0) Filter OPTIONS from ads_meta_insights_daily for the selected client.
    //    Loaded independently of the thread set so they always populate.
    // --------------------------------------------------------------------
    const campaignMap = new Map<string, { label: string; status: string }>();
    const keywordSet = new Set<string>();
    const adsetMap = new Map<string, string>();
    const adMap = new Map<string, string>();
    {
      let q = sb
        .from("ads_meta_insights_daily")
        .select(
          "client_key, keyword_normalized, campaign_id, campaign_name, campaign_effective_status, adset_id, adset_name, ad_id, ad_name, date"
        )
        .order("date", { ascending: false })
        .limit(20000);
      if (clientFilter) q = q.eq("client_key", clientFilter);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of (data || []) as (InsightLabel & { date: string })[]) {
        if (r.campaign_id && r.campaign_name && !campaignMap.has(r.campaign_id)) {
          campaignMap.set(r.campaign_id, {
            label: r.campaign_name,
            status: (r.campaign_effective_status || "").toUpperCase(),
          });
        }
        if (r.keyword_normalized) keywordSet.add(r.keyword_normalized);
        if (r.adset_id && r.adset_name && !adsetMap.has(r.adset_id)) adsetMap.set(r.adset_id, r.adset_name);
        if (r.ad_id && r.ad_name && !adMap.has(r.ad_id)) adMap.set(r.ad_id, r.ad_name);
      }
    }

    // --------------------------------------------------------------------
    // 1) ANCHOR: ads_keyword_events → latest fire per subscriber.
    //    Filtered by client + date window. This is the complete lead set.
    // --------------------------------------------------------------------
    const latestByMc = new Map<string, KeywordEvent>();
    {
      const PAGE = 1000;
      let offset = 0;
      const SCAN_CEILING = 40000;
      for (;;) {
        let q = sb
          .from("ads_keyword_events")
          .select("subscriber_id, subscriber_name, contact_name, keyword_normalized, client_key, appointment_id, event_at")
          .order("event_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (clientFilter) q = q.eq("client_key", clientFilter);
        if (dateFrom) q = q.gte("event_at", `${dateFrom}T00:00:00`);
        if (dateTo) q = q.lte("event_at", `${dateTo}T23:59:59.999`);

        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []) as KeywordEvent[];
        for (const r of rows) {
          if (!r.subscriber_id) continue;
          // rows arrive newest-first → first time we see a subscriber = latest fire
          if (!latestByMc.has(r.subscriber_id)) latestByMc.set(r.subscriber_id, r);
        }
        offset += PAGE;
        if (rows.length < PAGE) break;
        if (offset >= SCAN_CEILING) break;
      }
    }

    const mcIds = Array.from(latestByMc.keys());
    const totalLeads = mcIds.length;

    if (mcIds.length === 0) {
      return NextResponse.json({
        threads: [],
        total: 0,
        totalLeads: 0,
        bookedLeads: 0,
        closedLeads: 0,
        page,
        pageSize,
        filters: {
          campaigns: Array.from(campaignMap, ([id, v]) => ({ id, label: v.label, status: v.status })),
          keywords: Array.from(keywordSet).sort(),
          adsets: Array.from(adsetMap, ([id, label]) => ({ id, label })),
          ads: Array.from(adMap, ([id, label]) => ({ id, label })),
        },
      });
    }

    // --------------------------------------------------------------------
    // 2) Bridge ManyChat subscriber → IG conversation via instagram_lead_links.
    // --------------------------------------------------------------------
    const linkByMc = new Map<string, LeadLink>();
    const igToMc = new Map<string, string>();
    for (let i = 0; i < mcIds.length; i += 300) {
      const chunk = mcIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("instagram_lead_links")
        .select("instagram_user_id, manychat_subscriber_id, instagram_handle, lead_name, client")
        .in("manychat_subscriber_id", chunk);
      if (error) throw error;
      for (const l of (data || []) as LeadLink[]) {
        if (l.manychat_subscriber_id) linkByMc.set(l.manychat_subscriber_id, l);
        if (l.instagram_user_id && l.manychat_subscriber_id)
          igToMc.set(l.instagram_user_id, l.manychat_subscriber_id);
      }
    }

    // --------------------------------------------------------------------
    // 3) Conversation messages for the bridged IG ids.
    // --------------------------------------------------------------------
    const igIds = Array.from(igToMc.keys());
    const msgsByMc = new Map<string, MessageRow[]>();
    for (let i = 0; i < igIds.length; i += 200) {
      const chunk = igIds.slice(i, i + 200);
      const { data, error } = await sb
        .from("dm_conversation_messages")
        .select("conversation_id, subscriber_id, direction, body, sent_at, setter_name, client, message_type")
        .in("subscriber_id", chunk)
        .order("sent_at", { ascending: true })
        .limit(40000);
      if (error) throw error;
      for (const m of (data || []) as MessageRow[]) {
        const mc = igToMc.get(m.subscriber_id);
        if (!mc) continue;
        if (!msgsByMc.has(mc)) msgsByMc.set(mc, []);
        msgsByMc.get(mc)!.push(m);
      }
    }

    // --------------------------------------------------------------------
    // 4) Insight labels (campaign/adset/ad) per keyword. Newest row per keyword+client.
    // --------------------------------------------------------------------
    const keywords = Array.from(
      new Set(Array.from(latestByMc.values()).map((e) => e.keyword_normalized).filter(Boolean) as string[])
    );
    const labelByKey = new Map<string, InsightLabel>();
    for (let i = 0; i < keywords.length; i += 200) {
      const chunk = keywords.slice(i, i + 200);
      const { data, error } = await sb
        .from("ads_meta_insights_daily")
        .select(
          "keyword_normalized, client_key, campaign_id, campaign_name, campaign_effective_status, adset_id, adset_name, ad_id, ad_name, date"
        )
        .in("keyword_normalized", chunk)
        .order("date", { ascending: false });
      if (error) throw error;
      for (const row of (data || []) as (InsightLabel & { date: string })[]) {
        const key = `${row.keyword_normalized}::${row.client_key || ""}`;
        if (!labelByKey.has(key)) labelByKey.set(key, row);
      }
    }
    function labelForEvent(e: KeywordEvent): InsightLabel | null {
      if (!e.keyword_normalized) return null;
      const exact = labelByKey.get(`${e.keyword_normalized}::${e.client_key || ""}`);
      if (exact) return exact;
      for (const [k, v] of labelByKey) if (k.startsWith(`${e.keyword_normalized}::`)) return v;
      return null;
    }

    // --------------------------------------------------------------------
    // 5) BOOKED — appointment_id on the event, cross-checked vs ghl_appointments.
    // --------------------------------------------------------------------
    const apptIds = Array.from(
      new Set(Array.from(latestByMc.values()).map((e) => e.appointment_id).filter(Boolean) as string[])
    );
    const ghlAppts = new Set<string>();
    for (let i = 0; i < apptIds.length; i += 300) {
      const chunk = apptIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("ghl_appointments")
        .select("appointment_id")
        .in("appointment_id", chunk);
      if (error) throw error;
      for (const r of (data || []) as { appointment_id: string }[]) ghlAppts.add(r.appointment_id);
    }

    // --------------------------------------------------------------------
    // 6) CLOSED — sales_tracker_rows via manychat_subscriber_id.
    // --------------------------------------------------------------------
    const collectedByMc = new Map<string, number>();
    for (let i = 0; i < mcIds.length; i += 300) {
      const chunk = mcIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("sales_tracker_rows")
        .select("manychat_subscriber_id, collected_revenue_cents")
        .in("manychat_subscriber_id", chunk);
      if (error) throw error;
      for (const r of (data || []) as { manychat_subscriber_id: string; collected_revenue_cents: number | null }[]) {
        const cents = Number(r.collected_revenue_cents || 0);
        if (cents > 0 && r.manychat_subscriber_id)
          collectedByMc.set(r.manychat_subscriber_id, (collectedByMc.get(r.manychat_subscriber_id) || 0) + cents);
      }
    }

    // --------------------------------------------------------------------
    // 7) Lead stage via conversation_id.
    // --------------------------------------------------------------------
    const convoIds = new Set<string>();
    for (const list of msgsByMc.values()) for (const m of list) if (m.conversation_id) convoIds.add(m.conversation_id);
    const convoIdArr = Array.from(convoIds);
    const stageByConvo = new Map<string, StageRow>();
    for (let i = 0; i < convoIdArr.length; i += 300) {
      const chunk = convoIdArr.slice(i, i + 300);
      const { data, error } = await sb
        .from("dm_conversation_stage_state")
        .select("conversation_id, booking_readiness_score, qualified, goal_clear, gap_clear, stakes_clear")
        .in("conversation_id", chunk);
      if (error) throw error;
      for (const r of (data || []) as StageRow[]) if (r.conversation_id) stageByConvo.set(r.conversation_id, r);
    }

    // --------------------------------------------------------------------
    // 8) Assemble one thread per keyword-fired lead.
    // --------------------------------------------------------------------
    let threads: Thread[] = [];
    for (const [mc, e] of latestByMc) {
      const link = linkByMc.get(mc);
      const msgs = msgsByMc.get(mc) || [];
      const label = labelForEvent(e);
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      const convoId = msgs.length ? msgs[0].conversation_id : null;
      const stageRow = convoId ? stageByConvo.get(convoId) : undefined;
      const stage: Stage | null = stageRow
        ? {
            score: stageRow.booking_readiness_score,
            qualified: !!stageRow.qualified,
            goalClear: !!stageRow.goal_clear,
            gapClear: !!stageRow.gap_clear,
            stakesClear: !!stageRow.stakes_clear,
            label: stageLabel(stageRow.booking_readiness_score, !!stageRow.qualified),
          }
        : null;

      const leadName =
        cleanName(link?.lead_name) || cleanName(e.subscriber_name) || cleanName(e.contact_name) || null;
      const handle = link?.instagram_handle || null;
      const setterName = msgs.find((m) => m.setter_name)?.setter_name || null;
      const booked = !!(e.appointment_id && ghlAppts.has(e.appointment_id));
      const collectedCents = collectedByMc.get(mc) || 0;

      const lastAt =
        last && last.sent_at && last.sent_at > e.event_at ? last.sent_at : e.event_at;

      threads.push({
        conversationId: mc,
        client: shortClient(e.client_key) || shortClient(link?.client) || null,
        leadName,
        handle,
        keyword: e.keyword_normalized || null,
        campaignName: label?.campaign_name || null,
        campaignId: label?.campaign_id || null,
        campaignStatus: (label?.campaign_effective_status || "").toUpperCase() || null,
        adsetName: label?.adset_name || null,
        adsetId: label?.adset_id || null,
        adName: label?.ad_name || null,
        adId: label?.ad_id || null,
        setterName,
        lastMessage: last ? previewBody(last.message_type, last.body) : "No captured conversation",
        lastDirection: last?.direction || "inbound",
        lastAt,
        messageCount: msgs.length,
        hasConversation: msgs.length > 0,
        booked,
        closed: collectedCents > 0,
        collectedCents,
        stage,
        messages: msgs.map((m) => ({
          direction: m.direction || "inbound",
          body: previewBody(m.message_type, m.body),
          sentAt: m.sent_at,
          type: m.message_type,
        })),
      });
    }

    const bookedLeads = threads.filter((t) => t.booked).length;
    const closedLeads = threads.filter((t) => t.closed).length;

    // --------------------------------------------------------------------
    // 9) Optional narrow filters (campaign/keyword/ad/adset/search).
    // --------------------------------------------------------------------
    if (campaignId) threads = threads.filter((t) => t.campaignId === campaignId);
    if (adsetId) threads = threads.filter((t) => t.adsetId === adsetId);
    if (adId) threads = threads.filter((t) => t.adId === adId);
    if (keywordFilter) threads = threads.filter((t) => (t.keyword || "").toLowerCase() === keywordFilter);
    if (search) {
      threads = threads.filter((t) => {
        if ((t.leadName || "").toLowerCase().includes(search)) return true;
        if ((t.handle || "").toLowerCase().includes(search)) return true;
        if ((t.keyword || "").toLowerCase().includes(search)) return true;
        if ((t.campaignName || "").toLowerCase().includes(search)) return true;
        return t.messages.some((m) => m.body.toLowerCase().includes(search));
      });
    }

    // --------------------------------------------------------------------
    // 10) Sort. Booked / Closed bubble matching leads to top, then recency.
    // --------------------------------------------------------------------
    const byRecent = (a: Thread, b: Thread) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0);
    if (sort === "booked") {
      threads.sort((a, b) => (a.booked === b.booked ? byRecent(a, b) : a.booked ? -1 : 1));
    } else if (sort === "closed") {
      threads.sort((a, b) => {
        if (a.closed !== b.closed) return a.closed ? -1 : 1;
        if (a.closed && b.closed && a.collectedCents !== b.collectedCents)
          return b.collectedCents - a.collectedCents;
        return byRecent(a, b);
      });
    } else {
      threads.sort(byRecent);
    }

    const total = threads.length;
    const capped = threads.slice(0, MAX_LEADS);
    const start = (page - 1) * pageSize;
    const paged = capped.slice(start, start + pageSize);

    return NextResponse.json({
      threads: paged,
      total,
      totalLeads,
      bookedLeads,
      closedLeads,
      page,
      pageSize,
      filters: {
        campaigns: Array.from(campaignMap, ([id, v]) => ({ id, label: v.label, status: v.status })).sort((a, b) =>
          a.label.localeCompare(b.label)
        ),
        keywords: Array.from(keywordSet).sort(),
        adsets: Array.from(adsetMap, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
        ads: Array.from(adMap, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      },
    });
  } catch (err) {
    console.error("[/api/dms/conversations] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load conversations" },
      { status: 500 }
    );
  }
}
