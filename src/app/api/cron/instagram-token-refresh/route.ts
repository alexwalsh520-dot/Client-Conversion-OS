import { NextRequest, NextResponse } from "next/server";
import { refreshConnectedInstagramTokens } from "@/lib/instagram-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily: keep every connected Instagram token fresh. IG long-lived tokens last ~60 days; left alone
// they eventually expire and DM + reel ingestion silently die. This refreshes any token more than
// ~24h old back to a full ~60-day life. All the work (which rows are due, decrypt, refresh, re-encrypt,
// error-to-row) lives in refreshConnectedInstagramTokens so the crypto key stays module-private.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await refreshConnectedInstagramTokens();
  if (summary.failed) console.error(`[instagram-token-refresh] ${summary.failed} token refresh(es) failed`);
  // ok reflects the children: any failure is surfaced, not swallowed behind a 200.
  return NextResponse.json({ ok: summary.failed === 0, ...summary });
}
