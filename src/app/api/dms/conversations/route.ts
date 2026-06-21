import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// DMs tab — read-only inbox for Instagram DM conversations.
//
// Data flow (verified against live Supabase 2026-06-21):
//   dm_conversation_messages.subscriber_id  (IG-scoped numeric, conversation_id = "instagram:<id>")
//     → instagram_lead_links.instagram_user_id ↔ .manychat_subscriber_id
//       → ads_keyword_events.subscriber_id  → .keyword_normalized
//         → ads_meta_insights_daily (keyword_normalized → campaign/adset/ad names)
//
// The two `subscriber_id` columns live in DIFFERENT id namespaces (IG vs ManyChat),
// so the bridge table instagram_lead_links is REQUIRED — never join them directly.
//
// LEFT-JOIN PHILOSOPHY: the default / "All campaigns" view shows EVERY conversation
// in the window (organic + ad-linked). The ad chain is an OPTIONAL tag. Only when the
// user actively picks a campaign / keyword / ad / ad-set do we restrict to that subset.
// In the last 7 days ~1,300 conversations exist but only ~29% bridge to a keyword, so
// requiring the ad chain would hide the majority of the inbox — we never do that.
//
// Lead stage (right panel / pills) comes from dm_conversation_stage_state
// (booking_readiness_score 0-100, qualified, goal/gap/stakes flags) — also a LEFT join.
// ---------------------------------------------------------------------------

// client column on dm_conversation_messages uses the long form (tyson_sonnek),
// while ads_keyword_events / ads_meta_insights_daily use the short form (tyson).
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

// Hard cap on the number of DISTINCT conversations we assemble per request. The 7-day
// window holds ~1.3k conversations / ~12.5k messages, so this comfortably covers it
// while protecting the route from a pathological wide window.
const MAX_CONVERSATIONS = 2500;

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

interface LeadLink {
  instagram_user_id: string | null;
  manychat_subscriber_id: string | null;
  instagram_handle: string | null;
  lead_name: string | null;
  client: string | null;
}

interface KeywordEvent {
  subscriber_id: string;
  keyword_normalized: string | null;
  client_key: string | null;
  event_at: string;
}

interface InsightLabel {
  keyword_normalized: string;
  client_key: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
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
  label: string; // "Hot lead" / "Warm" / "In contact" / "New" / null
}

