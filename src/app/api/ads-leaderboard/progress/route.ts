// /api/ads-leaderboard/progress  (PUBLIC, token-validated)
// GET  ?token= -> the contestant's entry, so they always resume where they left.
// POST          -> save progress (step, intake answers, contestant identity).
//
// Returns only the fields the public flow needs — never created_by, ad_id, etc.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

const PUBLIC_COLUMNS =
  "id, token, contestant_name, contestant_email, status, step, intake, script, r2_key, video_url, submitted_at";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("ad_contest_entries")
    .select(PUBLIC_COLUMNS)
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  return NextResponse.json({ entry: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: row, error: findErr } = await db
    .from("ad_contest_entries")
    .select("id, status")
    .eq("token", token)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  if (row.status === "submitted" || row.status === "live") {
    // Already done — don't let a late save clobber a submission.
    return NextResponse.json({ ok: true, locked: true });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.step !== undefined) update.step = Number(body.step) || 0;
  if (body.intake !== undefined && typeof body.intake === "object") update.intake = body.intake;
  if (body.contestantName !== undefined)
    update.contestant_name = body.contestantName ? String(body.contestantName).trim() : null;
  if (body.contestantEmail !== undefined)
    update.contestant_email = body.contestantEmail ? String(body.contestantEmail).trim() : null;
  // Allow the flow to advance status through the early lifecycle only.
  if (body.status !== undefined && ["draft", "intake_done", "script_ready", "recording"].includes(body.status)) {
    update.status = body.status;
  }

  const { error: updErr } = await db.from("ad_contest_entries").update(update).eq("id", row.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
