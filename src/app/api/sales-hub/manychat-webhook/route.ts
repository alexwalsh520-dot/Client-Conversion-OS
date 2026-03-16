import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

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
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      subscriber_id,
      first_name,
      last_name,
      tag_name,
      client,
      setter_name,
    } = body as {
      subscriber_id?: string;
      first_name?: string;
      last_name?: string;
      tag_name?: string;
      client?: string;
      setter_name?: string;
    };

    if (!tag_name || !client) {
      return NextResponse.json(
        { error: "tag_name and client are required" },
        { status: 400 }
      );
    }

    const sb = getServiceSupabase();

    const { error } = await sb.from("manychat_tag_events").insert({
      subscriber_id: subscriber_id || "unknown",
      subscriber_name: [first_name, last_name].filter(Boolean).join(" ") || "Unknown",
      tag_name: tag_name.toLowerCase().trim(),
      client: client.toLowerCase().trim(),
      setter_name: setter_name?.toLowerCase().trim() || null,
      event_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Manychat webhook insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: "ok" });
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
      subscriber_id: "{{user_id}}",
      first_name: "{{first_name}}",
      last_name: "{{last_name}}",
      tag_name: "new_lead | lead_engaged | call_link_sent | sub_link_sent",
      client: "tyson | keith",
      setter_name: "(optional) amara | kelechi | gideon | debbie",
    },
  });
}
