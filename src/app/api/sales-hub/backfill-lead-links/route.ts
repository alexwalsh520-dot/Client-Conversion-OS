import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { upsertInstagramLeadIdentity } from "@/lib/instagram-connections";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Backfill / repair the ManyChat <-> Instagram identity bridge.
 *
 * Instagram message webhooks only carry the numeric IGSID, so historical inbound
 * messages may have a lead link with no instagram_user_id -> manychat_subscriber_id
 * join. This walks recent inbound senders, resolves each IGSID -> @handle, and stamps
 * it onto the ManyChat link (via upsertInstagramLeadIdentity) so response-time
 * attribution can pair the DM with the assigned setter.
 *
 * Auth: requires CRON_SECRET (header `x-cron-secret` or `?secret=`). Read-tolerant —
 * never throws on a single resolve failure.
 */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const provided =
    req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret") || "";
  return provided === secret;
}

async function run(req: NextRequest) {
  const sb = getServiceSupabase();
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") || "3"), 1), 90);
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || "50"), 1), 300);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: msgs, error } = await sb
    .from("dm_conversation_messages")
    .select("client, subscriber_id, sent_at")
    .eq("direction", "inbound")
    .gte("sent_at", sinceIso)
    .order("sent_at", { ascending: false })
    .limit(limit * 6);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One resolve per unique person, newest first, capped at `limit`.
  const seen = new Set<string>();
  const targets: Array<{ client: string; subscriberId: string; sentAt: string }> = [];
  for (const m of msgs || []) {
    const client = m.client as string | null;
    const subscriberId = m.subscriber_id as string | null;
    if (!client || !subscriberId) continue;
    const key = `${client}:${subscriberId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ client, subscriberId, sentAt: (m.sent_at as string) || new Date().toISOString() });
    if (targets.length >= limit) break;
  }

  let processed = 0;
  for (const t of targets) {
    try {
      await upsertInstagramLeadIdentity({
        client: t.client,
        instagramUserId: t.subscriberId,
        sentAt: t.sentAt,
      });
      processed += 1;
    } catch {
      // best-effort; keep going
    }
  }

  const { count: bridgedTotal } = await sb
    .from("instagram_lead_links")
    .select("id", { count: "exact", head: true })
    .not("instagram_user_id", "is", null)
    .not("manychat_subscriber_id", "is", null);

  return NextResponse.json({
    ok: true,
    days,
    uniqueTargets: targets.length,
    processed,
    bridgedTotal: bridgedTotal ?? null,
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return run(req);
}
