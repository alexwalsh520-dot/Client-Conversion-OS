import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// GET - list all projects
export async function GET() {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("ad_projects")
      .select("*, ad_creatives(count), ad_photos(count)")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ projects: data });
  } catch (err) {
    console.error("List projects error:", err);
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
}

// POST - create a new project and generate creatives
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, copyText, photoUrls, textBlocks } = body;
    const sb = getServiceSupabase();

    // Create project
    const { data: project, error: projError } = await sb
      .from("ad_projects")
      .insert({ name, copy_text: copyText, status: "generating" })
      .select()
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: projError?.message }, { status: 500 });
    }

    // Generate one creative per photo with the text blocks
    const creatives = photoUrls.map((url: string, i: number) => ({
      project_id: project.id,
      photo_url: url,
      text_blocks: textBlocks,
      sort_order: i,
      status: "draft",
    }));

    const { data: insertedCreatives, error: creativeError } = await sb
      .from("ad_creatives")
      .insert(creatives)
      .select();

    if (creativeError) {
      return NextResponse.json({ error: creativeError.message }, { status: 500 });
    }

    // Update project status
    await sb
      .from("ad_projects")
      .update({ status: "ready" })
      .eq("id", project.id);

    return NextResponse.json({ project, creatives: insertedCreatives });
  } catch (err) {
    console.error("Create project error:", err);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
