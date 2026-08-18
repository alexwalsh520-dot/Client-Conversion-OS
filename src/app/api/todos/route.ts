// Alex-only ToDos workspace API. One row per day in public.todo_days.
// Claude sessions typically read/write the table directly via SQL; this route
// serves the /todos tab UI with the same data.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "alexwalsh520@gmail.com";

async function requireOwner() {
  const session = await auth();
  if (session?.user?.email?.toLowerCase() !== OWNER_EMAIL) return null;
  return session;
}

export async function GET(req: NextRequest) {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceSupabase();
  const day = req.nextUrl.searchParams.get("day");

  if (day) {
    const { data, error } = await sb
      .from("todo_days")
      .select("day, title, notes, data, updated_at")
      .eq("day", day)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data });
  }

  const { data, error } = await sb
    .from("todo_days")
    .select("day, title, updated_at")
    .order("day", { ascending: false })
    .limit(45);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ days: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { day?: string; title?: string; notes?: string; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!body.day || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
    return NextResponse.json({ error: "day (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const sb = getServiceSupabase();
  const { error } = await sb.from("todo_days").upsert(
    {
      day: body.day,
      title: body.title ?? null,
      notes: body.notes ?? null,
      data: body.data ?? { sections: [] },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "day" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
