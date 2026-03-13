import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const projectId = formData.get("projectId") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const storagePath = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await sb.storage
      .from("ad-photos")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = sb.storage
      .from("ad-photos")
      .getPublicUrl(storagePath);

    // Get image dimensions (we'll do this client-side instead)
    const { data: photoRow, error: insertError } = await sb
      .from("ad_photos")
      .insert({
        project_id: projectId,
        storage_path: storagePath,
        public_url: urlData.publicUrl,
        filename: file.name,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ photo: photoRow });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
