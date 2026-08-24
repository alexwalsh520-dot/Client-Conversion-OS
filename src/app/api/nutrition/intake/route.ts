/**
 * POST /api/nutrition/intake
 *
 * Public endpoint. Receives nutrition intake submissions from
 * cc-intake-form.vercel.app and writes them directly to
 * `nutrition_intake_forms` in Supabase. Bypasses the Google Form +
 * response sheet pipeline that had been middlewaring these intakes,
 * which broke when the sheet owner's Drive filled up.
 *
 * Protection:
 *   - CORS locked to the intake origin (plus localhost for dev)
 *   - Origin header check (blocks trivial cross-site abuse; not a
 *     hardened defense against a determined attacker who can spoof
 *     Origin from a non-browser client, but stops drive-by scrapers)
 *   - Minimal shape validation (first_name and email required)
 *
 * On success: inserts the row, fires a fire-and-forget Slack DM to
 * Saeed, returns 201 with the inserted row id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { notifyAdminOfNewIntake } from "@/lib/nutrition/notify-new-intake";
import { upsertCoachingContact } from "@/lib/ghl/coaching-contacts";

export const runtime = "nodejs";
export const maxDuration = 15;

// Origins allowed to POST here. cc-intake-form is the live form;
// localhost is for local testing. Add branch-preview aliases here if
// coaches need to submit from a preview URL.
const ALLOWED_ORIGINS = new Set<string>([
  "https://cc-intake-form.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://cc-intake-form.vercel.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

/**
 * Whitelist of writable columns. Anything else in the payload is
 * silently dropped — the form can add junk keys and we won't blow up.
 */
const FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip_code",
  "height",
  "current_weight",
  "goal_weight",
  "fitness_goal",
  "foods_enjoy",
  "foods_avoid",
  "allergies",
  "protein_preferences",
  "can_cook",
  "meal_count",
  "medications",
  "supplements",
  "sleep_hours",
  "water_intake",
  "daily_meals_description",
  "daily_meals_description_2",
  "medical_supervision_yn",
  "medical_supervision_detail",
] as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json(
      { error: "origin not allowed" },
      { status: 403, headers },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers });
  }

  const row: Record<string, string | number | null> = {};
  for (const key of FIELDS) {
    const raw = body[key];
    if (raw == null) continue;
    row[key] = typeof raw === "string" ? raw.trim() : String(raw).trim();
  }

  // Set the submission `timestamp` explicitly. When these rows came from the
  // Google Sheet sync this field was the Google Form submission time. Now
  // that we insert direct, we set it to server-now — the Coaching Hub's
  // "Unlinked Intake Forms" list treats a NULL timestamp as legacy/pre-Apr-1
  // and hides such rows by default.
  row.timestamp = new Date().toISOString();

  // age is an integer column, handle separately
  if (body.age != null && body.age !== "") {
    const parsed = parseInt(String(body.age), 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 130) {
      row.age = parsed;
    }
  }

  const firstName = String(row.first_name ?? "").trim();
  const email = String(row.email ?? "").trim();
  if (!firstName) {
    return NextResponse.json({ error: "first_name is required" }, { status: 400, headers });
  }
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400, headers });
  }

  const db = getServiceSupabase();

  // Detect first-ever submission BEFORE the upsert so we can gate the
  // GHL "Nutrition Intake Confirmation" email trigger to first-timers
  // only (per MAS request 2026-08-23). A row already existing for this
  // email means the client is re-submitting, and we silently update
  // without firing the confirmation email again.
  const { data: existingRow } = await db
    .from("nutrition_intake_forms")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  const isFirstSubmission = !existingRow;

  // Upsert on email — the table has a UNIQUE(email) constraint, so an
  // insert would fail when a client re-submits (e.g. after a coach asks
  // them to redo the form). Semantically the intake is the client's
  // current questionnaire state, so latest submission overwrites.
  const { data, error } = await db
    .from("nutrition_intake_forms")
    .upsert(row, { onConflict: "email" })
    .select("id")
    .single();

  if (error) {
    console.error("[api/nutrition/intake] upsert failed:", error);
    return NextResponse.json(
      { error: `could not save intake: ${error.message}` },
      { status: 500, headers },
    );
  }

  const insertedId = (data as { id: number }).id;

  // Await the Slack DM instead of fire-and-forget. In Vercel serverless,
  // once the response is returned the function instance can freeze
  // immediately, which was killing the DM before it ever started. The
  // Slack call is ~300-500ms; that's fine for a form submission and
  // guarantees the notification actually goes out.
  try {
    await notifyAdminOfNewIntake({
      first_name: firstName,
      last_name: String(row.last_name ?? ""),
      email,
      phone: String(row.phone ?? ""),
      fitness_goal: (row.fitness_goal as string | null) ?? null,
      current_weight: (row.current_weight as string | null) ?? null,
      intake_id: insertedId,
    });
  } catch (err) {
    console.warn("[api/nutrition/intake] notifyAdminOfNewIntake failed:", err);
  }

  // Fire the GHL "Nutrition Intake Confirmation" workflow, but only on
  // the client's very first submission. Resubmissions (upserts onto an
  // existing row) intentionally do not re-tag — the confirmation email
  // should feel like a one-time acknowledgement, not spam. Awaited so
  // Vercel doesn't freeze the function before the HTTP call goes out.
  if (isFirstSubmission) {
    try {
      const result = await upsertCoachingContact({
        email,
        firstName,
        lastName: String(row.last_name ?? ""),
        phone: (row.phone as string | undefined) ?? null,
        tags: ["ccos-intake-submitted"],
        customFields: {
          fitness_goal: (row.fitness_goal as string | undefined) ?? "",
          current_weight: (row.current_weight as string | undefined) ?? "",
          goal_weight: (row.goal_weight as string | undefined) ?? "",
        },
      });
      if (!result.ok && !result.skipped) {
        console.warn("[api/nutrition/intake] GHL upsert failed:", result.error);
      }
    } catch (err) {
      console.warn("[api/nutrition/intake] GHL upsert threw:", err);
    }
  }

  return NextResponse.json(
    { ok: true, id: insertedId },
    { status: 201, headers },
  );
}
