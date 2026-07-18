// Daily CMO Agent run — generates the morning proposals so they're waiting when Alex
// opens /cmo-agent. Read-only against the money data; writes proposals only. Nothing executes.

import { NextRequest, NextResponse } from "next/server";
import { cronBaseUrl } from "@/lib/cron-base-url";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Vercel runs scheduled crons against the Deployment-Protection-guarded deployment host,
  // so sibling fetches must go through the public production alias. See cron-base-url.ts.
  const origin = cronBaseUrl(req);
  let step: unknown = null;
  // ok must reflect the child call, not merely that the try block completed.
  let childOk = false;
  try {
    const r = await fetch(`${origin}/api/cmo-agent/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    step = { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    step = { error: e instanceof Error ? e.message : "failed" };
  }
  if (!childOk) console.error(`[cmo-agent] child call failed via ${origin}`);
  return NextResponse.json({ ok: childOk, ranAt: new Date().toISOString(), step });
}
