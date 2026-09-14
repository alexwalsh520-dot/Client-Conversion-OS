import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getSetterView, type SetterViewRange } from "@/lib/sales-hub/setter-view";

// Public data boundary for the tokenized per-setter view. The ONLY gate is a
// live public_share_links row of kind 'setter-view' whose settings name the
// setter; a bad or revoked token returns 404 with no data.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked, settings")
      .eq("token", token)
      .maybeSingle();
    const setterKey =
      data && typeof data.settings === "object" && data.settings !== null
        ? String((data.settings as { setter?: unknown }).setter || "")
        : "";
    if (error || !data || data.revoked || data.kind !== "setter-view" || !setterKey) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rangeParam = req.nextUrl.searchParams.get("range");
    const range: SetterViewRange = rangeParam === "yesterday" ? "yesterday" : "today";
    const result = await getSetterView({ setterKey, range });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[public/setter-view] failed:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