interface Thread {
  conversationId: string;
  client: string | null;
  leadName: string | null;
  handle: string | null;
  keyword: string | null;
  campaignName: string | null;
  campaignId: string | null;
  adsetName: string | null;
  adsetId: string | null;
  adName: string | null;
  adId: string | null;
  setterName: string | null;
  lastMessage: string;
  lastDirection: string;
  lastAt: string;
  messageCount: number;
  linked: boolean;
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

// Map a booking-readiness score to a human stage pill. Scores observed live: 0-95.
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
    const campaignId = params.get("campaign") || ""; // campaign_id, "" = all
    const keywordFilter = (params.get("keyword") || "").toLowerCase();
    const adsetId = params.get("adset") || "";
    const adId = params.get("ad") || "";
    const dateFrom = params.get("dateFrom"); // YYYY-MM-DD
    const dateTo = params.get("dateTo"); // YYYY-MM-DD
    const search = (params.get("search") || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const pageSize = Math.min(80, Math.max(10, parseInt(params.get("pageSize") || "40", 10)));

    // 1) Resolve the set of conversation_ids that have ANY message in the window.
    //    We page through lightweight (conversation_id, sent_at, client) rows so the
    //    4000-row scan cap can never silently drop conversations from a wide window.
    //    We keep the MOST RECENT message timestamp per conversation for ordering.
    const lastAtByConvo = new Map<string, string>();
    const clientByConvo = new Map<string, string>();
    {
      const PAGE = 1000;
      let offset = 0;
      // hard ceiling on scanned message rows to stay well within runtime limits
      const SCAN_CEILING = 60000;
      for (;;) {
        let q = sb
          .from("dm_conversation_messages")
          .select("conversation_id, sent_at, client")
          .order("sent_at", { ascending: false })
          .range(offset, offset + PAGE - 1);

        if (clientFilter) {
          const longForm = Object.keys(CLIENT_LONG_TO_SHORT).find(
            (k) => CLIENT_LONG_TO_SHORT[k] === clientFilter
          );
          const variants = [clientFilter];
          if (longForm) variants.push(longForm);
          q = q.in("client", variants);
        }
        if (dateFrom) q = q.gte("sent_at", `${dateFrom}T00:00:00`);
        if (dateTo) q = q.lte("sent_at", `${dateTo}T23:59:59.999`);

        const { data, error } = await q;
        if (error) throw error;
        const rows = data || [];
        for (const r of rows) {
          if (!r.conversation_id) continue;
          // rows arrive newest-first; first time we see a convo = its latest message
          if (!lastAtByConvo.has(r.conversation_id)) {
            lastAtByConvo.set(r.conversation_id, r.sent_at);
            if (r.client) clientByConvo.set(r.conversation_id, r.client);
          }
        }
        offset += PAGE;
        if (rows.length < PAGE) break;
        if (offset >= SCAN_CEILING) break;
        if (lastAtByConvo.size >= MAX_CONVERSATIONS * 3) break;
      }
    }

    // Order conversations by recency, take the top MAX_CONVERSATIONS.
    const convoIds = Array.from(lastAtByConvo.entries())
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .slice(0, MAX_CONVERSATIONS)
      .map(([id]) => id);

    const totalConversations = lastAtByConvo.size;

    if (convoIds.length === 0) {
      return NextResponse.json({
        threads: [],
        total: 0,
        totalConversations: 0,
        linkedConversations: 0,
        page,
        pageSize,
        filters: { clients: [], campaigns: [], keywords: [], adsets: [], ads: [] },
      });
    }

    // 2) Pull ALL messages for those conversations (full threads). Chunk the IN() list.
    const messages: MessageRow[] = [];
    for (let i = 0; i < convoIds.length; i += 200) {
      const chunk = convoIds.slice(i, i + 200);
      const { data, error } = await sb
        .from("dm_conversation_messages")
        .select("conversation_id, subscriber_id, direction, body, sent_at, setter_name, client, message_type")
        .in("conversation_id", chunk)
        .order("sent_at", { ascending: true })
        .limit(40000);
      if (error) throw error;
      if (data) messages.push(...(data as MessageRow[]));
    }

    // Group messages by conversation.
    const byConvo = new Map<string, MessageRow[]>();
    for (const m of messages) {
      if (!byConvo.has(m.conversation_id)) byConvo.set(m.conversation_id, []);
      byConvo.get(m.conversation_id)!.push(m);
    }

    // 3) Bridge subscriber_id (IG) → manychat_subscriber_id via instagram_lead_links.
    const igIds = Array.from(
      new Set(messages.map((m) => m.subscriber_id).filter(Boolean))
    );
    const leadLinks: LeadLink[] = [];
    for (let i = 0; i < igIds.length; i += 300) {
      const chunk = igIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("instagram_lead_links")
        .select("instagram_user_id, manychat_subscriber_id, instagram_handle, lead_name, client")
        .in("instagram_user_id", chunk);
      if (error) throw error;
      if (data) leadLinks.push(...(data as LeadLink[]));
    }
    const linkByIg = new Map<string, LeadLink>();
    for (const l of leadLinks) {
      if (l.instagram_user_id) linkByIg.set(l.instagram_user_id, l);
    }

    // 4) Keyword events for the bridged manychat subscriber ids.
    const mcIds = Array.from(
      new Set(leadLinks.map((l) => l.manychat_subscriber_id).filter(Boolean) as string[])
    );
    const kwEvents: KeywordEvent[] = [];
    for (let i = 0; i < mcIds.length; i += 300) {
      const chunk = mcIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("ads_keyword_events")
        .select("subscriber_id, keyword_normalized, client_key, event_at")
        .in("subscriber_id", chunk)
        .order("event_at", { ascending: false });
      if (error) throw error;
      if (data) kwEvents.push(...(data as KeywordEvent[]));
    }
    // newest keyword per manychat subscriber
    const kwByMc = new Map<string, KeywordEvent>();
    for (const e of kwEvents) {
      if (!kwByMc.has(e.subscriber_id)) kwByMc.set(e.subscriber_id, e);
    }

    // 5) Insight labels (campaign/adset/ad) per keyword. Newest row per keyword+client.
    const keywords = Array.from(
      new Set(kwEvents.map((e) => e.keyword_normalized).filter(Boolean) as string[])
    );
    const labelByKey = new Map<string, InsightLabel>();
    if (keywords.length) {
      const insights: (InsightLabel & { date: string })[] = [];
      for (let i = 0; i < keywords.length; i += 200) {
        const chunk = keywords.slice(i, i + 200);
        const { data, error } = await sb
          .from("ads_meta_insights_daily")
          .select("keyword_normalized, client_key, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, date")
          .in("keyword_normalized", chunk)
          .order("date", { ascending: false });
        if (error) throw error;
        if (data) insights.push(...(data as (InsightLabel & { date: string })[]));
      }
      for (const row of insights) {
        const key = `${row.keyword_normalized}::${row.client_key || ""}`;
        if (!labelByKey.has(key)) labelByKey.set(key, row);
      }
    }

    function labelForEvent(e: KeywordEvent | undefined): InsightLabel | null {
      if (!e?.keyword_normalized) return null;
      const exact = labelByKey.get(`${e.keyword_normalized}::${e.client_key || ""}`);
      if (exact) return exact;
      // fall back to any client match for that keyword
      for (const [k, v] of labelByKey) {
        if (k.startsWith(`${e.keyword_normalized}::`)) return v;
      }
      return null;
    }

    // 6) Lead stage / booking-readiness — LEFT join via conversation_id.
    const stageByConvo = new Map<string, StageRow>();
    for (let i = 0; i < convoIds.length; i += 300) {
      const chunk = convoIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("dm_conversation_stage_state")
        .select("conversation_id, booking_readiness_score, qualified, goal_clear, gap_clear, stakes_clear")
        .in("conversation_id", chunk);
      if (error) throw error;
      for (const r of (data || []) as StageRow[]) {
        if (r.conversation_id) stageByConvo.set(r.conversation_id, r);
      }
    }

    // 7) Assemble threads.
    let threads: Thread[] = [];
    for (const [conversationId, list] of byConvo) {
      if (!list.length) continue;
      const sorted = list; // already ascending
      const last = sorted[sorted.length - 1];
      const igId = sorted[0].subscriber_id;
      const link = linkByIg.get(igId);
      const kwEvent = link?.manychat_subscriber_id
        ? kwByMc.get(link.manychat_subscriber_id)
        : undefined;
      const label = labelForEvent(kwEvent);

      const setterName = sorted.find((m) => m.setter_name)?.setter_name || null;

      const leadName =
        (link?.lead_name &&
          !link.lead_name.includes("{{") &&
          link.lead_name.trim()) ||
        null;
      const handle = link?.instagram_handle || null;

      const stageRow = stageByConvo.get(conversationId);
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

      const keyword = kwEvent?.keyword_normalized || null;

      threads.push({
        conversationId,
        client: list[0].client || clientByConvo.get(conversationId) || link?.client || null,
        leadName,
        handle,
        keyword,
        campaignName: label?.campaign_name || null,
        campaignId: label?.campaign_id || null,
        adsetName: label?.adset_name || null,
        adsetId: label?.adset_id || null,
        adName: label?.ad_name || null,
        adId: label?.ad_id || null,
        setterName,
        lastMessage: previewBody(last.message_type, last.body),
        lastDirection: last.direction || "inbound",
        lastAt: last.sent_at,
        messageCount: sorted.length,
        linked: !!keyword,
        stage,
        messages: sorted.map((m) => ({
          direction: m.direction || "inbound",
          body: previewBody(m.message_type, m.body),
          sentAt: m.sent_at,
          type: m.message_type,
        })),
      });
    }

    // Honest linked-vs-total counter (over the assembled set, before narrow filters).
    const linkedConversations = threads.filter((t) => t.linked).length;

    // Build filter option lists from the (unfiltered-by-keyword) thread set.
    const campaignMap = new Map<string, string>();
    const keywordSet = new Set<string>();
    const adsetMap = new Map<string, string>();
    const adMap = new Map<string, string>();
    const clientSet = new Set<string>();
    for (const t of threads) {
      if (t.client) clientSet.add(t.client);
      if (t.campaignId && t.campaignName) campaignMap.set(t.campaignId, t.campaignName);
      if (t.keyword) keywordSet.add(t.keyword);
      if (t.adsetId && t.adsetName) adsetMap.set(t.adsetId, t.adsetName);
      if (t.adId && t.adName) adMap.set(t.adId, t.adName);
    }

    // 8) Apply the OPTIONAL narrow filters (campaign/keyword/adset/ad/search).
    //    Only these restrict to the linked subset — the default view keeps everything.
    if (campaignId) threads = threads.filter((t) => t.campaignId === campaignId);
    if (adsetId) threads = threads.filter((t) => t.adsetId === adsetId);
    if (adId) threads = threads.filter((t) => t.adId === adId);
    if (keywordFilter)
      threads = threads.filter((t) => (t.keyword || "").toLowerCase() === keywordFilter);
    if (search) {
      threads = threads.filter((t) => {
        if ((t.leadName || "").toLowerCase().includes(search)) return true;
        if ((t.handle || "").toLowerCase().includes(search)) return true;
        if ((t.keyword || "").toLowerCase().includes(search)) return true;
        if ((t.campaignName || "").toLowerCase().includes(search)) return true;
        return t.messages.some((m) => m.body.toLowerCase().includes(search));
      });
    }

    // Sort by most recent message, paginate.
    threads.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    const total = threads.length;
    const start = (page - 1) * pageSize;
    const paged = threads.slice(start, start + pageSize);

    const sortByLabel = (a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label);

    return NextResponse.json({
      threads: paged,
      total, // count after the active narrow filters (drives pagination)
      totalConversations, // every conversation in the window (LEFT-join, organic + ad)
      linkedConversations, // subset that bridges to an ad keyword
      page,
      pageSize,
      filters: {
        clients: Array.from(clientSet).sort(),
        campaigns: Array.from(campaignMap, ([id, label]) => ({ id, label })).sort(sortByLabel),
        keywords: Array.from(keywordSet).sort(),
        adsets: Array.from(adsetMap, ([id, label]) => ({ id, label })).sort(sortByLabel),
        ads: Array.from(adMap, ([id, label]) => ({ id, label })).sort(sortByLabel),
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
