import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

// Read-only ground-truth check: ask ManyChat where a buyer came from.
//
// For sales that have a ManyChat subscriber pasted but no ad-click event on
// record, we cannot tell from our own data whether the buyer came organically
// or clicked an ad whose flow failed to report back. ManyChat itself knows:
// the subscriber profile carries the ad keyword (custom field / tag) stamped at
// entry. We call /subscriber/getInfo (read-only — changes nothing in ManyChat)
// and store the verdict so the sale can be confidently classified as ad-driven
// (and credited) vs. organic.

const MANYCHAT_BASE = "https://api.manychat.com/fb";
const MAX_LOOKUPS_PER_RUN = 40;
const LOOKBACK_DAYS = 120;

type ClientKey = "tyson" | "keith";

function manychatKeyForClient(client: ClientKey): string | undefined {
  if (client === "tyson") return process.env.MANYCHAT_API_KEY_TYSON?.trim();
  if (client === "keith") return process.env.MANYCHAT_API_KEY_KEITH?.trim();
  return undefined;
}

function clientFromOffer(offer: string | null | undefined): ClientKey | null {
  const value = String(offer || "").toLowerCase();
  if (value.includes("tyson")) return "tyson";
  if (value.includes("keith")) return "keith";
  return null;
}

async function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronSecret && (authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret)) {
    return true;
  }
  const session = await auth();
  return !!session?.user;
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface ManychatField {
  name?: string;
  value?: unknown;
}

interface ManychatTag {
  name?: string;
}

interface GetInfoResult {
  status: number;
  customFields: ManychatField[];
  tags: ManychatTag[];
  raw: unknown;
  error?: string;
}

async function getInfo(client: ClientKey, subscriberId: string): Promise<GetInfoResult> {
  const key = manychatKeyForClient(client);
  if (!key) return { status: 0, customFields: [], tags: [], raw: null, error: `no_key_${client}` };
  try {
    const res = await fetch(
      `${MANYCHAT_BASE}/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`,
      { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: res.status, customFields: [], tags: [], raw: text.slice(0, 500), error: "non_json" };
    }
    const data = (parsed as { data?: Record<string, unknown> })?.data || {};
    const customFields = Array.isArray((data as { custom_fields?: unknown }).custom_fields)
      ? ((data as { custom_fields?: ManychatField[] }).custom_fields as ManychatField[])
      : [];
    const tags = Array.isArray((data as { tags?: unknown }).tags)
      ? ((data as { tags?: ManychatTag[] }).tags as ManychatTag[])
      : [];
    return { status: res.status, customFields, tags, raw: data };
  } catch (err) {
    return { status: 0, customFields: [], tags: [], raw: null, error: String(err) };
  }
}

// Tentative classification. The raw payload is also stored so the exact
// ad-origin signal can be audited and this can be tightened with certainty.
function classify(result: GetInfoResult): { fromAd: boolean | null; keyword: string | null } {
  if (result.error || result.status !== 200) return { fromAd: null, keyword: null };
  const keywordField = result.customFields.find(
    (f) =>
      typeof f.name === "string" &&
      /keyword|ad[_ ]?name|utm|campaign|ad[_ ]?id|ref/i.test(f.name) &&
      f.value != null &&
      String(f.value).trim() !== ""
  );
  if (keywordField) {
    return { fromAd: true, keyword: String(keywordField.value).trim().slice(0, 200) };
  }
  return { fromAd: false, keyword: null };
}

