/**
 * Public partner onboarding endpoints — the only auth is possession of the
 * unguessable token in the URL. Excluded from the auth proxy matcher.
 *
 *   GET  /api/onboarding/public/[token]
 *     → PublicPartnerView (this partner's checklist + their progress).
 *
 *   POST /api/onboarding/public/[token]
 *     → save one or more step submissions. Body: { submissions: [...] }.
 *       Honeypot field `website` must be empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPublicView, submitPublic } from "@/lib/onboarding/server";
import type { PublicStepSubmission } from "@/lib/onboarding/types";

export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }
  try {
    const view = await getPublicView(token);
    if (!view) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ view }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/public GET] failed:", err);
    return NextResponse.json({ error: "load failed" }, { status: 500, headers: NO_STORE });
  }
}

interface PostBody {
  submissions?: PublicStepSubmission[];
  website?: string; // honeypot
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Honeypot — silent success so bots can't tell.
  if (body.website && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  if (!Array.isArray(body.submissions) || body.submissions.length === 0) {
    return NextResponse.json({ error: "no submissions" }, { status: 400 });
  }
  // Cap payload size to avoid abuse.
  if (body.submissions.length > 100) {
    return NextResponse.json({ error: "too many submissions" }, { status: 400 });
  }

  try {
    const result = await submitPublic(token, body.submissions);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/public POST] failed:", err);
    return NextResponse.json({ error: "save failed" }, { status: 500, headers: NO_STORE });
  }
}
