import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getSetterTeamView } from "@/lib/sales-hub/setter-view";

// Public data boundary for the tokenized setter team view. The ONLY gate is a
// live public_share_links row of kind 'setter-view'; a bad or revoked token
// returns 404 with no data. The date range is clamped server-side so data
// only starts from yesterday (ET), whatever the client asks for.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data || data.revoked || data.kind !== "setter-view") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const params = req.nextUrl.searchParams;
    const result = await getSetterTeamView({
      dateFrom: params.get("dateFrom") || "",
      dateTo: params.get("dateTo") || "",
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[public/setter-view] failed:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
