import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// DMs tab — read-only inbox + dashboard of AD-KEYWORD-LINKED conversations.
//
// SCOPE: show ONLY leads that fired an ad keyword, and show EVERY one of them
// (no silent drops). We ANCHOR the list on `ads_keyword_events` — each row is a
// keyword fire, and that table is the reliable complete set of ad-attributable
// leads. We dedupe to the LATEST fire per subscriber, then LEFT-JOIN the DM
// conversation thread. A keyword-fired lead with no captured conversation still
// appears, it just has an empty thread + a clear "conversation not synced yet"
// label.
//
// ACCURACY (verified with live SQL 2026-06-21):
//   BOOKED = a REAL row in ghl_appointments (status != cancelled). Bridge the
//     lead via manychat_contact_links (subscriber_id ↔ ghl_contact_id).
//     The old `ads_keyword_events.appointment_id` was a false signal — only
//     6 of 976 tyson/14d subs had it; the ghl join finds 211.  NEVER use
//     appointment_id for booked again.
//   CLOSED = sales_tracker_rows.collected_revenue_cents>0 matched by
//     manychat_subscriber_id OR a name fallback (lead_name ↔ prospect_name /
//     prospect_name_normalized), because ~24 of 97 sales (30d) have no
//     subscriber id. Shows the collected $ on the lead.
//   STAGE  = dm_conversation_stage_state, an AI CLASSIFIER (not ground truth).
//     Keyed by subscriber_id (IG numeric id). We return booking_readiness_score
//     (the more validated number) plus the booleans WITH their stage_evidence
//     reason, analysis_version and ai_confidence so the UI can label them as an
//     AI estimate and show the proof.
//
// COVERAGE is a real gap and we are honest about it: only ~31% of keyword-fired
//   leads (118/384 tyson 7d) have a synced conversation thread / stage. Every
//   rate the dashboard reports carries its denominator.
//
// Bridge chain (ids live in different namespaces):
//   ads_keyword_events.subscriber_id (ManyChat id)
//     → instagram_lead_links.manychat_subscriber_id ↔ .instagram_user_id
//       → dm_conversation_messages.subscriber_id (IG numeric id)
//       → dm_conversation_stage_state.subscriber_id (IG numeric id)
//     → manychat_contact_links.subscriber_id ↔ .ghl_contact_id
//       → ghl_appointments.contact_id  (BOOKED)
//   ads_keyword_events.keyword_normalized
//     → ads_meta_insights_daily (campaign / adset / ad names + effective status)
// ---------------------------------------------------------------------------

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

function normName(v: string | null | undefined): string {
  return (v || "").toLowerCase().trim().replace(/\s+/g, " ");
}

interface KeywordEvent {
  subscriber_id: string;
  subscriber_name: string | null;
  contact_name: string | null;
  keyword_normalized: string | null;
  client_key: string | null;
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
  subscriber_id: string;
  booking_readiness_score: number | null;
  qualified: boolean | null;
  goal_clear: boolean | null;
  gap_clear: boolean | null;
  stakes_clear: boolean | null;
  ai_confidence: string | number | null;
  analysis_version: string | null;
  stage_evidence: unknown;
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
  // honesty metadata — this is an AI classifier output, not ground truth
  version: string | null;
  confidence: number | null;
  evidence: string | null;
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
  lastAt: string;
  eventAt: string;
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

function parseEvidence(raw: unknown): string | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      return s;
    }
  }
  if (typeof obj === "string") return obj.trim() || null;
  if (obj && typeof obj === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v == null) continue;
      const text = typeof v === "string" ? v : JSON.stringify(v);
      if (!text.trim()) continue;
      parts.push(`${k}: ${text.trim()}`);
    }
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

