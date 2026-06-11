// /api/ads-leaderboard/entries  (ADMIN-authed)
// GET   -> all contest entries + computed leaderboard metrics for launched ads.
// POST  -> create a new entry/invite, returns the contestant compete URL.
// PATCH -> update an entry (link a live ad_id/creator, change status, etc.).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdMetrics, type AdMetrics } from "@/lib/ads-leaderboard/metrics";
import { generateContestToken, competeUrl } from "@/lib/ads-leaderboard/sonnet-framework";
import { getLiveAdsDashboard } from "@/lib/live-ads";

// Best-effort ad_id -> daily budget label from the live Meta dashboard. Only
// called when launched ads exist, so the leaderboard never pays the Meta latency
// while every entry is still pre-launch.
async function getBudgetMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const live = await getLiveAdsDashboard();
    for (const acct of live.accounts) {
      for (const camp of acct.campaigns) {
        for (const adset of camp.adSets) {
          for (const ad of adset.ads) {
            if (adset.dailyBudget) map[ad.id] = adset.dailyBudget;
          }
        }
      }
    }
  } catch {
    /* budget is optional — leaderboard still renders spend/ROAS without it */
  }
  return map;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRY_COLUMNS =
  "id, token, client_id, client_name, creator_key, contestant_name, contestant_email, status, step, intake, script, r2_key, video_url, content_type, file_size, submitted_at, ad_id, ad_account_id, created_at, updated_at";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const { data: entries, error } = await db
    .from("ad_contest_entries")
    .select(ENTRY_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = entries ?? [];
  const adIds = rows.map((r) => r.ad_id).filter(Boolean) as string[];
  const [metrics, budgets] = await Promise.all([
    getAdMetrics(db, adIds).catch(() => ({} as Record<string, AdMetrics>)),
    adIds.length > 0 ? getBudgetMap() : Promise.resolve({} as Record<string, string>),
  ]);

  const withMetrics = rows.map((r) => {
    const m = r.ad_id ? metrics[r.ad_id] ?? null : null;
    const budget = r.ad_id ? budgets[r.ad_id] ?? null : null;
    return { ...r, metrics: m ? { ...m, budget } : null };
  });

  return NextResponse.json({ entries: withMetrics });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId != null ? Number(body.clientId) : null;
  const clientName = body.clientName ? String(body.clientName).trim() : null;
  const creatorKey = body.creatorKey ? String(body.creatorKey).trim() : null;
  const contestantName = body.contestantName ? String(body.contestantName).trim() : null;

  const token = generateContestToken();
  const db = getServiceSupabase();

  const { data, error } = await db
    .from("ad_contest_entries")
    .insert({
      token,
      client_id: Number.isFinite(clientId) ? clientId : null,
      client_name: clientName,
      creator_key: creatorKey,
      contestant_name: contestantName,
      created_by: session.user.email,
    })
    .select(ENTRY_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data, url: competeUrl(token) });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const id = body.id ? String(body.id) : "";
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Whitelist the admin-editable fields.
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.ad_id !== undefined) update.ad_id = body.ad_id ? String(body.ad_id).trim() : null;
  if (body.ad_account_id !== undefined)
    update.ad_account_id = body.ad_account_id ? String(body.ad_account_id).trim() : null;
  if (body.creator_key !== undefined)
    update.creator_key = body.creator_key ? String(body.creator_key).trim() : null;
  if (body.client_id !== undefined)
    update.client_id = body.client_id != null ? Number(body.client_id) : null;
  if (body.client_name !== undefined)
    update.client_name = body.client_name ? String(body.client_name).trim() : null;
  if (body.status !== undefined) update.status = String(body.status);

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("ad_contest_entries")
    .update(update)
    .eq("id", id)
    .select(ENTRY_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}
