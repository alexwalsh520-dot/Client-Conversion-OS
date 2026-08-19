// ─────────────────────────────────────────────────────────────────────────
// PUBLIC (share-link) attribution workspace API. The token is the only
// credential; it unlocks EXACTLY this: reading the review queue and saving a
// human decision on a queue row. Nothing else in the app is reachable from
// here. resolved_by is the name the person types on the page, so the
// warehouse still records WHICH human decided.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  readWorkspace,
  resolveAttributionToken,
  saveResolution,
} from "@/lib/ads-v2/attribution-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = getServiceSupabase();
  if (!(await resolveAttributionToken(db, token))) {
    return NextResponse.json({ error: "Link not available" }, { status: 404 });
  }
  try {
    return NextResponse.json(await readWorkspace(db));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = getServiceSupabase();
  if (!(await resolveAttributionToken(db, token))) {
    return NextResponse.json({ error: "Link not available" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    saleKey?: string;
    day?: string;
    keyword?: string | null;
    notAd?: boolean;
    clientKey?: string | null;
    note?: string | null;
    name?: string;
  };

  const name = (body.name || "").trim();
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Add your name first" }, { status: 400 });
  }

  const result = await saveResolution(db, {
    saleKey: body.saleKey || "",
    day: body.day || "",
    keyword: body.keyword,
    notAd: body.notAd,
    clientKey: body.clientKey,
    note: body.note,
    resolvedBy: `${name} (Attribution workspace share link)`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