function toConfidence(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const params = req.nextUrl.searchParams;

    const view = params.get("view") || "inbox"; // inbox | dashboard
    const clientFilter = shortClient(params.get("client"));
    const campaignId = params.get("campaign") || "";
    const keywordFilter = (params.get("keyword") || "").toLowerCase();
    const adsetId = params.get("adset") || "";
    const adId = params.get("ad") || "";
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const search = (params.get("search") || "").trim().toLowerCase();
    const sort = params.get("sort") || "recent";
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const pageSize = Math.min(80, Math.max(10, parseInt(params.get("pageSize") || "40", 10)));

    // ----------------------------------------------------------------
    // 0) Filter OPTIONS from ads_meta_insights_daily for selected client.
    // ----------------------------------------------------------------
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
    const filtersOut = {
      campaigns: Array.from(campaignMap, ([id, v]) => ({ id, label: v.label, status: v.status })).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
      keywords: Array.from(keywordSet).sort(),
      adsets: Array.from(adsetMap, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      ads: Array.from(adMap, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };

    // ----------------------------------------------------------------
    // 1) ANCHOR: ads_keyword_events → latest fire per subscriber.
    //    Keep the FULL event timeline too (for the dashboard trend).
    // ----------------------------------------------------------------
    const latestByMc = new Map<string, KeywordEvent>();
    const allEvents: KeywordEvent[] = [];
    {
      const PAGE = 1000;
      let offset = 0;
      const SCAN_CEILING = 40000;
      for (;;) {
        let q = sb
          .from("ads_keyword_events")
          .select("subscriber_id, subscriber_name, contact_name, keyword_normalized, client_key, event_at")
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
          allEvents.push(r);
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
        view,
        threads: [],
        total: 0,
        totalLeads: 0,
        bookedLeads: 0,
        closedLeads: 0,
        conversationLeads: 0,
        stageLeads: 0,
        page,
        pageSize,
        dashboard: emptyDashboard(),
        filters: filtersOut,
      });
    }

    // ----------------------------------------------------------------
    // 2) Bridge ManyChat subscriber → IG conversation via instagram_lead_links.
    // ----------------------------------------------------------------
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
        if (l.instagram_user_id && l.manychat_subscriber_id) igToMc.set(l.instagram_user_id, l.manychat_subscriber_id);
      }
    }

    // ----------------------------------------------------------------
    // 3) Conversation messages for the bridged IG ids.
    // ----------------------------------------------------------------
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

    // ----------------------------------------------------------------
    // 4) Insight labels (campaign/adset/ad) per keyword.
    // ----------------------------------------------------------------
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

    // ----------------------------------------------------------------
    // 5) BOOKED — REAL ghl_appointments via manychat_contact_links.
    //    subscriber_id → ghl_contact_id → appointment.
    //
    //    THREE accuracy guards (verified with live SQL 2026-06-21):
    //      (a) CLIENT SCOPE — an appointment only counts for a lead if the
    //          appointment's `client` matches the lead's `client_key`. Without
    //          this, an Antwan lead matched a Tyson "Strategy Session (TS)"
    //          appointment because the contact ids collided. Antwan's GHL isn't
    //          synced → Antwan booked correctly resolves to 0.
    //      (b) APPT WINDOW — the appointment's start_time must fall inside the
    //          same date window the leads are pulled for. A 30-day lead who
    //          booked months ago must NOT show as "booked this period".
    //      (c) DISTINCT LEAD — bookedMc is a Set of subscriber ids, so reschedules
    //          / multiple appts per lead collapse to one booked lead.
    //    Pre-fix all-client/30d booked = 516 (matched the over-count complaint);
    //    post-fix = 219 (Tyson 211, Keith 8, Antwan 0, Lucy 0).
    //    NEVER drop the client scope or the appt window again.
    // ----------------------------------------------------------------
    // mc subscriber → ghl_contact_id, keeping the lead's client for scoping.
    const ghlByMc = new Map<string, { contactId: string; client: string | null }>();
    for (let i = 0; i < mcIds.length; i += 300) {
      const chunk = mcIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("manychat_contact_links")
        .select("subscriber_id, ghl_contact_id")
        .in("subscriber_id", chunk);
      if (error) throw error;
      for (const r of (data || []) as { subscriber_id: string; ghl_contact_id: string | null }[]) {
        if (r.subscriber_id && r.ghl_contact_id) {
          const leadClient = shortClient(latestByMc.get(r.subscriber_id)?.client_key);
          ghlByMc.set(r.subscriber_id, { contactId: r.ghl_contact_id, client: leadClient });
        }
      }
    }
    // For each ghl contact, collect the set of clients that have a REAL, in-window
    // (status booked, start_time inside the date window) appointment for it.
    const ghlContactIds = Array.from(new Set(Array.from(ghlByMc.values(), (v) => v.contactId)));
    const apptClientsByContact = new Map<string, Set<string>>();
    for (let i = 0; i < ghlContactIds.length; i += 300) {
      const chunk = ghlContactIds.slice(i, i + 300);
      let q = sb
        .from("ghl_appointments")
        .select("contact_id, status, client, start_time")
        .in("contact_id", chunk);
      if (dateFrom) q = q.gte("start_time", `${dateFrom}T00:00:00`);
      if (dateTo) q = q.lte("start_time", `${dateTo}T23:59:59.999`);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of (data || []) as { contact_id: string; status: string | null; client: string | null }[]) {
        const st = (r.status || "").toLowerCase();
        if (!r.contact_id) continue;
        if (st === "cancelled" || st === "canceled" || st === "noshow" || st === "no-show" || st === "invalid") continue;
        const sc = shortClient(r.client) || "";
        if (!apptClientsByContact.has(r.contact_id)) apptClientsByContact.set(r.contact_id, new Set());
        apptClientsByContact.get(r.contact_id)!.add(sc);
      }
    }
    const bookedMc = new Set<string>();
    for (const [mc, { contactId, client }] of ghlByMc) {
      const apptClients = apptClientsByContact.get(contactId);
      if (!apptClients || apptClients.size === 0) continue;
      // client scope: the appt must belong to the SAME client as the lead.
      if (client && apptClients.has(client)) bookedMc.add(mc);
    }

    // ----------------------------------------------------------------
    // 6) CLOSED — sales_tracker_rows by subscriber_id OR name fallback.
    // ----------------------------------------------------------------
    const collectedByMc = new Map<string, number>();
    // 6a) direct subscriber match
    for (let i = 0; i < mcIds.length; i += 300) {
      const chunk = mcIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("sales_tracker_rows")
        .select("manychat_subscriber_id, collected_revenue_cents")
        .in("manychat_subscriber_id", chunk)
        .gt("collected_revenue_cents", 0);
      if (error) throw error;
      for (const r of (data || []) as { manychat_subscriber_id: string; collected_revenue_cents: number | null }[]) {
        const cents = Number(r.collected_revenue_cents || 0);
        if (cents > 0 && r.manychat_subscriber_id)
          collectedByMc.set(r.manychat_subscriber_id, (collectedByMc.get(r.manychat_subscriber_id) || 0) + cents);
      }
    }
    // 6b) name fallback — recover sales that lack a subscriber id.
    //     Build a name→mc map for leads NOT already matched, then scan sales
    //     rows with no subscriber id in the date window.
    {
      const nameToMc = new Map<string, string>();
      for (const mc of mcIds) {
        const link = linkByMc.get(mc);
        const e = latestByMc.get(mc);
        const nm = normName(link?.lead_name) || normName(e?.subscriber_name) || normName(e?.contact_name);
        if (nm && !nameToMc.has(nm)) nameToMc.set(nm, mc);
      }
      if (nameToMc.size) {
        let q = sb
          .from("sales_tracker_rows")
          .select("prospect_name, prospect_name_normalized, collected_revenue_cents, manychat_subscriber_id, date")
          .gt("collected_revenue_cents", 0)
          .limit(10000);
        if (dateFrom) q = q.gte("date", dateFrom);
        if (dateTo) q = q.lte("date", dateTo);
        const { data, error } = await q;
        if (error) throw error;
        for (const r of (data || []) as {
          prospect_name: string | null;
          prospect_name_normalized: string | null;
          collected_revenue_cents: number | null;
          manychat_subscriber_id: string | null;
        }[]) {
          if (r.manychat_subscriber_id) continue; // already handled in 6a
          const cents = Number(r.collected_revenue_cents || 0);
          if (cents <= 0) continue;
          const cand = normName(r.prospect_name) || normName(r.prospect_name_normalized);
          if (!cand) continue;
          const mc = nameToMc.get(cand);
          if (mc && !collectedByMc.has(mc)) collectedByMc.set(mc, cents);
        }
      }
    }

    // ----------------------------------------------------------------
    // 7) STAGE via subscriber_id (IG numeric id). AI classifier output.
    // ----------------------------------------------------------------
    const stageByIg = new Map<string, StageRow>();
    for (let i = 0; i < igIds.length; i += 300) {
      const chunk = igIds.slice(i, i + 300);
      const { data, error } = await sb
        .from("dm_conversation_stage_state")
        .select(
          "subscriber_id, booking_readiness_score, qualified, goal_clear, gap_clear, stakes_clear, ai_confidence, analysis_version, stage_evidence"
        )
        .in("subscriber_id", chunk);
      if (error) throw error;
      for (const r of (data || []) as StageRow[]) if (r.subscriber_id) stageByIg.set(r.subscriber_id, r);
    }

    // ----------------------------------------------------------------
    // 8) Assemble one thread per keyword-fired lead.
    // ----------------------------------------------------------------
    let threads: Thread[] = [];
    for (const [mc, e] of latestByMc) {
      const link = linkByMc.get(mc);
      const ig = link?.instagram_user_id || null;
      const msgs = msgsByMc.get(mc) || [];
      const label = labelForEvent(e);
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      const stageRow = ig ? stageByIg.get(ig) : undefined;
      const stage: Stage | null = stageRow
        ? {
            score: stageRow.booking_readiness_score,
            qualified: !!stageRow.qualified,
            goalClear: !!stageRow.goal_clear,
            gapClear: !!stageRow.gap_clear,
            stakesClear: !!stageRow.stakes_clear,
            label: stageLabel(stageRow.booking_readiness_score, !!stageRow.qualified),
            version: stageRow.analysis_version || null,
            confidence: toConfidence(stageRow.ai_confidence),
            evidence: parseEvidence(stageRow.stage_evidence),
          }
        : null;

      const leadName = cleanName(link?.lead_name) || cleanName(e.subscriber_name) || cleanName(e.contact_name) || null;
      const handle = link?.instagram_handle || null;
      const setterName = msgs.find((m) => m.setter_name)?.setter_name || null;
      const booked = bookedMc.has(mc);
      const collectedCents = collectedByMc.get(mc) || 0;
      const lastAt = last && last.sent_at && last.sent_at > e.event_at ? last.sent_at : e.event_at;

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
        lastMessage: last ? previewBody(last.message_type, last.body) : "Conversation not synced yet",
        lastDirection: last?.direction || "inbound",
        lastAt,
        eventAt: e.event_at,
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

    // Whole-set (pre narrow-filter) honesty counters.
    const bookedLeads = threads.filter((t) => t.booked).length;
    const closedLeads = threads.filter((t) => t.closed).length;
    const conversationLeads = threads.filter((t) => t.hasConversation).length;
    const stageLeads = threads.filter((t) => t.stage != null).length;

    // ----------------------------------------------------------------
    // 9) Apply narrow filters (campaign/keyword/ad/adset/search).
    //    These apply to BOTH the inbox list and the dashboard aggregation.
    // ----------------------------------------------------------------
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

    // ----------------------------------------------------------------
    // 10) DASHBOARD aggregation (built from the filtered thread set so it
    //     respects client + campaign + date filters). Every metric carries
    //     a coverage denominator.
    // ----------------------------------------------------------------
    const dashboard =
      view === "dashboard" ? buildDashboard(threads, allEvents, labelForEvent) : undefined;

    // ----------------------------------------------------------------
    // 11) Sort + paginate the inbox list.
    // ----------------------------------------------------------------
    const byRecent = (a: Thread, b: Thread) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0);
    if (sort === "booked") {
      threads.sort((a, b) => (a.booked === b.booked ? byRecent(a, b) : a.booked ? -1 : 1));
    } else if (sort === "closed") {
      threads.sort((a, b) => {
        if (a.closed !== b.closed) return a.closed ? -1 : 1;
        if (a.closed && b.closed && a.collectedCents !== b.collectedCents) return b.collectedCents - a.collectedCents;
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
      view,
      threads: paged,
      total,
      totalLeads,
      bookedLeads,
      closedLeads,
      conversationLeads,
      stageLeads,
      page,
      pageSize,
      dashboard,
      filters: filtersOut,
    });
  } catch (err) {
    console.error("[/api/dms/conversations] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load conversations" },
      { status: 500 }
    );
  }
}

