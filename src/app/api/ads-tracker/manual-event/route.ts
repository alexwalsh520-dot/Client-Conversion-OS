import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";

export const dynamic = "force-dynamic";

const EVENT_TYPES = {
  msgs: "manual_messages",
  calls: "manual_booked_calls",
  taken: "manual_calls_taken",
  clients: "manual_new_clients",
  collected: "manual_collected_revenue",
} as const;

type Bucket = keyof typeof EVENT_TYPES;

function isBucket(value: unknown): value is Bucket {
  return typeof value === "string" && value in EVENT_TYPES;
}

function isClientKey(value: unknown): value is "tyson" | "keith" {
  return value === "tyson" || value === "keith";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayEt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function eventAtForDate(date: string) {
  return `${date}T12:00:00.000Z`;
}

async function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  const session = await auth();
  return !!session?.user;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clientKey = body.clientKey || body.campaign;
  const bucket = body.bucket;
  const keyword = normalizeKeyword(body.keyword);
  const value = Number(body.value);
  const date = isIsoDate(body.date) ? body.date : todayEt();

  if (!isClientKey(clientKey)) {
    return NextResponse.json({ error: "clientKey must be tyson or keith" }, { status: 400 });
  }
  if (!isBucket(bucket)) {
    return NextResponse.json({ error: "Invalid manual event bucket" }, { status: 400 });
  }
  if (!keyword) {
    return NextResponse.json({ error: "Keyword is required" }, { status: 400 });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Value must be greater than 0" }, { status: 400 });
  }

  const storedValue =
    bucket === "collected" ? Math.round(value * 100) : Math.round(value);

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("ads_keyword_events")
    .insert({
      source: "ghl",
      event_type: EVENT_TYPES[bucket],
      client_key: clientKey,
      keyword_raw: displayKeyword(keyword),
      keyword_normalized: keyword,
      value_cents: storedValue,
      setter_name: body.setterName || body.setter || null,
      contact_name: body.contactName || body.name || null,
      event_at: eventAtForDate(date),
      raw_payload: {
        manual: true,
        bucket,
        value,
        date,
        note: body.note || null,
        created_from: "ads_tracker_manual_event",
      },
    })
    .select("id,event_type,client_key,keyword_raw,keyword_normalized,value_cents,event_at")
    .single();

  if (error) {
    console.error("[ads-tracker] Manual event insert failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, event: data });
}
