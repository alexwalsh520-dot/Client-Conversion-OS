// CMO Agent daily run — generate today's proposals and store them for review.
// Idempotent: refreshes the "proposed" list, never clobbers items Alex already acted on.
// Triggerable by cron (Bearer CRON_SECRET) or from the page (session).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { buildProposals } from "@/lib/cmo-agent/propose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = getServiceSupabase();
  const runDate = todayET();

  const proposals = await buildProposals();

  // Preserve anything Alex has already touched today; only refresh the untouched "proposed" set.
  const { data: existing } = await sb
    .from("cmo_agent_items")
    .select("creator, kind, target, status")
    .eq("run_date", runDate);
  const locked = new Set(
    (existing ?? [])
      .filter((e) => e.status !== "proposed")
      .map((e) => `${e.creator}|${e.kind}|${e.target ?? ""}`),
  );

  await sb.from("cmo_agent_items").delete().eq("run_date", runDate).eq("status", "proposed");

  const seen = new Set<string>();
  const rows = proposals
    .filter((p) => {
      const key = `${p.creator}|${p.kind}|${p.target ?? ""}`;
      if (locked.has(key) || seen.has(key)) return false; // skip locked + dedupe within the batch
      seen.add(key);
      return true;
    })
    .map((p) => ({
      run_date: runDate,
      creator: p.creator,
      kind: p.kind,
      target: p.target,
      title: p.title,
      detail: p.detail,
      suggestion: p.suggestion,
      evidence: p.evidence,
      rule: p.rule,
      priority: p.priority,
      status: "proposed",
      updated_at: new Date().toISOString(),
    }));

  let inserted = 0;
  if (rows.length) {
    const { error } = await sb.from("cmo_agent_items").upsert(rows, { onConflict: "run_date,creator,kind,target" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted = rows.length;
  }

  return NextResponse.json({ ok: true, runDate, proposed: inserted, lockedKept: locked.size });
}
