/**
 * POST /api/referrals
 *
 * Records a new client referral submitted by a coach through the CCOS
 * Referrals tab. Writes the row directly to the Fitness Referral Tracker
 * Google Sheet (source of truth for the closers) and DMs Saeed via the
 * coaching Slack bot.
 *
 * Body: { existingClientId: number, refereeName: string, refereePhone: string }
 *
 * The sheet write is BLOCKING and its result determines success/failure —
 * if the sheet write fails the coach retries. The Slack DM is
 * fire-and-forget, so a Slack outage never blocks recording the referral.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { appendReferralToSheet } from "@/lib/sheets";
import { notifyAdminOfNewReferral } from "@/lib/coaching/notify-new-referral";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    existingClientId?: number;
    refereeName?: string;
    refereePhone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const clientId = Number(body.existingClientId);
  const refereeName = (body.refereeName ?? "").trim();
  const refereePhone = (body.refereePhone ?? "").trim();

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json(
      { error: "existingClientId is required" },
      { status: 400 },
    );
  }
  if (!refereeName) {
    return NextResponse.json({ error: "refereeName is required" }, { status: 400 });
  }
  if (!refereePhone) {
    return NextResponse.json({ error: "refereePhone is required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, email, coach_name, status")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr) {
    return NextResponse.json({ error: clientErr.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  try {
    await appendReferralToSheet({
      existingClientName: client.name,
      existingClientEmail: client.email ?? "",
      refereeName,
      refereePhone,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/referrals] sheet append failed:", msg);
    return NextResponse.json(
      { error: `Could not write to referral tracker: ${msg}` },
      { status: 502 },
    );
  }

  void notifyAdminOfNewReferral({
    existingClientName: client.name,
    existingClientEmail: client.email ?? "",
    existingClientCoach: client.coach_name ?? null,
    refereeName,
    refereePhone,
  }).catch((err) => {
    console.warn("[api/referrals] notifyAdminOfNewReferral failed:", err);
  });

  return NextResponse.json({ ok: true });
}
