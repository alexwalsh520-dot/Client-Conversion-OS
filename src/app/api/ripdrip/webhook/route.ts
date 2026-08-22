import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * RipDrip Webhook — receives lead-status events from the RipDrip AI setter.
 *
 * RipDrip POSTs a JSON body with an X-RipDrip-Signature header (HMAC-SHA256
 * of the raw body using the endpoint's secret). Every event is stored raw in
 * public.ripdrip_events; the lead's Instagram username is the identity key
 * that re-welds bookings to conversations (the 2026-08-13 attribution break).
 *
 * Until RIPDRIP_WEBHOOK_SECRET is set in the environment, events are stored
 * with signature_valid = null. With the secret set, verification runs on
 * every event but enforcement is SOFT: failures are stored flagged, not
 * rejected, until real events prove RipDrip's signing format end to end.
 */

export const runtime = "nodejs";

function signatureMatches(raw: string, signature: string, secret: string): boolean {
  const mac = createHmac("sha256", secret).update(raw, "utf8");
  const digestHex = mac.digest("hex");
  const provided = signature.replace(/^sha256=/i, "").trim();
  const candidates = [digestHex, Buffer.from(digestHex, "hex").toString("base64")];
  for (const expected of candidates) {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Depth-first search for the first non-empty string under any of these keys. */
function findString(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== "object") return null;
  const targetKeys = new Set(keys);
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (targetKeys.has(key) && typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!raw || raw.length > 1_000_000) {
    return NextResponse.json({ error: "empty or oversized body" }, { status: 400 });
  }

  // SOFT ENFORCEMENT for now: a bad or missing signature is stored and
  // flagged rather than rejected, because we have not yet seen RipDrip's
  // first real event and cannot risk dropping lead data over a format
  // mismatch. The stored signature_header proves their format; once real
  // events verify as valid, flip this to a hard 401 reject.
  const secret = process.env.RIPDRIP_WEBHOOK_SECRET || "";
  const signature = req.headers.get("x-ripdrip-signature") || "";
  let signatureValid: boolean | null = null;
  if (secret) {
    signatureValid = Boolean(signature) && signatureMatches(raw, signature, secret);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }

  const username = findString(payload, [
    "username",
    "lead_username",
    "leadUsername",
    "handle",
    "ig_username",
    "instagram_username",
  ]);

  const db = getServiceSupabase();
  const { error } = await db.from("ripdrip_events").insert({
    event_type: findString(payload, ["event", "event_type", "eventType", "type", "status"]),
    lead_username: username ? username.replace(/^@/, "").toLowerCase() : null,
    lead_name: findString(payload, ["name", "lead_name", "leadName", "full_name", "fullName"]),
    platform: findString(payload, ["platform"]),
    lead_email: findString(payload, ["email", "lead_email", "leadEmail"]),
    conversation_link: findString(payload, [
      "conversation_link",
      "conversationLink",
      "conversation_url",
      "conversationUrl",
    ]),
    signature_valid: signatureValid,
    signature_header: signature || null,
    payload,
  });
  if (error) {
    return NextResponse.json({ error: `store failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Health check so the URL can be sanity-tested in a browser. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "ripdrip-webhook",
    signatureCheck: process.env.RIPDRIP_WEBHOOK_SECRET ? "on" : "off (set RIPDRIP_WEBHOOK_SECRET)",
  });
}
