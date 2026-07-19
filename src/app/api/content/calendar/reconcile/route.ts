import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { reconcileCreator } from "@/lib/content/calendar-reconcile";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// "Reconcile now" from the operator tab — the same routine the hourly cron runs, for one creator.
// Session-only: this is an operator action, never exposed on the creator's token page.
export async function POST(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creator = (new URL(req.url).searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }

  const origin = new URL(req.url).origin; // same-origin, authenticated user request (not a cron)
  const sb = getServiceSupabase();
  const result = await reconcileCreator(sb, creator, {
    ingest: async () => {
      const r = await fetch(`${origin}/api/content/ingest?creator=${creator}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (!r.ok || body?.ok === false) throw new Error(`ingest failed (${r.status})`);
    },
  });
  return NextResponse.json({ ok: true, ...result });
}
