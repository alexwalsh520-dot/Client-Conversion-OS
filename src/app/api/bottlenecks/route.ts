// Bottleneck tracker API: Alex-private loop tracking for Alex+Matt convos.
// GET returns every bottleneck with its commitments/actions; POST is action-based.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "alexwalsh520@gmail.com";

async function requireOwner() {
  const session = await auth();
  return session?.user?.email?.toLowerCase() === OWNER_EMAIL;
}

export async function GET() {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceSupabase();
  const [loopsRes, itemsRes] = await Promise.all([
    sb.from("bn_bottlenecks").select("*").order("created_at", { ascending: false }),
    sb.from("bn_items").select("*").order("created_at", { ascending: true }),
  ]);
  if (loopsRes.error || itemsRes.error) {
    return NextResponse.json(
      { error: loopsRes.error?.message || itemsRes.error?.message },
      { status: 500 },
    );
  }
  const items = itemsRes.data || [];
  const bottlenecks = (loopsRes.data || []).map((b) => ({
    ...b,
    items: items.filter((i) => i.bottleneck_id === b.id),
  }));
  return NextResponse.json({ bottlenecks });
}

export async function POST(req: NextRequest) {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceSupabase();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    switch (action) {
      case "create": {
        const title = String(body.title || "").trim();
        if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
        const { data, error } = await sb
          .from("bn_bottlenecks")
          .insert({
            title,
            detail: body.detail ? String(body.detail) : null,
            source: body.source ? String(body.source) : null,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ bottleneck: data });
      }

      // One thing at a time: attacking a bottleneck demotes any other attacker.
      case "attack": {
        const id = String(body.id || "");
        const { error: demoteErr } = await sb
          .from("bn_bottlenecks")
          .update({ status: "open" })
          .eq("status", "attacking")
          .neq("id", id);
        if (demoteErr) throw demoteErr;
        const { error } = await sb.from("bn_bottlenecks").update({ status: "attacking" }).eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "close": {
        const { error } = await sb
          .from("bn_bottlenecks")
          .update({
            status: "closed",
            outcome: body.outcome ? String(body.outcome) : null,
            closed_at: new Date().toISOString(),
          })
          .eq("id", String(body.id || ""));
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "reopen": {
        const { error } = await sb
          .from("bn_bottlenecks")
          .update({ status: "open", closed_at: null })
          .eq("id", String(body.id || ""));
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "delete": {
        const { error } = await sb.from("bn_bottlenecks").delete().eq("id", String(body.id || ""));
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "add_item": {
        const content = String(body.content || "").trim();
        if (!content) return NextResponse.json({ error: "Content required" }, { status: 400 });
        const kind = body.kind === "action" ? "action" : "commitment";
        const { data, error } = await sb
          .from("bn_items")
          .insert({
            bottleneck_id: String(body.bottleneck_id || ""),
            kind,
            content,
            owner: ["Alex", "Matt", "Both"].includes(body.owner) ? body.owner : "Alex",
            // Actions are logged after the fact, so they land already done.
            done: kind === "action",
            done_at: kind === "action" ? new Date().toISOString() : null,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ item: data });
      }

      case "toggle_item": {
        const done = !!body.done;
        const { error } = await sb
          .from("bn_items")
          .update({ done, done_at: done ? new Date().toISOString() : null })
          .eq("id", String(body.id || ""));
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "delete_item": {
        const { error } = await sb.from("bn_items").delete().eq("id", String(body.id || ""));
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