// ===========================================================================
// Dashboard aggregation. Operates entirely on the assembled (filtered) thread
// set — so every number is the same trustworthy join the inbox uses. Each block
// carries its own coverage denominator so the UI never implies completeness.
// ===========================================================================
interface GroupAgg {
  id: string;
  label: string;
  status: string | null;
  leads: number;
  booked: number;
  closed: number;
  collectedCents: number;
  // booking_readiness only over leads WITH a stage (coverage = stageLeads)
  stageLeads: number;
  readinessSum: number;
  convoLeads: number;
}

function buildDashboard(
  threads: Thread[],
  allEvents: KeywordEvent[],
  labelForEvent: (e: KeywordEvent) => InsightLabel | null
) {
  const totalLeads = threads.length;
  const booked = threads.filter((t) => t.booked).length;
  const closed = threads.filter((t) => t.closed).length;
  const collectedCents = threads.reduce((s, t) => s + (t.collectedCents || 0), 0);
  const withStage = threads.filter((t) => t.stage && t.stage.score != null);
  const withConvo = threads.filter((t) => t.hasConversation).length;
  const avgReadiness =
    withStage.length > 0 ? withStage.reduce((s, t) => s + (t.stage!.score || 0), 0) / withStage.length : null;

  // ---- Leads over time per campaign (trend) — from ALL keyword fires (reliable,
  //      no coverage gap). Bucket by ET day. Keep only campaigns present in the
  //      filtered thread set so it respects narrow filters.
  const keptCampaigns = new Set(threads.map((t) => t.campaignId).filter(Boolean) as string[]);
  const keptCampaignNames = new Map<string, string>();
  for (const t of threads) if (t.campaignId) keptCampaignNames.set(t.campaignId, t.campaignName || t.campaignId);
  const keptKeywords = new Set(threads.map((t) => (t.keyword || "").toLowerCase()).filter(Boolean));

  function etDay(iso: string): string {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));
    } catch {
      return (iso || "").slice(0, 10);
    }
  }
  // dedupe events to one-per-subscriber-per-day so "leads over time" counts leads
  const seenLeadDay = new Set<string>();
  const trendDayTotals = new Map<string, number>();
  const trendByCampDay = new Map<string, Map<string, number>>(); // campId → day → count
  for (const e of allEvents) {
    const kw = (e.keyword_normalized || "").toLowerCase();
    if (keptKeywords.size && kw && !keptKeywords.has(kw)) continue;
    const day = etDay(e.event_at);
    const dk = `${e.subscriber_id}|${day}`;
    if (seenLeadDay.has(dk)) continue;
    seenLeadDay.add(dk);
    trendDayTotals.set(day, (trendDayTotals.get(day) || 0) + 1);
    const label = labelForEvent(e);
    const cid = label?.campaign_id || null;
    if (cid && (keptCampaigns.size === 0 || keptCampaigns.has(cid))) {
      if (!keptCampaignNames.has(cid)) keptCampaignNames.set(cid, label?.campaign_name || cid);
      if (!trendByCampDay.has(cid)) trendByCampDay.set(cid, new Map());
      const m = trendByCampDay.get(cid)!;
      m.set(day, (m.get(day) || 0) + 1);
    }
  }
  const trendDays = Array.from(trendDayTotals.keys()).sort();
  const trendTotal = trendDays.map((d) => ({ day: d, count: trendDayTotals.get(d) || 0 }));
  const trendCampaigns = Array.from(trendByCampDay, ([cid, m]) => ({
    id: cid,
    label: keptCampaignNames.get(cid) || cid,
    points: trendDays.map((d) => m.get(d) || 0),
  }))
    .sort((a, b) => {
      const sa = a.points.reduce((x, y) => x + y, 0);
      const sb2 = b.points.reduce((x, y) => x + y, 0);
      return sb2 - sa;
    })
    .slice(0, 6);

  // ---- Per-campaign & per-ad-set aggregates ----
  function aggregate(keyFn: (t: Thread) => { id: string; label: string; status: string | null } | null) {
    const map = new Map<string, GroupAgg>();
    for (const t of threads) {
      const k = keyFn(t);
      if (!k) continue;
      let g = map.get(k.id);
      if (!g) {
        g = {
          id: k.id,
          label: k.label,
          status: k.status,
          leads: 0,
          booked: 0,
          closed: 0,
          collectedCents: 0,
          stageLeads: 0,
          readinessSum: 0,
          convoLeads: 0,
        };
        map.set(k.id, g);
      }
      g.leads += 1;
      if (t.booked) g.booked += 1;
      if (t.closed) {
        g.closed += 1;
        g.collectedCents += t.collectedCents || 0;
      }
      if (t.hasConversation) g.convoLeads += 1;
      if (t.stage && t.stage.score != null) {
        g.stageLeads += 1;
        g.readinessSum += t.stage.score;
      }
    }
    return Array.from(map.values())
      .map((g) => ({
        ...g,
        avgReadiness: g.stageLeads > 0 ? g.readinessSum / g.stageLeads : null,
      }))
      .sort((a, b) => b.leads - a.leads);
  }

  const byCampaign = aggregate((t) =>
    t.campaignId ? { id: t.campaignId, label: t.campaignName || t.campaignId, status: t.campaignStatus } : null
  );
  const byAdset = aggregate((t) =>
    t.adsetId ? { id: t.adsetId, label: t.adsetName || t.adsetId, status: t.campaignStatus } : null
  );

  // ---- Lead-score distribution (only over leads WITH a stage score) ----
  const buckets = [
    { id: "hot", label: "Hot (70-100)", min: 70, max: 101, count: 0 },
    { id: "warm", label: "Warm (40-69)", min: 40, max: 70, count: 0 },
    { id: "contact", label: "In contact (15-39)", min: 15, max: 40, count: 0 },
    { id: "new", label: "New (0-14)", min: 0, max: 15, count: 0 },
  ];
  for (const t of withStage) {
    const s = t.stage!.score || 0;
    const b = buckets.find((bk) => s >= bk.min && s < bk.max);
    if (b) b.count += 1;
  }

  return {
    summary: {
      totalLeads,
      booked,
      bookedRate: totalLeads ? booked / totalLeads : null,
      closed,
      closedRate: totalLeads ? closed / totalLeads : null,
      collectedCents,
      avgReadiness,
      stageCoverage: withStage.length,
      convoCoverage: withConvo,
    },
    trend: { days: trendDays, total: trendTotal.map((x) => x.count), campaigns: trendCampaigns },
    byCampaign,
    byAdset,
    scoreDistribution: { coverage: withStage.length, buckets: buckets.map((b) => ({ id: b.id, label: b.label, count: b.count })) },
  };
}

function emptyDashboard() {
  return {
    summary: {
      totalLeads: 0,
      booked: 0,
      bookedRate: null,
      closed: 0,
      closedRate: null,
      collectedCents: 0,
      avgReadiness: null,
      stageCoverage: 0,
      convoCoverage: 0,
    },
    trend: { days: [], total: [], campaigns: [] },
    byCampaign: [],
    byAdset: [],
    scoreDistribution: { coverage: 0, buckets: [] },
  };
}
