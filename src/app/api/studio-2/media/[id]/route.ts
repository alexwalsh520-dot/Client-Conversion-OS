import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { deleteR2Object } from "@/lib/r2";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_media")
      .select("id, r2_key")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Media not found" }, { status: 404 });
    }

    await deleteR2Object(data.r2_key).catch((err) => {
      console.error("Studio 2 R2 media delete error:", err);
    });

    const { error: deleteError } = await sb
      .from("studio2_media")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Studio 2 media delete error:", err);
    return NextResponse.json({ error: "Failed to delete Studio 2 media" }, { status: 500 });
  }
}
