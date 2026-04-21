/**
 * GET /api/nutrition/plan?clientId=X
 * Returns all versioned plans for a client + signed URLs for each PDF.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: plans, error } = await db
    .from("nutrition_meal_plans")
    .select("*")
    .eq("client_id", clientId)
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Create signed URLs for each PDF
  const plansWithUrls = await Promise.all(
    (plans || []).map(async (p) => {
      if (!p.pdf_path) return { ...p, pdfUrl: null };
      const { data: signed } = await db.storage
        .from("nutrition-plans")
        .createSignedUrl(p.pdf_path, 60 * 60 * 2);
      return { ...p, pdfUrl: signed?.signedUrl || null };
    })
  );

  return NextResponse.json({ success: true, plans: plansWithUrls });
}