async function handler(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const dateFrom = shiftDate(todayIso(), -LOOKBACK_DAYS);

  // 1. Sales rows with a pasted ManyChat subscriber.
  const { data: salesRows, error: salesErr } = await db
    .from("sales_tracker_rows")
    .select("manychat_subscriber_id, prospect_name, date, offer")
    .not("manychat_subscriber_id", "is", null)
    .gte("date", dateFrom);
  if (salesErr) {
    return NextResponse.json({ ok: false, error: salesErr.message }, { status: 500 });
  }

  // 2. Subscribers we already have an ad-click (keyword) event for.
  const { data: eventRows, error: eventErr } = await db
    .from("ads_keyword_events")
    .select("subscriber_id")
    .eq("source", "manychat")
    .not("subscriber_id", "is", null)
    .not("keyword_normalized", "is", null);
  if (eventErr) {
    return NextResponse.json({ ok: false, error: eventErr.message }, { status: 500 });
  }
  const knownAdSubs = new Set((eventRows || []).map((r) => String(r.subscriber_id)));

  // 3. Already checked subscribers (skip to respect rate limits across runs).
  const { data: doneRows } = await db
    .from("manychat_origin_checks")
    .select("client_key, subscriber_id");
  const alreadyChecked = new Set(
    (doneRows || []).map((r) => `${r.client_key}:${r.subscriber_id}`)
  );

  // Candidates: pasted link, no ad-click event, a resolvable client, not yet checked.
  const candidates: {
    client: ClientKey;
    subscriberId: string;
    prospectName: string | null;
    saleDate: string | null;
    isControl: boolean;
  }[] = [];
  const seen = new Set<string>();
  for (const row of salesRows || []) {
    const subscriberId = String(row.manychat_subscriber_id);
    const client = clientFromOffer(row.offer as string | null);
    if (!client) continue;
    if (knownAdSubs.has(subscriberId)) continue;
    const dedupe = `${client}:${subscriberId}`;
    if (seen.has(dedupe) || alreadyChecked.has(dedupe)) continue;
    seen.add(dedupe);
    candidates.push({
      client,
      subscriberId,
      prospectName: (row.prospect_name as string | null) || null,
      saleDate: (row.date as string | null) || null,
      isControl: false,
    });
  }

  // Controls: a few subscribers we KNOW came from an ad, to confirm the
  // ad-origin signal looks the way we expect on a real ad buyer.
  const controlSubs = Array.from(knownAdSubs).slice(0, 3);
  for (const subscriberId of controlSubs) {
    const dedupe = `tyson:${subscriberId}`;
    if (alreadyChecked.has(dedupe)) continue;
    candidates.push({
      client: "tyson",
      subscriberId,
      prospectName: null,
      saleDate: null,
      isControl: true,
    });
  }

  const toCheck = candidates.slice(0, MAX_LOOKUPS_PER_RUN);
  const results: { subscriber_id: string; from_ad: boolean | null; keyword: string | null; control: boolean }[] = [];

  for (const c of toCheck) {
    const info = await getInfo(c.client, c.subscriberId);
    const { fromAd, keyword } = classify(info);
    const { error: upErr } = await db
      .from("manychat_origin_checks")
      .upsert(
        {
          client_key: c.client,
          subscriber_id: c.subscriberId,
          prospect_name: c.prospectName,
          sale_date: c.saleDate,
          is_control: c.isControl,
          from_ad: fromAd,
          origin_keyword: keyword,
          tags: info.tags,
          custom_fields: info.customFields,
          raw: info.raw,
          api_status: info.status,
          error: info.error || null,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "client_key,subscriber_id" }
      );
    if (upErr) {
      results.push({ subscriber_id: c.subscriberId, from_ad: null, keyword: null, control: c.isControl });
      continue;
    }
    results.push({ subscriber_id: c.subscriberId, from_ad: fromAd, keyword, control: c.isControl });
  }

  return NextResponse.json({
    ok: true,
    candidatesFound: candidates.length,
    checkedThisRun: toCheck.length,
    controlsChecked: toCheck.filter((c) => c.isControl).length,
    fromAd: results.filter((r) => !r.control && r.from_ad === true).length,
    organic: results.filter((r) => !r.control && r.from_ad === false).length,
    inconclusive: results.filter((r) => !r.control && r.from_ad === null).length,
  });
}

export async function POST(req: NextRequest) {
  return handler(req);
}

export async function GET(req: NextRequest) {
  return handler(req);
}
