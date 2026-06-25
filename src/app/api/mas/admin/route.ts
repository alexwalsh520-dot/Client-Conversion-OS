import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

// Admin-only actions on the Ask Ahmad inbox: rule on a flagged situation, dismiss it,
// or approve/reject a proposed learning. Gated to Ahmad's admin account. Ruling on a
// situation also records it as approved guidance the brain applies to future lookalikes.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { action?: string; id?: number; ruling?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const sb = getServiceSupabase();
  const id = Number(body.id);
  if (!body.action || !id) return NextResponse.json({ error: "action and id are required" }, { status: 400 });

  try {
    if (body.action === "rule_review") {
      const ruling = String(body.ruling || "").trim();
      if (!ruling) return NextResponse.json({ error: "ruling is required" }, { status: 400 });
      const { data: item, error: e1 } = await sb.from("mas_review_queue")
        .update({ mas_ruling: ruling, status: "answered", resolved_at: new Date().toISOString() })
        .eq("id", id).select("query_id, situation_summary").maybeSingle();
      if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
      // Ahmad's ruling becomes approved guidance the brain can apply going forward.
      await sb.from("mas_learning_feed").insert({
        content: `Ahmad's ruling: ${ruling}${item?.situation_summary ? `\n(Situation: ${item.situation_summary})` : ""}`,
        source_query_id: item?.query_id ?? null,
        approved: true,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "dismiss_review") {
      const { error } = await sb.from("mas_review_queue")
        .update({ status: "dismissed", resolved_at: new Date().toISOString() }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "approve_learning") {
      const { error } = await sb.from("mas_learning_feed").update({ approved: true }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reject_learning") {
      const { error } = await sb.from("mas_learning_feed").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Action failed" }, { status: 500 });
  }
}
