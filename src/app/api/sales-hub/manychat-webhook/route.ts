import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { normalizeClientKey, normalizeSetterKey, syncManychatEventToGhl } from "@/lib/ghl-dm-sync";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";

/**
 * Manychat Webhook — receives tag events from Manychat External Requests.
 *
 * Manychat sends POST with JSON body when a tag is applied to a subscriber.
 * We store each event in Supabase so we can count metrics by date range.
 *
 * Expected body (configured in Manychat External Request action):
 * {
 *   "subscriber_id": "{{user_id}}",
 *   "first_name": "{{first_name}}",
 *   "last_name": "{{last_name}}",
 *   "tag_name": "new_lead",          // hard-coded per flow
 *   "client": "tyson"                 // hard-coded per flow: "tyson" or "keith"
 * }
 *
 * Optional fields for setter tracking:
 *   "setter_name": "amara"            // hard-coded per setter flow
 *   "keyword": "{{custom_field.keyword}}" // ManyChat user field captured from ad keyword
 *
 * Optional fields for GHL sync:
 *   "instagram_handle": "prospect_handle"
 *   "event_at": "2026-04-10T04:15:00.000Z"
 */

function adsClientKeyFromDmClient(clientKey: ReturnType<typeof normalizeClientKey>) {
  if (clientKey === "tyson_sonnek") return "tyson";
  if (clientKey === "keith_holland") return "keith";
  return clientKey;
}

function sourceEventId(input: {
  explicitId?: string;
  clientKey: string;
  subscriberId: string;
  tagName: string;
  keywordNormalized: string | null;
}) {
  if (input.explicitId?.trim()) return `manychat:${input.explicitId.trim()}`;
  return [
    "manychat",
    input.clientKey,
    input.subscriberId,
    input.tagName.toLowerCase().trim(),
    input.keywordNormalized || "no-keyword",
  ].join(":");
}

function missingColumn(error: { message?: string } | null, column: string) {
  return Boolean(error?.message?.toLowerCase().includes(column.toLowerCase()));
}

function duplicateEvent(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || Boolean(error?.message?.toLowerCase().includes("duplicate key"));
}

function removeColumns<T extends Record<string, unknown>>(payload: T, columns: string[]) {
  const compatiblePayload: Record<string, unknown> = { ...payload };
  for (const column of columns) delete compatiblePayload[column];
  return compatiblePayload;
}

export async function POST(req: NextRequest) {
  try {
    const expectedSecret = process.env.MANYCHAT_WEBHOOK_SECRET;
    if (expectedSecret) {
      const providedSecret = req.headers.get("x-webhook-secret");
      if (providedSecret !== expectedSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();

    const {
      subscriber_id,
      first_name,
      last_name,
      tag_name,
      client,
      setter_name,
      keyword,
      instagram_handle,
      event_at,
      event_id,
      eventId,
    } = body as {
      subscriber_id?: string;
      first_name?: string;
      last_name?: string;
      tag_name?: string;
      client?: string;
      setter_name?: string;
      keyword?: string;
      instagram_handle?: string;
      event_at?: string;
      event_id?: string;
      eventId?: string;
    };

    if (!subscriber_id || !tag_name || !client) {
      return NextResponse.json(
        { error: "subscriber_id, tag_name, and client are required" },
        { status: 400 }
      );
    }

    const sb = getServiceSupabase();
    const normalizedEventAt = event_at || new Date().toISOString();

    const clientKey = normalizeClientKey(client);
    const adsClientKey = adsClientKeyFromDmClient(clientKey);
    const setterKey = normalizeSetterKey(setter_name);
    const keywordNormalized = normalizeKeyword(keyword);
    const keywordRaw = keywordNormalized ? displayKeyword(keywordNormalized) : null;
    const keywordSourceEventId = sourceEventId({
      explicitId: event_id || eventId,
      clientKey: adsClientKey,
      subscriberId: subscriber_id,
      tagName: tag_name,
      keywordNormalized,
    });

    const tagEventPayload = {
      subscriber_id,
      subscriber_name: [first_name, last_name].filter(Boolean).join(" ") || "Unknown",
      tag_name: tag_name.toLowerCase().trim(),
      client: clientKey,
      setter_name: setterKey,
      keyword_raw: keywordRaw,
      keyword_normalized: keywordNormalized,
      raw_payload: body,
      event_at: normalizedEventAt,
    };

    const { error } = await sb.from("manychat_tag_events").insert(tagEventPayload);

    if (error) {
      const shouldRetryWithoutNewColumns =
        missingColumn(error, "keyword_raw") ||
        missingColumn(error, "keyword_normalized") ||
        missingColumn(error, "raw_payload");

      if (shouldRetryWithoutNewColumns) {
        const { error: fallbackError } = await sb
          .from("manychat_tag_events")
          .insert(removeColumns(tagEventPayload, ["keyword_raw", "keyword_normalized", "raw_payload"]));

        if (fallbackError) {
          console.error("Manychat webhook fallback insert error:", fallbackError);
          return NextResponse.json({ error: fallbackError.message }, { status: 500 });
        }
      } else {
        console.error("Manychat webhook insert error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (keywordNormalized) {
      const keywordEventPayload = {
        source: "manychat",
        source_event_id: keywordSourceEventId,
        event_type: "dm_keyword",
        client_key: adsClientKey,
        keyword_raw: keywordRaw,
        keyword_normalized: keywordNormalized,
        subscriber_id,
        subscriber_name: [first_name, last_name].filter(Boolean).join(" ") || "Unknown",
        setter_name: setterKey,
        event_at: normalizedEventAt,
        raw_payload: body,
      };

      const { error: keywordError } = await sb
        .from("ads_keyword_events")
        .insert(keywordEventPayload);

      if (keywordError) {
        if (duplicateEvent(keywordError)) {
          // ManyChat can retry webhooks. Duplicate source ids are safe to ignore.
        } else if (missingColumn(keywordError, "source_event_id")) {
          const { error: fallbackError } = await sb
            .from("ads_keyword_events")
            .insert(removeColumns(keywordEventPayload, ["source_event_id"]));

          if (fallbackError && !duplicateEvent(fallbackError)) {
            console.error("Manychat keyword event fallback insert error:", fallbackError);
          }
        } else {
          console.error("Manychat keyword event insert error:", keywordError);
        }
      }
    }

    const sync = await syncManychatEventToGhl({
      subscriberId: subscriber_id,
      firstName: first_name,
      lastName: last_name,
      instagramHandle: instagram_handle,
      tagName: tag_name,
      client,
      setterName: setterKey,
      eventAt: normalizedEventAt,
    });

    return NextResponse.json({ status: "ok", sync });
  } catch (err) {
    console.error("Manychat webhook error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 }
    );
  }
}

// GET for health check / testing
export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "Manychat webhook endpoint. POST tag events here.",
    expected_body: {
      subscriber_id: "{{contact.id}}",
      first_name: "{{first_name}}",
      last_name: "{{last_name}}",
      instagram_handle: "{{username}}",
      tag_name: "new_lead | lead_engaged | call_link_sent | sub_link_sent",
      client: "Tyson Sonnek | Keith Holland | Zoe and Emily",
      keyword: "{{custom field: keyword}}",
      setter_name: "(optional) amara | kelechi | gideon | debbie",
      event_at: "optional ISO timestamp",
    },
    auth_header: "X-Webhook-Secret: <MANYCHAT_WEBHOOK_SECRET> (optional but recommended)",
  });
}
