/**
 * POST /api/coaching-v3/everfit-sync
 * GET  /api/coaching-v3/everfit-sync — latest snapshot metadata (for the sync banner)
 *
 * Ingests the lean Coaching V3 Everfit sync JSON (schema_version: 3):
 *  - Validates via parseV3Report; drops malformed rows and reports the count.
 *  - Deduplicates by SHA-256 of the canonical payload so double-uploads no-op.
 *  - Stores the raw payload in everfit_v3_snapshots for audit / re-derivation.
 *  - Upserts everfit_v3_client_state, one row per everfit_id.
 *  - Matches each Everfit row to a clients.id by (coach, name) — case- and
 *    space-insensitive. When either side is empty the row lands unmatched
 *    (client_id NULL) and can be reconciled later.
 *
 * Auth: admin only. Coaches don't push data.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { parseV3Report } from "@/lib/coaching-v3/parse";
import { canonicalCoachName } from "@/lib/coaching-v3/coach-aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000; // ~45KB per 300 clients; 2MB is a very generous cap.

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("everfit_v3_snapshots")
    .select("id, captured_at, uploaded_at, uploaded_by, clients_count, matched_count")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ latest: data });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  if (Number(req.headers.get("content-length")) > MAX_BYTES) {
    return NextResponse.json({ error: "Report exceeds 2 MB" }, { status: 413 });
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) {
    return NextResponse.json({ error: "Report exceeds 2 MB" }, { status: 413 });
  }

  let parsed;
  try {
    parsed = parseV3Report(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid JSON" },
      { status: 400 },
    );
  }
  const { report, droppedRows } = parsed;
  const db = getServiceSupabase();

  // Match every row to a clients.id by (coach, name). Case- and space-insensitive.
  // We index by name-only fallback so an unassigned everfit row with a match on name
  // still lands linked.
  const { data: allClients, error: clientsErr } = await db
    .from("clients")
    .select("id, name, coach_name");
  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  const byCoachName = new Map<string, number>();
  const byNameOnly = new Map<string, number[]>();
  for (const c of allClients ?? []) {
    const nm = norm(c.name as string);
    const co = norm(c.coach_name as string);
    if (nm && co) byCoachName.set(`${co}::${nm}`, c.id as number);
    if (nm) {
      const arr = byNameOnly.get(nm) ?? [];
      arr.push(c.id as number);
      byNameOnly.set(nm, arr);
    }
  }

  // Preserve prior manual reconciliations: if a row already exists in
  // everfit_v3_client_state with a linked client_id, keep that link when the
  // fresh (coach+name) match comes back null. Manual fixes for name-variant
  // clients (e.g. "Zach Thomas" -> "Zachary Davis") therefore survive
  // subsequent re-uploads.
  const priorClientIdByEverfit = new Map<string, number>();
  const { data: priorRows } = await db
    .from("everfit_v3_client_state")
    .select("everfit_id, client_id")
    .not("client_id", "is", null);
  for (const r of priorRows ?? []) {
    priorClientIdByEverfit.set(r.everfit_id as string, r.client_id as number);
  }

  let matched = 0;
  const stateRows: Record<string, unknown>[] = [];
  const capturedAt = report.captured_at;

  const hash = createHash("sha256").update(JSON.stringify(report)).digest("hex");

  // Insert the snapshot first so client_state rows can reference its id.
  const { data: existingSnap } = await db
    .from("everfit_v3_snapshots")
    .select("id")
    .eq("source_hash", hash)
    .maybeSingle();

  if (existingSnap) {
    return NextResponse.json({
      alreadyUploaded: true,
      snapshotId: existingSnap.id,
      message: "This exact payload was already uploaded.",
    });
  }

  const { data: snap, error: snapErr } = await db
    .from("everfit_v3_snapshots")
    .insert({
      captured_at: capturedAt,
      uploaded_by: session.user.email ?? "unknown",
      clients_count: report.clients.length,
      matched_count: 0, // updated below
      document: report,
      source_hash: hash,
    })
    .select("id")
    .single();
  if (snapErr || !snap) {
    return NextResponse.json(
      { error: snapErr?.message ?? "Snapshot insert failed" },
      { status: 500 },
    );
  }

  for (const r of report.clients) {
    // Normalize incoming coach name through the alias map so downstream
    // reads see CCOS's internal spelling. The stored coach_name is the
    // canonical value, not the raw Everfit owner name.
    const canonicalCoach = canonicalCoachName(r.coach);
    const cn = norm(canonicalCoach);
    const nm = norm(r.name);
    let clientId: number | null = null;
    if (cn && nm) clientId = byCoachName.get(`${cn}::${nm}`) ?? null;
    if (clientId === null && nm) {
      const nameHits = byNameOnly.get(nm) ?? [];
      // If exactly one client shares the name, link. Otherwise leave unmatched.
      if (nameHits.length === 1) clientId = nameHits[0];
    }
    // Preserve prior manual reconciliations: if we still can't resolve the
    // link but the row was previously linked, keep that link.
    if (clientId === null) {
      const prior = priorClientIdByEverfit.get(r.everfit_id);
      if (prior != null) clientId = prior;
    }
    if (clientId !== null) matched += 1;
    stateRows.push({
      everfit_id: r.everfit_id,
      name: r.name,
      coach_name: canonicalCoach,
      client_id: clientId,
      workouts_completed_7d: r.workouts_completed_7d,
      workouts_assigned_7d: r.workouts_assigned_7d,
      client_replies_7d: r.client_replies_7d,
      activity_7d: r.activity_7d,
      last_client_message_at: r.last_client_message_at,
      last_coach_message_at: r.last_coach_message_at,
      summary: r.summary,
      captured_at: capturedAt,
      snapshot_id: snap.id,
      updated_at: new Date().toISOString(),
    });
  }

  if (stateRows.length > 0) {
    const { error: upsertErr } = await db
      .from("everfit_v3_client_state")
      .upsert(stateRows, { onConflict: "everfit_id" });
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  // Backfill matched_count on the snapshot for reporting.
  await db
    .from("everfit_v3_snapshots")
    .update({ matched_count: matched })
    .eq("id", snap.id);

  return NextResponse.json({
    snapshotId: snap.id,
    clientsUploaded: report.clients.length,
    matched,
    unmatched: report.clients.length - matched,
    droppedRows,
  });
}
