// GET /api/lead-gen/health — Debug endpoint (no auth required)
// Tests each layer: env vars, Supabase connection, brand_bank query
// DELETE THIS AFTER DEBUGGING

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const checks: Record<string, string> = {};

  // 1. Check env vars
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  checks.supabase_url = url ? `SET (${url.slice(0, 30)}...)` : "MISSING";
  checks.service_role_key = key ? `SET (${key.slice(0, 10)}...)` : "MISSING";

  if (!url || !key) {
    return NextResponse.json({ checks, error: "Missing env vars" }, { status: 500 });
  }

  // 2. Test Supabase connection
  try {
    const db = createClient(url, key);
    const { data, error, count } = await db
      .from("brand_bank")
      .select("handle, category", { count: "exact" })
      .eq("is_active", true)
      .limit(3);

    checks.brand_bank_query = error
      ? `ERROR: ${error.message} (${error.code})`
      : `OK — ${count} active brands, sample: ${(data || []).map((b) => b.handle).join(", ")}`;

    // 3. Test scraped_profiles
    const { error: spErr, count: spCount } = await db
      .from("scraped_profiles")
      .select("*", { count: "exact", head: true });

    checks.scraped_profiles = spErr
      ? `ERROR: ${spErr.message}`
      : `OK — ${spCount} rows`;

    // 4. Test delivered_emails
    const { error: deErr, count: deCount } = await db
      .from("delivered_emails")
      .select("*", { count: "exact", head: true });

    checks.delivered_emails = deErr
      ? `ERROR: ${deErr.message}`
      : `OK — ${deCount} rows`;

  } catch (err: any) {
    checks.supabase_connection = `EXCEPTION: ${err?.message}`;
  }

  return NextResponse.json({ checks, ts: new Date().toISOString() });
}
