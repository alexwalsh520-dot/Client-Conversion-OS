import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getSetterBoard } from "@/lib/setter-board";

// Public data boundary for the tokenized setter leaderboard page.
// The ONLY gate is a live public_share_links row of kind 'setter-board';
// a bad or revoked token returns 404 with no data.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ET = "America/New_York";

function etToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

function shiftDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rangeFor(range: string | null): { dateFrom: string; dateTo: string; range: string } {
  const today = etToday();
  switch (range) {
    case "today":
      return { dateFrom: today, dateTo: today, range: "today" };
    case "7d":
      return { dateFrom: shiftDays(today, -6), dateTo: today, range: "7d" };
    case "mtd":
    default:
      return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today, range: "mtd" };
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data || data.revoked || data.kind !== "setter-board") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const window = rangeFor(req.nextUrl.searchParams.get("range"));
    const board = await getSetterBoard(window.dateFrom, window.dateTo);
    return NextResponse.json({ ...board, range: window.range });
  } catch (err) {
    console.error("[public/setter-board] failed:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
