import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Factory — live creative-production tracker API.
//
// GET  /api/factory                       → all projects + their items.
// GET  /api/factory?projectId=<id>        → one project + its items.
// GET  /api/factory?export=completed&projectId=<id>
//                                         → downloadable JSON of completed items
//                                           (label, copy_text, image_url).
// PATCH /api/factory  { id, ...changes }  → update one item:
//        - { id, stage }                   set stage directly
//        - { id, revisionNote }            store note + move to 'revision'
//        - { id, imageUrl }                store image + move to 'image_generated'
//        - { id, approve: true }           move to 'completed'
//
// Reads/writes go through the service-role client (bypasses RLS — single-user
// internal app), mirroring the rest of CCOS. No silent failures: every error
// surfaces with a real status code.
// ---------------------------------------------------------------------------

const STAGES = ["copy_written", "image_generated", "revision", "completed"] as const;
type Stage = (typeof STAGES)[number];

interface FactoryItem {
  id: string;
  project_id: string;
  label: string;
  bucket: string;
  style: string | null;
  copy_text: string | null;
  image_direction: string | null;
  stage: Stage;
  image_url: string | null;
  revision_note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface FactoryProject {
  id: string;
  name: string;
  client: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const params = req.nextUrl.searchParams;
    const projectId = params.get("projectId");
    const exportMode = params.get("export");

    // ---- Export completed items as downloadable JSON ----
    if (exportMode === "completed") {
      if (!projectId) {
        return NextResponse.json({ error: "projectId is required for export" }, { status: 400 });
      }
      const { data: project, error: pErr } = await sb
        .from("factory_projects")
        .select("id, name, client")
        .eq("id", projectId)
        .single();
      if (pErr) throw pErr;

      const { data: items, error: iErr } = await sb
        .from("factory_items")
        .select("label, bucket, style, copy_text, image_url, image_direction, sort_order")
        .eq("project_id", projectId)
        .eq("stage", "completed")
        .order("sort_order", { ascending: true });
      if (iErr) throw iErr;

      const payload = {
        project: project?.name ?? null,
        client: project?.client ?? null,
        exportedAt: new Date().toISOString(),
        count: items?.length ?? 0,
        items: (items ?? []).map((i) => ({
          label: i.label,
          bucket: i.bucket,
          style: i.style,
          copy_text: i.copy_text,
          image_url: i.image_url,
          image_direction: i.image_direction,
        })),
      };
      const safeName = (project?.name ?? "factory").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      return new NextResponse(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${safeName}-completed.json"`,
        },
      });
    }

    // ---- Projects ----
    let projQuery = sb
      .from("factory_projects")
      .select("id, name, client, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (projectId) projQuery = projQuery.eq("id", projectId);
    const { data: projects, error: projErr } = await projQuery;
    if (projErr) throw projErr;

    const projectIds = (projects ?? []).map((p) => p.id);
    let items: FactoryItem[] = [];
    if (projectIds.length) {
      const { data: itemRows, error: itemErr } = await sb
        .from("factory_items")
        .select(
          "id, project_id, label, bucket, style, copy_text, image_direction, stage, image_url, revision_note, sort_order, created_at, updated_at"
        )
        .in("project_id", projectIds)
        .order("sort_order", { ascending: true });
      if (itemErr) throw itemErr;
      items = (itemRows ?? []) as FactoryItem[];
    }

    const byProject = new Map<string, FactoryItem[]>();
    for (const it of items) {
      if (!byProject.has(it.project_id)) byProject.set(it.project_id, []);
      byProject.get(it.project_id)!.push(it);
    }

    const out = (projects ?? []).map((p: FactoryProject) => {
      const its = byProject.get(p.id) ?? [];
      const counts = {
        copy_written: its.filter((i) => i.stage === "copy_written").length,
        image_generated: its.filter((i) => i.stage === "image_generated").length,
        revision: its.filter((i) => i.stage === "revision").length,
        completed: its.filter((i) => i.stage === "completed").length,
        total: its.length,
      };
      return { ...p, counts, items: its };
    });

    return NextResponse.json({ projects: out });
  } catch (err) {
    console.error("[/api/factory GET] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load factory" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const id: unknown = (body as Record<string, unknown>).id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { stage, revisionNote, imageUrl, approve } = body as {
      stage?: string;
      revisionNote?: string;
      imageUrl?: string;
      approve?: boolean;
    };

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (approve === true) {
      update.stage = "completed";
    } else if (typeof revisionNote === "string") {
      // A revision request: store the note and route the item to Revision.
      update.revision_note = revisionNote.trim() || null;
      update.stage = "revision";
    } else if (typeof imageUrl === "string") {
      update.image_url = imageUrl.trim() || null;
      if (imageUrl.trim()) update.stage = "image_generated";
    } else if (typeof stage === "string") {
      if (!STAGES.includes(stage as Stage)) {
        return NextResponse.json({ error: `Invalid stage: ${stage}` }, { status: 400 });
      }
      update.stage = stage;
    } else {
      return NextResponse.json(
        { error: "No actionable field (stage | revisionNote | imageUrl | approve)" },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("factory_items")
      .update(update)
      .eq("id", id)
      .select(
        "id, project_id, label, bucket, style, copy_text, image_direction, stage, image_url, revision_note, sort_order, created_at, updated_at"
      )
      .single();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error("[/api/factory PATCH] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update item" },
      { status: 500 }
    );
  }
}
