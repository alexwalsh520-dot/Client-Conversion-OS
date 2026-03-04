// GET /api/lead-gen/history — List past lead gen runs (without full results payload)

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();

  const { data: runs, error } = await db
    .from("lead_jobs")
    .select("id, status, mode, created_at, scraped_count, lead_count, email_count, config")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: runs || [] });
}
