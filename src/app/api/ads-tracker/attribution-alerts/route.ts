import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";

export const dynamic = "force-dynamic";

const RESOLUTION_SOURCE = "ads_tracker_alert_resolution";
const ACTIONS = new Set(["attribute", "organic", "ignore"]);
const MISSING_DM_KEYWORD_ALERT = "missing_dm_keyword";
const MISSING_BOOKING_KEYWORD_ALERT = "missing_booking_keyword";

function isClientKey(value: unknown): value is "tyson" | "keith" {
  return value === "tyson" || value === "keith";
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function duplicateEvent(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || Boolean(error?.message?.toLowerCase().includes("duplicate key"));
}

function missingColumn(error: { message?: string } | null, column: string) {
  return Boolean(error?.message?.toLowerCase().includes(column.toLowerCase()));
}

function removeColumns<T extends Record<string, unknown>>(payload: T, columns: string[]) {
  const compatiblePayload: Record<string, unknown> = { ...payload };
  for (const column of columns) delete compatiblePayload[column];
  return compatiblePayload;
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
  const alertType = cleanString(body.alertType);
  const isMissingDmKeywordAlert = alertType === MISSING_DM_KEYWORD_ALERT;
  const isMissingBookingKeywordAlert = alertType === MISSING_BOOKING_KEYWORD_ALERT;

  if (!saleKey) {
    return NextResponse.json({ error: "alert key is required" }, { status: 400 });
  }
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "action must be attribute, organic, or ignore" }, { status: 400 });
  }
  if (clientKey && !isClientKey(clientKey)) {
    return NextResponse.json({ error: "clientKey must be tyson or keith" }, { status: 400 });
  }
  if (action === "attribute" && !keyword) {
    return NextResponse.json({ error: "keyword is required when attributing" }, { status: 400 });
  }
  if ((isMissingDmKeywordAlert || isMissingBookingKeywordAlert) && !clientKey) {
    return NextResponse.json({ error: "clientKey is required for missing keyword alerts" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const db = getServiceSupabase();

  if (isMissingDmKeywordAlert && action === "attribute" && keyword) {
    const eventAt = cleanString(body.eventAt) || now;
    const subscriberId = cleanString(body.subscriberId);
    const keywordEventPayload = {
      source: "manychat",
      source_event_id: `missing-keyword-resolution:${saleKey}:${keyword}`,
      event_type: "dm_keyword",
      client_key: clientKey,
      keyword_raw: cleanString(body.keyword) || displayKeyword(keyword),
      keyword_normalized: keyword,
      subscriber_id: subscriberId,
      subscriber_name: cleanString(body.subscriberName) || cleanString(sale.name) || cleanString(body.contactName),
      setter_name: cleanString(body.setterName) || cleanString(sale.setter),
      appointment_id: null,
      contact_id: null,
      contact_name: cleanString(body.contactName) || cleanString(sale.name),
      event_at: eventAt,
      raw_payload: {
        manual: true,
        alertType,
        saleKey,
        instagramHandle: cleanString(body.instagramHandle),
        manychatUrl: cleanString(body.manychatUrl),
        note: cleanString(body.note),
        created_from: "ads_tracker_missing_manychat_keyword_resolution",
        created_at: now,
      },
    };

    const { error: keywordEventError } = await db
      .from("ads_keyword_events")
      .insert(keywordEventPayload);

    if (keywordEventError && !duplicateEvent(keywordEventError)) {
      if (missingColumn(keywordEventError, "source_event_id")) {
        const { error: fallbackError } = await db
          .from("ads_keyword_events")
          .insert(removeColumns(keywordEventPayload, ["source_event_id"]));

        if (fallbackError && !duplicateEvent(fallbackError)) {
          console.error("[ads-tracker] Missing keyword repair insert failed", fallbackError);
          return NextResponse.json({ error: fallbackError.message }, { status: 500 });
        }
      } else {
        console.error("[ads-tracker] Missing keyword repair insert failed", keywordEventError);
        return NextResponse.json({ error: keywordEventError.message }, { status: 500 });
      }
    }
  }

  if (isMissingBookingKeywordAlert && action === "attribute" && keyword) {
    const eventAt = cleanString(body.eventAt) || now;
    const appointmentId = cleanString(body.appointmentId);
    const keywordEventPayload = {
      source: "ghl",
      source_event_id: `missing-booking-keyword-resolution:${saleKey}:${keyword}`,
      event_type: "booked_call",
      client_key: clientKey,
      keyword_raw: cleanString(body.keyword) || displayKeyword(keyword),
      keyword_normalized: keyword,
      subscriber_id: null,
      subscriber_name: null,
      setter_name: cleanString(body.setterName) || cleanString(sale.setter),
      appointment_id: appointmentId,
      contact_id: cleanString(body.contactId),
      contact_name: cleanString(body.contactName) || cleanString(sale.name),
      event_at: eventAt,
      raw_payload: {
        manual: true,
        alertType,
        saleKey,
        appointmentId,
        contactId: cleanString(body.contactId),
        note: cleanString(body.note),
        created_from: "ads_tracker_missing_ghl_booking_keyword_resolution",
        created_at: now,
      },
    };

    const { error: keywordEventError } = await db
      .from("ads_keyword_events")
      .insert(keywordEventPayload);

    if (keywordEventError && !duplicateEvent(keywordEventError)) {
      if (missingColumn(keywordEventError, "source_event_id")) {
        const { error: fallbackError } = await db
          .from("ads_keyword_events")
          .insert(removeColumns(keywordEventPayload, ["source_event_id"]));

        if (fallbackError && !duplicateEvent(fallbackError)) {
          console.error("[ads-tracker] Missing GHL booking keyword repair insert failed", fallbackError);
          return NextResponse.json({ error: fallbackError.message }, { status: 500 });
        }
      } else {
        console.error("[ads-tracker] Missing GHL booking keyword repair insert failed", keywordEventError);
        return NextResponse.json({ error: keywordEventError.message }, { status: 500 });
      }
    }
  }

  const payload = {
    saleKey,
    action,
    alertType,
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
    subscriberId: cleanString(body.subscriberId),
    subscriberName: cleanString(body.subscriberName),
    instagramHandle: cleanString(body.instagramHandle),
    manychatUrl: cleanString(body.manychatUrl),
    appointmentId: cleanString(body.appointmentId),
    contactId: cleanString(body.contactId),
    contactName: cleanString(body.contactName),
    eventAt: cleanString(body.eventAt),
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
      appointment_id: cleanString(body.appointmentId),
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
