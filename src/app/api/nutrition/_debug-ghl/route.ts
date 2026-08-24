/**
 * TEMPORARY DIAGNOSTIC — remove after we confirm the GHL env vars are OK.
 *
 * GET /api/nutrition/_debug-ghl
 *
 * Returns the *shape* of the GHL env vars the coaching integration is
 * reading (length + first/last 4 chars only, never the full value), so
 * we can compare against what was pasted in Vercel and catch trailing
 * whitespace / wrong-var-name bugs without exposing the secret.
 *
 * Auth: requires the CRON_SECRET Bearer header. Nobody hits this by
 * accident.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function fingerprint(v: string | undefined): Record<string, unknown> {
  if (v == null) return { present: false };
  return {
    present: true,
    length: v.length,
    first4: v.slice(0, 4),
    last4: v.slice(-4),
    hasLeadingSpace: v !== v.trimStart(),
    hasTrailingSpace: v !== v.trimEnd(),
    hasNewline: /\n|\r/.test(v),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    GHL_ACCESS_TOKEN_NUTRI: fingerprint(process.env.GHL_ACCESS_TOKEN_NUTRI),
    GHL_LOCATION_ID_NUTRI: fingerprint(process.env.GHL_LOCATION_ID_NUTRI),
    GHL_ACCESS_TOKEN: fingerprint(process.env.GHL_ACCESS_TOKEN),
    GHL_LOCATION_ID: fingerprint(process.env.GHL_LOCATION_ID),
  });
}
