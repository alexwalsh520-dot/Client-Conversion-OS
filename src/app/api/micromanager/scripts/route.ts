// Micromanager scripts: the closer call script + setter DM script that adherence
// grading runs against (grading itself happens in Utari via the MCP tools).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "alexwalsh520@gmail.com";

async function ownerOnly() {
  const session = await auth();
  return session?.user?.email?.toLowerCase() === OWNER_EMAIL;
}

export async function GET() {
  if (!(await ownerOnly())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceSupabase();
  const { data, error } = await sb.from("mm_scripts").select("role,content,updated_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byRole: Record<string, { content: string; updatedAt: string }> = {};
  for (const s of data || []) byRole[s.role as string] = { content: s.content as string, updatedAt: s.updated_at as string };
  return NextResponse.json({ closer: byRole.closer || null, setter: byRole.setter || null });
}

export async function PUT(req: NextRequest) {
  if (!(await ownerOnly())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const role = body?.role;
  if (role !== "closer" && role !== "setter") {
    return NextResponse.json({ error: "role must be 'closer' or 'setter'" }, { status: 400 });
  }
  const sb = getServiceSupabase();
  const { error } = await sb.from("mm_scripts").upsert(
    { role, content: String(body?.content ?? ""), updated_at: new Date().toISOString() },
    { onConflict: "role" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: true });
}
