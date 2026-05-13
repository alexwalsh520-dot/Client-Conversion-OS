import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Folder name required" }, { status: 400 });

    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_folders")
      .insert({ name, updated_at: new Date().toISOString() })
      .select("id, name, updated_at, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Folder insert failed" }, { status: 500 });
    }

    return NextResponse.json({ folder: data });
  } catch (err) {
    console.error("Studio 2 folder create error:", err);
    return NextResponse.json({ error: "Failed to create Studio 2 folder" }, { status: 500 });
  }
}
