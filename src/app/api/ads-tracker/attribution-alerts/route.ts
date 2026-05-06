import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";

export const dynamic = "force-dynamic";

const RESOLUTION_SOURCE = "ads_tracker_alert_resolution";
const ACTIONS = new Set(["attribute", "organic", "ignore"]);

function isClientKey(value: unknown): value is "tyson" | "keith" {
  return value === "tyson" || value === "keith";
}

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

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const saleKey = cleanString(body.saleKey);
  const action = cleanString(body.action);
  const sale = body.sale && typeof body.sale === "object" && !Array.isArray(body.sale)
    ? body.sale as Record<string, unknown>
    : {};
  const clientKey = cleanString(body.clientKey) || cleanString(sale.clientKey);
  const keyword = normalizeKeyword(body.keyword);

  if (!saleKey) {
    return NextResponse.json({ error: "saleKey is required" }, { status: 400 });
  }
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "action must be attribute, organic, or ignore" }, { status: 400 });
  }
  if (clientKey && !isClientKey(clientKey)) {
    return NextResponse.json({ error: "clientKey must be tyson or keith" }, { status: 400 });
  }
  if (action === "attribute" && !keyword) {
    return NextResponse.json({ error: "keyword is required when attributing a sale" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const db = getServiceSupabase();
  const payload = {
    saleKey,
    action,
    previousResolutionId: cleanString(body.resolutionId),
    sale: {
      date: cleanString(sale.date),
      name: cleanString(sale.name),
      setter: cleanString(sale.setter),
      amount: Number(sale.amount || 0),
      reason: cleanString(sale.reason),
    },
    clientKey,
    keyword: keyword ? displayKeyword(keyword) : null,
    keywordRaw: cleanString(body.keyword) || (keyword ? displayKeyword(keyword) : null),
    campaignId: cleanString(body.campaignId),
    campaignName: cleanString(body.campaignName),
    adId: cleanString(body.adId),
    adName: cleanString(body.adName),
    groupId: cleanString(body.groupId),
    groupName: cleanString(body.groupName),
    note: cleanString(body.note),
    created_from: "ads_tracker_attribution_alerts",
    created_at: now,
  };

  const { data, error } = await db
    .from("ads_attribution_exceptions")
    .insert({
      source: RESOLUTION_SOURCE,
      reason: action,
      client_key: clientKey,
      keyword_normalized: keyword,
      contact_name: cleanString(sale.name) || cleanString(body.contactName),
      appointment_id: null,
      payload,
      resolved_at: now,
    })
    .select("id,source,reason,client_key,keyword_normalized,contact_name,payload,resolved_at,created_at")
    .single();

  if (error) {
    console.error("[ads-tracker] Attribution alert resolution insert failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resolution: data });
}
