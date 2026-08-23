import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { unsubscribeInstagramWebhooks } from "@/lib/instagram-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disconnect one creator's Instagram: unsubscribe at Meta, then mark the row disconnected.
//
// This is the missing half of the integration — connect/callback/status all existed, but nothing
// ever tore a connection down, so a dropped client kept delivering DMs indefinitely.
//
//   POST /api/integrations/instagram/disconnect?client=antwan_rarcus&clearToken=1
//
// Auth mirrors the buyer-dna run routes: a signed-in user, or the cron secret for scripted use.
async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await auth().catch(() => null);
  return Boolean(session?.user?.email);
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const clientKey = (url.searchParams.get("client") || "").trim();
  if (!clientKey) return NextResponse.json({ error: "client is required" }, { status: 400 });

  // Default is to clear the token: a disconnect that leaves a live credential behind is not a
  // disconnect. Pass clearToken=0 to keep it (e.g. a temporary pause you intend to undo).
  const clearToken = url.searchParams.get("clearToken") !== "0";

  const result = await unsubscribeInstagramWebhooks(clientKey, { clearToken });
  // `unsubscribed: false` means Meta may still be sending — surface it as a non-ok result so a
  // caller cannot mistake a partial cut for a clean one. The DB row is disconnected either way,
  // and the ingest gate in instagram-dm.ts drops the traffic regardless.
  return NextResponse.json({ ok: result.unsubscribed, ...result }, { status: result.unsubscribed ? 200 : 502 });
}
