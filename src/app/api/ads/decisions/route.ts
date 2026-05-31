import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// The decision log. When Alex acts on what the Deep Dive suggested — turns an ad
// off, scales a winner — he marks it here. We store the move plus a snapshot of
// the numbers at that moment, so the page can (1) stop nagging him to do what he
// already did and (2) trace the decision forward to a real result. Pure data, no
// AI. One active decision per ad word per account.

type Baseline = Record<string, unknown>;

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// GET /api/ads/decisions?account=all  → every logged decision for that scope.
export async function GET(req: NextRequest) {
  try {
    const account = clean(req.nextUrl.searchParams.get("account")) || "all";
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("ad_decisions")
      .select("decision_key,label,action,source,baseline,note,status,decided_at,updated_at")
      .eq("account", account)
      .order("decided_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ status: "ok", decisions: data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load decisions";
    return NextResponse.json({ status: "error", error: message, decisions: [] }, { status: 500 });
  }
}

// POST /api/ads/decisions  → record (or update) a decision.
// Body: { account, decisionKey, label, action, source, baseline, note }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const account = clean(body.account) || "all";
    const decisionKey = clean(body.decisionKey).toLowerCase();
    const action = clean(body.action).toLowerCase(); // kill | scale | watch
    if (!decisionKey) {
      return NextResponse.json({ status: "error", error: "decisionKey required" }, { status: 400 });
    }
    if (!["kill", "scale", "watch"].includes(action)) {
      return NextResponse.json({ status: "error", error: "action must be kill, scale or watch" }, { status: 400 });
    }

    const baseline: Baseline =
      body.baseline && typeof body.baseline === "object" ? (body.baseline as Baseline) : {};

    const row = {
      account,
      decision_key: decisionKey,
      label: clean(body.label) || decisionKey,
      action,
      source: clean(body.source) || "playbook",
      baseline,
      note: clean(body.note) || null,
      status: "acting",
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("ad_decisions")
      .upsert(row, { onConflict: "account,decision_key" })
      .select("decision_key,label,action,source,baseline,note,status,decided_at,updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ status: "ok", decision: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save decision";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

// DELETE /api/ads/decisions?account=all&key=foo  → undo a decision.
export async function DELETE(req: NextRequest) {
  try {
    const account = clean(req.nextUrl.searchParams.get("account")) || "all";
    const key = clean(req.nextUrl.searchParams.get("key")).toLowerCase();
    if (!key) {
      return NextResponse.json({ status: "error", error: "key required" }, { status: 400 });
    }
    const supabase = getServiceSupabase();
    const { error } = await supabase
      .from("ad_decisions")
      .delete()
      .eq("account", account)
      .eq("decision_key", key);
    if (error) throw error;
    return NextResponse.json({ status: "ok" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to remove decision";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
