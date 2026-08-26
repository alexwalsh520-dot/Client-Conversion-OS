// One full call review (markdown), fetched on row expand.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const OWNER_EMAILS = ["alexwalsh520@gmail.com", "matthew@clientconversion.io"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!OWNER_EMAILS.includes(session?.user?.email?.toLowerCase() || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const fathomId = req.nextUrl.searchParams.get("fathomId");
  if (!fathomId) return NextResponse.json({ error: "fathomId required" }, { status: 400 });
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("mm_call_reviews")
    .select("fathom_id,review_md,grade,adherence_score,adherence_notes,closer,outcome,model,created_at")
    .eq("fathom_id", fathomId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No review yet" }, { status: 404 });
  return NextResponse.json({ review: data });
}
