import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Factory — live marketing-asset production tracker API.
//
// A project holds nestable GROUPS (e.g. "Pre-Call Emails", "Video Ads"), and
// each group holds ASSETS of a given `kind` (image_ad | video_ad | email |
// page_copy | breakout_video | dm_content | doc). Image ads keep their original
// copy→image→revision→completed pipeline; text/video kinds use a doc body
// (body_md) + comments + checklist + a free-text status.
//
// GET   /api/factory                      → all projects + groups + items
// GET   /api/factory?projectId=<id>       → one project
// GET   /api/factory?export=completed&projectId=<id>  → completed-items JSON
// POST  /api/factory  { action, ... }     → createProject | createGroup | createItem
// PATCH /api/factory  { id, ...changes }  → update one item (image OR doc fields)
// PATCH /api/factory  { groupId, ... }    → update one group (rename/collapse/reorder)
// DELETE /api/factory?type=item|group&id=<id>
//
// Service-role client throughout (single-user internal app). No silent failures.
// ---------------------------------------------------------------------------

const STAGES = ["copy_written", "image_generated", "revision", "completed"] as const;
type Stage = (typeof STAGES)[number];

const ITEM_COLS =
  "id, project_id, group_id, kind, label, bucket, style, copy_text, image_direction, stage, status, image_url, asset_url, body_md, comments, checklist, revision_note, sort_order, created_at, updated_at";

interface FactoryItem {
  id: string;
  project_id: string;
  group_id: string | null;
  kind: string;
  label: string;
  bucket: string;
  style: string | null;
  copy_text: string | null;
  image_direction: string | null;
  stage: Stage;
  status: string | null;
  image_url: string | null;
  asset_url: string | null;
  body_md: string | null;
  comments: unknown;
  checklist: unknown;
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
        .select("label, kind, bucket, style, copy_text, body_md, image_url, asset_url, image_direction, sort_order")
        .eq("project_id", projectId)
        .or("stage.eq.completed,status.eq.live,status.eq.approved")
        .order("sort_order", { ascending: true });
      if (iErr) throw iErr;

