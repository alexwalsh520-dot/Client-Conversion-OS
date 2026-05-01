/**
 * GET /api/coaching/expenses/settings
 * PUT /api/coaching/expenses/settings  body: { invoice_rate_per_client: number }
 *
 * Reads / updates the editable per-client rate that drives both the
 * Invoice Calculation total on the Expenses tab and the Cash Reserve
 * calculation at the bottom of the same tab.
 *
 * Stored as plain text in the `app_settings` table (key=invoice_rate_per_client).
 * Auth: any signed-in coach. Updates record `updated_by` for the audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

const SETTING_KEY = "invoice_rate_per_client";
const DEFAULT_RATE = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getServiceSupabase();
  const { data } = await db
    .from("app_settings")
    .select("value, updated_at, updated_by")
    .eq("key", SETTING_KEY)
    .single();

  const row = data as
    | { value: string; updated_at: string; updated_by: string | null }
    | null;

  // If the seed row is somehow missing, fall back to the default — UI
  // never breaks because of a missing config row.
  const rate = row ? Number(row.value) : DEFAULT_RATE;
  return NextResponse.json({
    invoice_rate_per_client: Number.isFinite(rate) ? rate : DEFAULT_RATE,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { invoice_rate_per_client?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const v = body.invoice_rate_per_client;
  // Sane bounds: not zero, not negative, not absurd. We're storing it as
  // text so the validation here is the contract.
  const rate = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) {
    return NextResponse.json(
      {
        error:
          "invoice_rate_per_client must be a positive number not greater than 1000",
      },
      { status: 400 },
    );
  }

  const db = getServiceSupabase();
  const { error } = await db.from("app_settings").upsert(
    {
      key: SETTING_KEY,
      value: String(rate),
      updated_at: new Date().toISOString(),
      updated_by: session.user.email,
    },
    { onConflict: "key" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    invoice_rate_per_client: rate,
    updated_at: new Date().toISOString(),
    updated_by: session.user.email,
  });
}
