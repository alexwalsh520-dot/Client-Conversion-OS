/**
 * Back-office partner list + create. Any authenticated CCOS user (the
 * UI adds a PIN gate for non-admins; this is the speed-bump model the
 * owner asked for, not a hard security boundary).
 *
 *   GET  /api/onboarding/admin  → { partners: PartnerListItem[] }
 *   POST /api/onboarding/admin  → { partner } (creates + returns token)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPartners, createPartner } from "@/lib/onboarding/server";

export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function GET(): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const partners = await listPartners();
    return NextResponse.json({ partners }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/admin GET] failed:", err);
    return NextResponse.json({ error: "list failed" }, { status: 500 });
  }
}

interface PostBody {
  name?: string;
  handle?: string | null;
  email?: string | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  try {
    const partner = await createPartner({
      name,
      handle: body.handle?.trim() || null,
      email: body.email?.trim() || null,
    });
    return NextResponse.json({ partner }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/admin POST] failed:", err);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
