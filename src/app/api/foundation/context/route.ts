// Foundation read surface — the cheap way anything (an AI agent, a brief, a page)
// pulls context. Reads pre-stitched foundation tables; NEVER computes ad-level revenue
// (that comes from the canonical getAdsTrackerDashboard, surfaced read-only via ?money=1).
//
//   GET ?stream=1&client=tyson&types=sale,call_booked&day=2026-07-06&limit=50
//   GET ?subscriber_id=123            → that person's context + full timeline
//   GET ?person=sub:123               → same, by person key
//   GET ?name=Jane%20Doe&client=tyson → person by exact name (candidates if ambiguous)
//   GET ?ad=fit&client=tyson&money=1  → per-ad counts + canonical money (read-only)
//   GET ?freshness=1                  → per-source staleness
// Every response also carries a compact `freshness` envelope so a reader never acts on stale data.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdsTrackerDashboard, type AdsTrackerAccount } from "@/lib/ads-tracker/server";
import { normName } from "@/lib/foundation/resolve";
import { isCreatorKey } from "@/lib/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SB = ReturnType<typeof getServiceSupabase>;

const EV =
  "event_type, occurred_at, occurred_day_et, keyword_normalized, amount_cents, actor, summary, source, source_id, link_confidence";

const CORE_SOURCES = new Set([
  "dm_conversation_messages",
  "ads_keyword_events",
  "sales_tracker_rows",
  "ghl_appointments",
]);

