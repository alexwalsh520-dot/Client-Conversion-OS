// Daily CMO Agent run — generates the morning proposals so they're waiting when Alex
// opens /cmo-agent. Read-only against the money data; writes proposals only. Nothing executes.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  let step: unknown = null;
  try {
    const r = await fetch(`${origin}/api/cmo-agent/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    step = { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    step = { error: e instanceof Error ? e.message : "failed" };
  }
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), step });
}
