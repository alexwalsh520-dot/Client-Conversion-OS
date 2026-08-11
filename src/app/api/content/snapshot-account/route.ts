import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS, fetchAccountStats } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Today's date in America/New_York as YYYY-MM-DD.
  const snapshotDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const sb = getServiceSupabase();
  const snapshots: Array<{ creator: string; followers_count: number }> = [];
  const skipped: string[] = [];

  for (const creator of CONTENT_CREATORS) {
    const stats = await fetchAccountStats(creator);
    if (!stats) {
      skipped.push(creator);
      continue;
    }
    const { error } = await sb.schema("warehouse").from("creator_account_snapshots").upsert(
      {
        client_key: creator,
        snapshot_date: snapshotDate,
        followers_count: stats.followers_count,
        following_count: stats.follows_count,
        media_count: stats.media_count,
        source: "graph",
      },
      { onConflict: "client_key,snapshot_date" }
    );
    if (error) {
      skipped.push(creator);
      continue;
    }
    snapshots.push({ creator, followers_count: stats.followers_count });
  }

  return NextResponse.json({ ok: true, snapshots, skipped });
}
