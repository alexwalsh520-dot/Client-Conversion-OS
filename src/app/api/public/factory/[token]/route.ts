// Public, no-login API for ONE Factory project.
//
// The token is the only credential. It resolves server-side to a single
// project_id and EVERY query is filtered by that id, so a share link can never
// reach another project, another client, or any other tab's data. Revoked
// tokens return 404 with no payload.
//
// GET  -> { project, items[] }  (label, copy, image, stage, existing note)
// POST -> { itemId, note }      leaves a revision note, only if can_comment.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Link = { project_id: string; label: string | null; can_comment: boolean };

async function resolveToken(token: string): Promise<Link | null> {
  if (!token || token.length < 16) return null;
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("public_share_links")
    .select("project_id, label, can_comment, revoked, kind")
    .eq("token", token)
    .eq("kind", "factory")
    .maybeSingle();
  if (error || !data || data.revoked || !data.project_id) return null;
  return { project_id: data.project_id, label: data.label, can_comment: !!data.can_comment };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const link = await resolveToken(token);
  if (!link) return NextResponse.json({ error: "Not available" }, { status: 404 });

  const sb = getServiceSupabase();

  const { data: project } = await sb
    .from("factory_projects")
    .select("id, name")
    .eq("id", link.project_id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not available" }, { status: 404 });

  // Only fields a reviewer needs. No internal prompt/reference paths, no other
  // projects, no client or money data.
  const { data: items } = await sb
    .from("factory_items")
    .select("id, label, copy_text, image_url, stage, revision_note, sort_order")
    .eq("project_id", link.project_id)
    .not("image_url", "is", null)
    .order("sort_order", { ascending: true });

  return NextResponse.json({
    project: { name: link.label || project.name },
    canComment: link.can_comment,
    items: items ?? [],
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const link = await resolveToken(token);
  if (!link) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!link.can_comment) return NextResponse.json({ error: "Read only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  if (!note) return NextResponse.json({ error: "note required" }, { status: 400 });
  if (note.length > 2000) return NextResponse.json({ error: "note too long" }, { status: 400 });

  const sb = getServiceSupabase();

  // Scope the write to this project too — a valid token must never be able to
  // update an item id belonging to some other project.
  const { data: item } = await sb
    .from("factory_items")
    .select("id")
    .eq("id", itemId)
    .eq("project_id", link.project_id)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Not available" }, { status: 404 });

  const { error } = await sb
    .from("factory_items")
    .update({ revision_note: note, stage: "revision", updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