      const payload = {
        project: project?.name ?? null,
        client: project?.client ?? null,
        exportedAt: new Date().toISOString(),
        count: items?.length ?? 0,
        items: items ?? [],
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

    // ---- Groups ----
    const groupsByProject = new Map<string, Array<Record<string, unknown>>>();
    if (projectIds.length) {
      const { data: groupRows, error: gErr } = await sb
        .from("factory_groups")
        .select("id, project_id, name, kind, description, sort_order, collapsed, created_at, updated_at")
        .in("project_id", projectIds)
        .order("sort_order", { ascending: true });
      if (gErr) throw gErr;
      for (const g of groupRows ?? []) {
        const arr = groupsByProject.get(g.project_id as string) ?? [];
        arr.push(g);
        groupsByProject.set(g.project_id as string, arr);
      }
    }

    // ---- Items ----
    let items: FactoryItem[] = [];
    if (projectIds.length) {
      const { data: itemRows, error: itemErr } = await sb
        .from("factory_items")
        .select(ITEM_COLS)
        .in("project_id", projectIds)
        .order("sort_order", { ascending: true });
      if (itemErr) throw itemErr;
      items = (itemRows ?? []) as FactoryItem[];
    }

    // Version history per item (newest first).
    const versionsByItem = new Map<string, Array<Record<string, unknown>>>();
    if (items.length) {
      const { data: vRows, error: vErr } = await sb
        .from("factory_item_versions")
        .select("item_id, version, image_url, body_md, kind, revision_note, created_at")
        .in("item_id", items.map((i) => i.id))
        .order("version", { ascending: false });
      if (vErr) throw vErr;
      for (const v of vRows ?? []) {
        const arr = versionsByItem.get(v.item_id as string) ?? [];
        arr.push(v);
        versionsByItem.set(v.item_id as string, arr);
      }
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
      return {
        ...p,
        counts,
        groups: groupsByProject.get(p.id) ?? [],
        items: its.map((i) => ({ ...i, versions: versionsByItem.get(i.id) ?? [] })),
      };
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

// ---------------------------------------------------------------- POST (create)
export async function POST(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const action = body.action as string;

    if (action === "createProject") {
      const name = (body.name as string)?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const { data, error } = await sb
        .from("factory_projects")
        .insert({ name, client: (body.client as string) || null })
        .select("id, name, client")
        .single();
      if (error) throw error;
      return NextResponse.json({ project: data });
    }

    if (action === "createGroup") {
      const projectId = body.projectId as string;
      const name = (body.name as string)?.trim();
      if (!projectId || !name) return NextResponse.json({ error: "projectId + name required" }, { status: 400 });
      const { data: maxRow } = await sb
        .from("factory_groups")
        .select("sort_order")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSort = ((maxRow?.sort_order as number) ?? -1) + 1;
      const { data, error } = await sb
        .from("factory_groups")
        .insert({
          project_id: projectId,
          name,
          kind: (body.kind as string) || "doc",
          description: (body.description as string) || null,
          sort_order: nextSort,
        })
        .select("id, project_id, name, kind, description, sort_order, collapsed")
        .single();
      if (error) throw error;
      return NextResponse.json({ group: data });
    }

    if (action === "createItem") {
      const projectId = body.projectId as string;
      if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
      const { data: maxRow } = await sb
        .from("factory_items")
        .select("sort_order")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSort = ((maxRow?.sort_order as number) ?? -1) + 1;
      const kind = (body.kind as string) || "doc";
      const isImage = kind === "image_ad";
      const { data, error } = await sb
        .from("factory_items")
        .insert({
          project_id: projectId,
          group_id: (body.groupId as string) || null,
          kind,
          label: (body.label as string)?.trim() || "Untitled",
          bucket: (body.bucket as string) || "keeper",
          style: (body.style as string) || null,
          copy_text: (body.copyText as string) || null,
          body_md: (body.bodyMd as string) || null,
          image_direction: (body.imageDirection as string) || null,
          stage: isImage ? "copy_written" : "completed",
          status: isImage ? null : (body.status as string) || "draft",
          sort_order: nextSort,
        })
        .select(ITEM_COLS)
        .single();
      if (error) throw error;
      return NextResponse.json({ item: data });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[/api/factory POST] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------- PATCH (update)
export async function PATCH(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    // ---- Group update (rename / collapse / reorder / kind) ----
    if (typeof body.groupId === "string") {
      const gUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") gUpdate.name = body.name.trim();
      if (typeof body.collapsed === "boolean") gUpdate.collapsed = body.collapsed;
      if (typeof body.sortOrder === "number") gUpdate.sort_order = body.sortOrder;
      if (typeof body.kind === "string") gUpdate.kind = body.kind;
      if (typeof body.description === "string") gUpdate.description = body.description;
      const { data, error } = await sb
        .from("factory_groups")
        .update(gUpdate)
        .eq("id", body.groupId)
        .select("id, project_id, name, kind, description, sort_order, collapsed")
        .single();
      if (error) throw error;
      return NextResponse.json({ group: data });
    }

    // ---- Item update ----
    const id = body.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "id (or groupId) is required" }, { status: 400 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Image-ad pipeline fields (back-compat)
    if (body.approve === true) update.stage = "completed";
    else if (typeof body.revisionNote === "string") {
      update.revision_note = body.revisionNote.trim() || null;
      update.stage = "revision";
    } else if (typeof body.imageUrl === "string") {
      update.image_url = body.imageUrl.trim() || null;
      if (body.imageUrl.trim()) update.stage = "image_generated";
    } else if (typeof body.stage === "string") {
      if (!STAGES.includes(body.stage as Stage))
        return NextResponse.json({ error: `Invalid stage: ${body.stage}` }, { status: 400 });
      update.stage = body.stage;
    }

    // Generic / doc fields (any kind)
    if (typeof body.label === "string") update.label = body.label;
    if (typeof body.bodyMd === "string") update.body_md = body.bodyMd;
    if (typeof body.copyText === "string") update.copy_text = body.copyText;
    if (typeof body.status === "string") update.status = body.status;
    if (typeof body.imageDirection === "string") update.image_direction = body.imageDirection;
    if (typeof body.assetUrl === "string") update.asset_url = body.assetUrl.trim() || null;
    if (typeof body.bucket === "string") update.bucket = body.bucket;
    if (typeof body.style === "string") update.style = body.style;
    if (typeof body.groupIdSet !== "undefined") update.group_id = body.groupIdSet || null;
    if (typeof body.sortOrder === "number") update.sort_order = body.sortOrder;
    if (Array.isArray(body.comments)) update.comments = body.comments;
    if (Array.isArray(body.checklist)) update.checklist = body.checklist;

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: "No actionable field" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("factory_items")
      .update(update)
      .eq("id", id)
      .select(ITEM_COLS)
      .single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    // Snapshot a version when explicitly asked (doc save or new image), so autosave
    // doesn't spam history. Caller sends { snapshot: true }.
    if (body.snapshot === true) {
      const { data: maxV } = await sb
        .from("factory_item_versions")
        .select("version")
        .eq("item_id", id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextV = ((maxV?.version as number) ?? 0) + 1;
      await sb.from("factory_item_versions").insert({
        item_id: id,
        version: nextV,
        image_url: (update.image_url as string) ?? (data.image_url as string) ?? null,
        body_md: (update.body_md as string) ?? (data.body_md as string) ?? null,
        kind: data.kind,
        revision_note: (body.revisionNote as string) || (body.snapshotNote as string) || null,
      });
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error("[/api/factory PATCH] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------- DELETE
export async function DELETE(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const params = req.nextUrl.searchParams;
    const type = params.get("type");
    const id = params.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    if (type === "group") {
      // Detach items, then drop the group (keeps the work, removes the bucket).
      await sb.from("factory_items").update({ group_id: null }).eq("group_id", id);
      const { error } = await sb.from("factory_groups").delete().eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (type === "item") {
      const { error } = await sb.from("factory_items").delete().eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "type must be group|item" }, { status: 400 });
  } catch (err) {
    console.error("[/api/factory DELETE] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete" },
      { status: 500 }
    );
  }
}
