// POST /api/lead-gen — Create a new lead gen job
// Just creates the job in Supabase with status="pending", returns jobId.
// The poll endpoint drives the entire state machine.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

// Default brand accounts
const DEFAULT_BRAND_ACCOUNTS = [
  "gymshark", "1stphorm", "youngla", "darcsport", "alphaleteathletics",
  "nvgtn", "ghostlifestyle", "rawgear", "gymreapers", "gorillawear",
  "musclenation", "buffbunnyco", "rabornyofficial",
];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const targetEmails = body.targetEmails || 100;

  // Accept custom brands from body, merge with defaults (deduplicated)
  const customBrands: string[] = Array.isArray(body.customBrands) ? body.customBrands.map((b: string) => b.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];
  const BRAND_ACCOUNTS = [...new Set([...DEFAULT_BRAND_ACCOUNTS, ...customBrands])];

  const db = getServiceSupabase();

  // Get previously delivered emails count for display
  const { count: deliveredCount } = await db
    .from("delivered_emails")
    .select("*", { count: "exact", head: true });

  const { data: job, error: dbErr } = await db.from("lead_jobs").insert({
    status: "pending",
    mode: "quick",
    config: { brandAccounts: BRAND_ACCOUNTS, targetEmails },
    target_emails: targetEmails,
    current_brand_index: 0,
    current_brand: BRAND_ACCOUNTS[0],
    scrape_run_id: "",
    scrape_dataset_id: "",
    scrape_actor_index: 0,
    enrich_run_id: "",
    enrich_dataset_id: "",
    found_leads: [],
    brands_completed: [],
    batch_number: 0,
    scraped_count: 0,
    activity_log: [
      {
        ts: new Date().toISOString(),
        type: "system",
        message: `Job created. Target: ${targetEmails} emails. ${BRAND_ACCOUNTS.length} brands queued.`,
      },
      {
        ts: new Date().toISOString(),
        type: "system",
        message: `${deliveredCount || 0} emails previously delivered (will be skipped).`,
      },
    ],
  }).select("id").single();

  if (dbErr) {
    return NextResponse.json({ error: `DB error: ${dbErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    jobId: job?.id || "",
    brands: BRAND_ACCOUNTS,
    targetEmails,
    previouslyDelivered: deliveredCount || 0,
  });
}
