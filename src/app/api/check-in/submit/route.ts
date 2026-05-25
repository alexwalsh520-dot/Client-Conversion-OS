/**
 * POST /api/check-in/submit — public weekly check-in submission.
 *
 * This and /api/testimonials/lead are the only CCOS API routes that
 * accept unauthenticated POSTs from the public internet. Hardening:
 *   1. Honeypot field `website` — bots fill, real users don't. Silent
 *      200 drop so the bot can't tell.
 *   2. IP rate limit: max 3 submissions per IP per rolling hour
 *      (mirrors testimonial_leads).
 *   3. Per-client rate limit: max 1 submission per client per 24h
 *      (so a single client can't spam-skew their own running avg).
 *   4. Required-field validation + numeric range CHECKs (also enforced
 *      at the DB layer).
 *   5. Score computed server-side — never trust a client-supplied score.
 *
 * On success: inserts row and returns 200. Manager alerting happens
 * via the weekly digest cron (Sun 4pm PKT), not per-form.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { computeScore0to100 } from "@/lib/check-in/types";

export const runtime = "nodejs";
export const maxDuration = 10;

const MAX_PER_IP_PER_HOUR = 3;
const MIN_HOURS_BETWEEN_CLIENT_SUBMISSIONS = 24;

interface PostBody {
  clientId?: number;
  q1?: number;
  q2?: number;
  q3?: number;
  q4?: number;
  q5?: string;
  /** Honeypot — must be empty for real users. */
  website?: string;
}

function getClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

function isInt(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Honeypot — silent 200 so the bot believes it worked.
  if (body.website && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Validate client picker
  if (!body.clientId || typeof body.clientId !== "number" || body.clientId <= 0) {
    return NextResponse.json(
      { error: "Please select your name from the dropdown." },
      { status: 400 }
    );
  }

  // Validate numeric questions. Q1 is 0-10, Q2-Q4 are 1-10.
  if (!isInt(body.q1, 0, 10)) {
    return NextResponse.json({ error: "Q1 must be 0-10." }, { status: 400 });
  }
  if (!isInt(body.q2, 1, 10)) {
    return NextResponse.json({ error: "Q2 must be 1-10." }, { status: 400 });
  }
  if (!isInt(body.q3, 1, 10)) {
    return NextResponse.json({ error: "Q3 must be 1-10." }, { status: 400 });
  }
  // Note: column was renamed q3_adherence → q3_lifestyle in migration
  // 035 to reflect the question pivot from program-adherence to
  // nutrition+sleep. The payload field is still `q3` from the client
  // so existing callers don't need updating.
  if (!isInt(body.q4, 1, 10)) {
    return NextResponse.json({ error: "Q4 must be 1-10." }, { status: 400 });
  }

  // Q5 optional, capped at 4000 chars (matches testimonials)
  const q5 = body.q5?.trim() || null;
  if (q5 && q5.length > 4000) {
    return NextResponse.json({ error: "Message too long." }, { status: 400 });
  }

  const db = getServiceSupabase();
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;

  // IP rate limit (DB-backed since serverless is stateless)
  if (ip) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await db
      .from("client_check_ins")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gt("submitted_at", oneHourAgo);
    if (countErr) {
      console.warn(
        "[api/check-in/submit] ip rate-limit lookup failed:",
        countErr.message
      );
      // Fall through — better to accept than reject due to our error.
    } else if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) {
      // Mirror honeypot behavior to avoid letting attackers probe the limit.
      return NextResponse.json({ ok: true });
    }
  }

  // Per-client 24h rate limit. Different UX than the IP limit: this one
  // gets a user-visible error because the client SHOULD know they
  // already submitted today.
  const oneDayAgo = new Date(
    Date.now() - MIN_HOURS_BETWEEN_CLIENT_SUBMISSIONS * 60 * 60 * 1000
  ).toISOString();
  const { count: recentForClient } = await db
    .from("client_check_ins")
    .select("id", { count: "exact", head: true })
    .eq("client_id", body.clientId)
    .gt("submitted_at", oneDayAgo);
  if ((recentForClient ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "You already submitted a check-in in the last 24 hours. Please come back tomorrow.",
      },
      { status: 429 }
    );
  }

  // Look up the client to snapshot name / email / coach. If the client
  // was deleted between dropdown render and submit, fail closed.
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, email, coach_name")
    .eq("id", body.clientId)
    .single();
  if (clientErr || !client) {
    return NextResponse.json(
      { error: "We could not find your record. Please refresh and try again." },
      { status: 400 }
    );
  }

  // Compute score server-side. Never trust the client.
  const score = computeScore0to100(body.q1, body.q2, body.q3, body.q4);

  const { data: inserted, error } = await db
    .from("client_check_ins")
    .insert({
      client_id: client.id,
      client_name: client.name,
      client_email: client.email,
      coach_name: client.coach_name,
      q1_overall: body.q1,
      q2_strength: body.q2,
      q3_lifestyle: body.q3,
      q4_progress: body.q4,
      q5_open_response: q5,
      score_0_100: score,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[api/check-in/submit] insert failed:", error?.message);
    return NextResponse.json(
      { error: "Could not save your submission. Please try again." },
      { status: 500 }
    );
  }

  // Per-form Slack alert was removed when the manager workflow moved
  // to a Sunday weekly digest. See /api/cron/check-in-weekly-digest.

  return NextResponse.json({ ok: true, score });
}
