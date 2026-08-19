// ─────────────────────────────────────────────────────────────────────────
// Attribution workspace, authed (the + button on /ads-v2):
//   GET   the review queue + keyword options
//   POST  save one human decision (keyword, or "not an ad sale")
// resolved_by comes from the signed-in user, so every saved row names the
// person — the warehouse's mark that a HUMAN decided, not the app's code.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { readWorkspace, saveResolution } from "@/lib/ads-v2/attribution-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payload = await readWorkspace(getServiceSupabase());
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    saleKey?: string;
    day?: string;
    keyword?: string | null;
    notAd?: boolean;
    clientKey?: string | null;
    note?: string | null;
  };

  const who = session.user.name || session.user.email || "CCOS user";
  const result = await saveResolution(getServiceSupabase(), {
    saleKey: body.saleKey || "",
    day: body.day || "",
    keyword: body.keyword,
    notAd: body.notAd,
    clientKey: body.clientKey,
    note: body.note,
    resolvedBy: `${who} (Attribution workspace)`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