// Compact freshness envelope attached to EVERY response. Fathom is excluded from `stale`
// because it lags by design (webhook-driven); a stale core source is what an agent must not trust.
async function freshness(sb: SB) {
  const { data } = await sb.from("feed_watermarks").select("source, last_run_at");
  const now = Date.now();
  let stale = false;
  const sources = (data ?? []).map((w) => {
    const mins = w.last_run_at ? Math.round((now - new Date(w.last_run_at).getTime()) / 60_000) : null;
    if (CORE_SOURCES.has(w.source) && (mins == null || mins > 60)) stale = true;
    return { source: w.source, minutes_since_run: mins };
  });
  return { stale, sources };
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function personTimeline(sb: SB, person: Record<string, unknown>) {
  const subs = (person.subscriber_ids as string[]) ?? [];
  const contacts = (person.contact_ids as string[]) ?? [];
  const rawName = (person.display_name as string) ?? null;
  const nm = normName(rawName);

  const queries = [];
  if (subs.length) queries.push(sb.from("activity_events").select(EV).in("subscriber_id", subs));
  if (contacts.length) queries.push(sb.from("activity_events").select(EV).in("contact_id", contacts));
  // Union by name ONLY when it's a safe key: a real (non-placeholder) name that belongs to
  // exactly one person. Otherwise a shared name would pull in strangers' events.
  if (rawName && nm) {
    const { count } = await sb
      .from("person_context")
      .select("person_key", { count: "exact", head: true })
      .ilike("display_name", rawName);
    if ((count ?? 0) <= 1) queries.push(sb.from("activity_events").select(EV).eq("display_name", rawName));
  }

  const results = await Promise.all(queries);
  const seen = new Set<string>();
  const timeline: Record<string, unknown>[] = [];
  for (const r of results)
    for (const e of r.data ?? []) {
      const k = `${e.source}|${e.source_id}|${e.event_type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      timeline.push(e);
    }
  timeline.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  return timeline;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sb = getServiceSupabase();
  const fresh = await freshness(sb);

  // ?freshness=1 → detailed staleness
  if (url.searchParams.get("freshness")) {
    const { data } = await sb.from("feed_watermarks").select("*").order("source");
    const now = Date.now();
    const rows = (data ?? []).map((w) => ({
      source: w.source,
      cursor_value: w.cursor_value,
      last_run_at: w.last_run_at,
      rows_last_run: w.rows_last_run,
      minutes_since_run: w.last_run_at ? Math.round((now - new Date(w.last_run_at).getTime()) / 60_000) : null,
    }));
    return NextResponse.json({ ok: true, stale: fresh.stale, sources: rows });
  }

  // ?name= → exact person lookup (candidates when ambiguous, never fuzzy)
  const nameParam = url.searchParams.get("name");
  if (nameParam) {
    if (!normName(nameParam)) {
      return NextResponse.json({ ok: true, person: null, note: "name too short/ambiguous to match", freshness: fresh });
    }
    const client = url.searchParams.get("client");
    let q = sb.from("person_context").select("*").ilike("display_name", nameParam);
    if (client) q = q.eq("client_key", client);
    const { data } = await q.limit(25);
    const rows = data ?? [];
    if (rows.length === 1) {
      const timeline = await personTimeline(sb, rows[0]);
      return NextResponse.json({ ok: true, person: rows[0], timeline, freshness: fresh });
    }
    if (rows.length === 0) return NextResponse.json({ ok: true, person: null, freshness: fresh });
    return NextResponse.json({
      ok: true,
      person: null,
      candidates: rows.map((r) => ({
        person_key: r.person_key,
        display_name: r.display_name,
        client_key: r.client_key,
        closed: r.closed,
        last_activity_at: r.last_activity_at,
      })),
      note: "multiple people share this name — pick a person_key",
      freshness: fresh,
    });
  }

  // ?subscriber_id= / ?person= → one person + full cross-identity timeline
  const subscriberId = url.searchParams.get("subscriber_id");
  const personKeyParam = url.searchParams.get("person");
  if (subscriberId || personKeyParam) {
    let person: Record<string, unknown> | null = null;
    if (personKeyParam) {
      const { data } = await sb.from("person_context").select("*").eq("person_key", personKeyParam).limit(1);
      person = data?.[0] ?? null;
    } else {
      const { data } = await sb.from("person_context").select("*").contains("subscriber_ids", [subscriberId]).limit(1);
      person = data?.[0] ?? null;
    }
    if (!person) return NextResponse.json({ ok: true, person: null, timeline: [], freshness: fresh });
    const timeline = await personTimeline(sb, person);
    return NextResponse.json({ ok: true, person, timeline, freshness: fresh });
  }

  // ?ad= → per-ad counts (+ canonical money when &money=1)
  const ad = url.searchParams.get("ad");
  if (ad) {
    const client = url.searchParams.get("client");
    let q = sb.from("ad_context").select("*").eq("keyword_normalized", ad);
    if (client) q = q.eq("client_key", client);
    const { data } = await q;
    const out: Record<string, unknown> = {
      ok: true,
      ad: data ?? [],
      note: "Counts are foundation-derived; keyword_normalized is the FIRST keyword. Revenue/ROAS only via money=1 (canonical).",
      freshness: fresh,
    };
    if (url.searchParams.get("money")) {
      const account: AdsTrackerAccount = client && isCreatorKey(client) ? client : "all";
      const dateTo = url.searchParams.get("dateTo") || todayET();
      const dateFrom = url.searchParams.get("dateFrom") || "2026-04-01";
      try {
        const dash = await getAdsTrackerDashboard({ account, status: "active", level: "ad", dateFrom, dateTo });
        const rows = (dash.adRoas ?? []).filter(
          (r) => (r.label || "").toLowerCase() === ad.toLowerCase(),
        );
        out.money = rows.length
          ? {
              money_source: "ads_tracker_canonical",
              window: { dateFrom, dateTo },
              rows: rows.map((r) => ({
                keyword: r.label,
                clientKey: r.clientKey,
                adSpend: r.adSpend,
                messages: r.messages,
                costPerMessage: r.costPerMessage,
                bookedCalls: r.bookedCalls,
                costPerBookedCall: r.costPerBookedCall,
                callsTaken: r.callsTaken,
                newClients: r.newClients,
                collectedRevenue: r.collectedRevenue,
                grossProfit: r.grossProfit,
                collectedRoi: r.collectedRoi,
                grossProfitRoi: r.grossProfitRoi,
              })),
            }
          : { money_source: "ads_tracker_canonical", window: { dateFrom, dateTo }, rows: [] };
      } catch (e) {
        out.money = { money_source: "ads_tracker_canonical", error: e instanceof Error ? e.message : "failed" };
      }
    }
    return NextResponse.json(out);
  }

  // default: the activity stream, newest first, with optional type/day/client filters
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
  const client = url.searchParams.get("client");
  const types = (url.searchParams.get("types") || "").split(",").map((t) => t.trim()).filter(Boolean);
  const day = url.searchParams.get("day");
  let q = sb
    .from("activity_events")
    .select("client_key, event_type, subscriber_id, keyword_normalized, occurred_at, occurred_day_et, amount_cents, actor, summary, link_confidence")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (client) q = q.eq("client_key", client);
  if (types.length) q = q.in("event_type", types);
  if (day) q = q.eq("occurred_day_et", day);
  const { data } = await q;
  return NextResponse.json({ ok: true, stream: data ?? [], freshness: fresh });
}
