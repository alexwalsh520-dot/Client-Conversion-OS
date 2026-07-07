// CMO Agent items — read today's proposals, and capture Alex's directive (comment + preset).
// Capturing a directive NEVER executes anything; it logs Alex's real intent for a Claude
// session to act on with full context. That's the Factory-style human-in-the-loop.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(req: NextRequest) {
  const sb = getServiceSupabase();
  const date = new URL(req.url).searchParams.get("date") || todayET();
  const { data } = await sb
    .from("cmo_agent_items")
    .select("*")
    .eq("run_date", date)
    .order("priority", { ascending: true })
    .order("creator", { ascending: true });
  return NextResponse.json({ ok: true, date, items: data ?? [] });
}

const DISMISS = new Set(["dismiss", "reject"]);

export async function POST(req: NextRequest) {
  const sb = getServiceSupabase();
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const directive = (body.directive as string | undefined)?.trim() || null;
  const comment = (body.comment as string | undefined)?.trim() || null;

  // "reopen" clears a prior directive back to proposed (Alex changed his mind)
  if (directive === "reopen") {
    const { error } = await sb
      .from("cmo_agent_items")
      .update({ status: "proposed", alex_directive: null, alex_comment: null, directed_at: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const status = directive && DISMISS.has(directive) ? "dismissed" : "directed";
  const { error } = await sb
    .from("cmo_agent_items")
    .update({
      alex_comment: comment,
      alex_directive: directive,
      status,
      directed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
