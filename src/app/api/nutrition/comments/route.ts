/**
 * GET  /api/nutrition/comments?clientId=X
 * POST /api/nutrition/comments { clientId, comment }
 * DELETE /api/nutrition/comments?id=X
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
  const { data, error } = await db
    .from("nutrition_task_comments")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, comments: data || [] });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { clientId, comment } = body;
  if (!clientId || !comment || !comment.trim()) {
    return NextResponse.json({ error: "clientId and comment required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_task_comments")
    .insert({
      client_id: clientId,
      comment: comment.trim(),
      created_by: session.user.email || "unknown",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, comment: data });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("nutrition_task_comments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
