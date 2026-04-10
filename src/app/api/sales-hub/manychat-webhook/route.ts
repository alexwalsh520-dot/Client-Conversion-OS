import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { normalizeClientKey, syncManychatEventToGhl } from "@/lib/ghl-dm-sync";

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
 *
 * Optional fields for GHL sync:
 *   "instagram_handle": "prospect_handle"
 *   "event_at": "2026-04-10T04:15:00.000Z"
 */

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
      instagram_handle,
      event_at,
    } = body as {
      subscriber_id?: string;
      first_name?: string;
      last_name?: string;
      tag_name?: string;
      client?: string;
      setter_name?: string;
      instagram_handle?: string;
      event_at?: string;
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

    const { error } = await sb.from("manychat_tag_events").insert({
      subscriber_id,
      subscriber_name: [first_name, last_name].filter(Boolean).join(" ") || "Unknown",
      tag_name: tag_name.toLowerCase().trim(),
      client: clientKey,
      setter_name: setter_name?.toLowerCase().trim() || null,
      event_at: normalizedEventAt,
    });

    if (error) {
      console.error("Manychat webhook insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sync = await syncManychatEventToGhl({
      subscriberId: subscriber_id,
      firstName: first_name,
      lastName: last_name,
      instagramHandle: instagram_handle,
      tagName: tag_name,
      client,
      setterName: setter_name,
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
      setter_name: "(optional) amara | kelechi | gideon | debbie",
      event_at: "optional ISO timestamp",
    },
    auth_header: "X-Webhook-Secret: <MANYCHAT_WEBHOOK_SECRET> (optional but recommended)",
  });
}
