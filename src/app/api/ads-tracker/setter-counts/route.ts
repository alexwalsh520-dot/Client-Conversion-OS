import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";
import { isCreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";

// Setter-reported keyword win counts. These are what a setter KNOWS ("I got 8
// wins from FOCUS this campaign") but the system couldn't trace to the nth
// degree. Stored separately and shown side-by-side with system-tracked counts —
// NEVER folded into ROAS/profit, NEVER credited as organic. Money math stays on
// hard tracking only. See project-ccos-attribution-workspace memory.
const SETTER_COUNT_SOURCE = "ads_tracker_setter_reported";
const SETTER_COUNT_REASON = "setter_count";

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  const session = await auth();
  return !!session?.user;
}

type SetterCountRow = {
  id: string;
  client_key: string | null;
  keyword_normalized: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

function serializeRow(row: SetterCountRow) {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    clientKey: row.client_key,
    keyword: row.keyword_normalized ? displayKeyword(row.keyword_normalized) : null,
    keywordNormalized: row.keyword_normalized,
    count: Number(payload.count ?? 0),
    periodFrom: cleanString(payload.periodFrom),
    periodTo: cleanString(payload.periodTo),
    setter: cleanString(payload.setter),
    note: cleanString(payload.note),
    createdAt: cleanString(payload.createdAt) || row.created_at,
  };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientKey = cleanString(req.nextUrl.searchParams.get("clientKey"));
  const db = getServiceSupabase();

  let query = db
    .from("ads_attribution_exceptions")
    .select("id,client_key,keyword_normalized,payload,created_at")
    .eq("source", SETTER_COUNT_SOURCE)
    .order("created_at", { ascending: false });

  if (clientKey) query = query.eq("client_key", clientKey);

  const { data, error } = await query;

  if (error) {
    console.error("[ads-tracker] Setter-count list failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts = (data ?? []).map((row) => serializeRow(row as SetterCountRow));
  return NextResponse.json({ ok: true, counts });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clientKey = cleanString(body.clientKey);
  const keyword = normalizeKeyword(body.keyword);
  const count = Number(body.count);

  if (!clientKey || !isCreatorKey(clientKey)) {
    return NextResponse.json({ error: "clientKey must be a known creator" }, { status: 400 });
  }
  if (!keyword) {
    return NextResponse.json({ error: "keyword is required" }, { status: 400 });
  }
  if (!Number.isFinite(count) || count < 0) {
    return NextResponse.json({ error: "count must be a non-negative number" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const db = getServiceSupabase();

  const payload = {
    count: Math.round(count),
    periodFrom: cleanString(body.periodFrom),
    periodTo: cleanString(body.periodTo),
    setter: cleanString(body.setter),
    note: cleanString(body.note),
    keywordRaw: cleanString(body.keyword) || displayKeyword(keyword),
    createdAt: now,
  };

  const { data, error } = await db
    .from("ads_attribution_exceptions")
    .insert({
      source: SETTER_COUNT_SOURCE,
      reason: SETTER_COUNT_REASON,
      client_key: clientKey,
      keyword_normalized: keyword,
      contact_name: null,
      appointment_id: null,
      payload,
      resolved_at: now,
    })
    .select("id,client_key,keyword_normalized,payload,created_at")
    .single();

  if (error) {
    console.error("[ads-tracker] Setter-count insert failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: serializeRow(data as SetterCountRow) });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id =
    cleanString(req.nextUrl.searchParams.get("id")) ||
    cleanString((await req.json().catch(() => ({})))?.id);

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db
    .from("ads_attribution_exceptions")
    .delete()
    .eq("id", id)
    .eq("source", SETTER_COUNT_SOURCE);

  if (error) {
    console.error("[ads-tracker] Setter-count delete failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
