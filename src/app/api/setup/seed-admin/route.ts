import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

const ALL_TABS = [
  "/",
  "/mozi-metrics",
  "/sales",
  "/coaching",
  "/onboarding",
  "/ads",
  "/studio",
  "/outreach",
  "/leads",
  "/outreach-runs",
  "/sales-hub",
  "/media-buyer",
  "/intelligence",
  "/log",
  "/settings",
];

/**
 * POST /api/setup/seed-admin
 * Seeds the app_users table with admin users.
 * Creates the table if it doesn't exist.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = (body.email || "").toLowerCase().trim();

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const sb = getServiceSupabase();

  // First check if app_users table exists by trying to query it
  const { error: checkError } = await sb
    .from("app_users")
    .select("id")
    .limit(1);

  if (checkError && checkError.message.includes("does not exist")) {
    return NextResponse.json({
      error: "app_users table does not exist. Create it first.",
      sql: `CREATE TABLE IF NOT EXISTS app_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'client',
  allowed_tabs TEXT[] DEFAULT ARRAY['/'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service role all" ON app_users USING (true) WITH CHECK (true);`,
    }, { status: 500 });
  }

  // Try upsert — insert or update if exists
  const { data, error } = await sb
    .from("app_users")
    .upsert(
      {
        email,
        name: body.name || "Admin",
        role: "admin",
        allowed_tabs: ALL_TABS,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data, status: "admin seeded" });
}

export async function GET() {
  return NextResponse.json({
    description: "POST with {email, name} to seed an admin user",
  });
}
