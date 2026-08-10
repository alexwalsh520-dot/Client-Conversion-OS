import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { creatorKeyFromText } from "@/lib/creators";
import { normalizeInstagramHandle } from "@/lib/instagram-connections";

/**
 * Skool Signup Webhook — receives new Skool member signups from Zapier.
 *
 * Zapier fires after the "create GHL contact" step in the Skool signup Zap,
 * so the payload carries both the Skool answers and the GHL contact id.
 * We match the member's Instagram handle against instagram_lead_links
 * (ManyChat already stores every DM lead's handle) and, on a hit, write
 * manychat_contact_links so the existing GHL appointment webhook resolves
 * the ad keyword when a phone setter books this contact. That is the whole
 * phone-setter attribution bridge: no setter ever touches attribution.
 *
 * Expected body (configured in the Zapier POST step):
 * {
 *   "client": "jake",                       // hard-coded per Zap
 *   "first_name": "{{skool first name}}",
 *   "last_name": "{{skool last name}}",
 *   "phone": "{{skool phone answer}}",
 *   "instagram_handle": "{{skool IG answer}}",
 *   "ghl_contact_id": "{{GHL create-contact step id}}",
 *   "email": ""                             // optional, Skool rarely sends it
 * }
 */

function readString(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Skool answers are free text: people paste profile URLs, add spaces, or
 * include the @. Reduce to the bare handle before the standard normalizer.
 */
function cleanHandleAnswer(raw: string | null) {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  value = value.replace(/^(www\.)?instagram\.com\//, "");
  value = value.split(/[/?\s]/)[0] || "";
  return normalizeInstagramHandle(value);
}

export async function POST(req: NextRequest) {
  const expectedSecret =
    process.env.SKOOL_WEBHOOK_SECRET || process.env.MANYCHAT_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers.get("x-webhook-secret");
    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientRaw = readString(body, ["client", "client_key", "creator"]);
  const client = creatorKeyFromText(clientRaw);
  if (!client) {
    return NextResponse.json(
      { error: `Unknown client: ${clientRaw ?? "(missing)"}` },
      { status: 400 }
    );
  }

  const handleRaw = readString(body, [
    "instagram_handle",
    "instagram",
    "ig_handle",
    "handle",
  ]);
  const handle = cleanHandleAnswer(handleRaw);
  const ghlContactId = readString(body, ["ghl_contact_id", "contact_id", "contactId"]);

  const supabase = getServiceSupabase();

  // Find the ManyChat subscriber behind this handle for this creator.
  let matchedSubscriberId: string | null = null;
  let matchedLinkClient: string | null = null;
  let matchCandidates = 0;
  if (handle) {
    const { data: links, error } = await supabase
      .from("instagram_lead_links")
      .select("client, manychat_subscriber_id, last_manychat_event_at")
      .eq("instagram_handle", handle)
      .not("manychat_subscriber_id", "is", null);

    if (error) {
      console.error("[skool-signup-webhook] lead-link lookup error:", error);
    } else {
      const candidates = (links ?? [])
        .filter((row) => creatorKeyFromText(row.client) === client)
        .sort((a, b) => {
          const ta = a.last_manychat_event_at
            ? new Date(a.last_manychat_event_at).getTime()
            : 0;
          const tb = b.last_manychat_event_at
            ? new Date(b.last_manychat_event_at).getTime()
            : 0;
          return tb - ta;
        });
      matchCandidates = candidates.length;
      if (candidates[0]) {
        matchedSubscriberId = candidates[0].manychat_subscriber_id;
        matchedLinkClient = candidates[0].client;
      }
    }
  }

  // On a match, point the subscriber's contact link at the Zapier-created
  // contact. The GHL appointment webhook resolves keyword via this table,
  // so from here the setter's manual booking inherits the ad keyword.
  let replacedGhlContactId: string | null = null;
  if (matchedSubscriberId && matchedLinkClient && ghlContactId) {
    const { data: existing } = await supabase
      .from("manychat_contact_links")
      .select("ghl_contact_id")
      .eq("client", matchedLinkClient)
      .eq("subscriber_id", matchedSubscriberId)
      .maybeSingle();

    if (existing?.ghl_contact_id && existing.ghl_contact_id !== ghlContactId) {
      replacedGhlContactId = existing.ghl_contact_id;
    }

    const { error: linkError } = await supabase.from("manychat_contact_links").upsert(
      {
        client: matchedLinkClient,
        subscriber_id: matchedSubscriberId,
        ghl_contact_id: ghlContactId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client,subscriber_id" }
    );
    if (linkError) {
      console.error("[skool-signup-webhook] contact-link upsert error:", linkError);
    }
  }

  const matched = Boolean(matchedSubscriberId && ghlContactId);
  const signupRow = {
    client,
    first_name: readString(body, ["first_name", "firstName"]),
    last_name: readString(body, ["last_name", "lastName"]),
    email: readString(body, ["email"]),
    phone: readString(body, ["phone", "phone_number"]),
    instagram_handle_raw: handleRaw,
    instagram_handle_normalized: handle,
    ghl_contact_id: ghlContactId,
    matched_subscriber_id: matchedSubscriberId,
    matched_link_client: matchedLinkClient,
    match_method: matched ? "handle" : "none",
    match_candidates: matchCandidates,
    replaced_ghl_contact_id: replacedGhlContactId,
    matched_at: matched ? new Date().toISOString() : null,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  const { error: signupError } = ghlContactId
    ? await supabase
        .from("skool_signups")
        .upsert(signupRow, { onConflict: "ghl_contact_id" })
    : await supabase.from("skool_signups").insert(signupRow);

  if (signupError) {
    console.error("[skool-signup-webhook] signup insert error:", signupError);
    return NextResponse.json({ error: signupError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    client,
    matched,
    match_method: signupRow.match_method,
    matched_subscriber_id: matchedSubscriberId,
    match_candidates: matchCandidates,
  });
}

export async function GET(req: NextRequest) {
  const expectedSecret =
    process.env.SKOOL_WEBHOOK_SECRET || process.env.MANYCHAT_WEBHOOK_SECRET;
  const providedSecret = req.nextUrl.searchParams.get("secret");

  // Match-rate health read (secret required so stats stay private).
  if (expectedSecret && providedSecret === expectedSecret) {
    const supabase = getServiceSupabase();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("skool_signups")
      .select("client, match_method")
      .gte("created_at", since);
    const rows = data ?? [];
    const byClient: Record<string, { total: number; matched: number }> = {};
    for (const row of rows) {
      const bucket = (byClient[row.client] ||= { total: 0, matched: 0 });
      bucket.total += 1;
      if (row.match_method !== "none") bucket.matched += 1;
    }
    // Empty denominator reads perfect: nothing-to-grade is not a failure.
    const stats = Object.entries(byClient).map(([clientKey, counts]) => ({
      client: clientKey,
      signups_30d: counts.total,
      matched: counts.matched,
      match_pct:
        counts.total === 0 ? 100 : Math.round((100 * counts.matched) / counts.total),
    }));
    return NextResponse.json({ ok: true, window_days: 30, stats });
  }

  return NextResponse.json({
    ok: true,
    usage: "POST Skool signups here from the Zapier step after the GHL create-contact step.",
    expected_body: {
      client: "jake",
      first_name: "{{skool first name}}",
      last_name: "{{skool last name}}",
      phone: "{{skool phone answer}}",
      instagram_handle: "{{skool instagram answer}}",
      ghl_contact_id: "{{ghl create-contact step contact id}}",
    },
    auth_header: "X-Webhook-Secret: <SKOOL_WEBHOOK_SECRET or MANYCHAT_WEBHOOK_SECRET>",
  });
}
