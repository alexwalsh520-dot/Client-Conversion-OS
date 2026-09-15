/**
 * POST /api/coaching-v3/sheet-sync
 * GET  /api/coaching-v3/sheet-sync  — latest snapshot metadata for the sync bar
 *
 * Pulls the "Admin Everfit Client Reports" spreadsheet, parses each coach
 * tab, and writes:
 *   1. everfit_v3_weekly_reports — one row per (client, coach, week). Upserts
 *      workout_pct + note. Preserves prior client_id links (see comment).
 *   2. everfit_v3_client_state — updated from the latest week per client so
 *      the hub read model doesn't have to know the sheet exists.
 *
 * Which spreadsheet? Env var COACHING_V3_SHEET_ID, defaulting to the sheet
 * MAS gave me on 2026-09-15. Body may override with { spreadsheetId }.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { parseSheet, type ParsedRow } from "@/lib/coaching-v3/sheet-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SHEET_ID = "1BqpCkDPEWLBmStK_VQJwGe0ju8BwHWi8VzsPz39ufgY";

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
    .from("everfit_v3_sheet_snapshots")
    .select("id, pulled_at, pulled_by, spreadsheet_id, tabs_read, rows_ingested, clients_seen, errors")
    .order("pulled_at", { ascending: false })
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

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }
  const spreadsheetId =
    (body.spreadsheetId as string) ??
    process.env.COACHING_V3_SHEET_ID ??
    DEFAULT_SHEET_ID;

  let parsed;
  try {
    parsed = await parseSheet(spreadsheetId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const db = getServiceSupabase();
  const nowIso = new Date().toISOString();

  // Record a snapshot up front so weekly rows can reference it.
  const { data: snap, error: snapErr } = await db
    .from("everfit_v3_sheet_snapshots")
    .insert({
      pulled_by: session.user.email ?? "unknown",
      spreadsheet_id: spreadsheetId,
      tabs_read: parsed.tabsRead,
      rows_ingested: 0,
      clients_seen: 0,
      errors: parsed.errors,
    })
    .select("id")
    .single();
  if (snapErr || !snap) {
    return NextResponse.json(
      { error: snapErr?.message ?? "Snapshot insert failed" },
      { status: 500 },
    );
  }

  // Match every sheet row to a clients.id by (coach + name), case- and
  // space-insensitive. Fall back to unique-name.
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

  // Preserve prior manual reconciliations from weekly_reports so name-variant
  // links survive re-uploads (same idea as the JSON sync fix).
  const priorLinkByKey = new Map<string, number>(); // key = "coach::name"
  const { data: priorRows } = await db
    .from("everfit_v3_weekly_reports")
    .select("client_id, client_name, coach_name")
    .not("client_id", "is", null);
  for (const r of priorRows ?? []) {
    const key = `${norm(r.coach_name as string)}::${norm(r.client_name as string)}`;
    priorLinkByKey.set(key, r.client_id as number);
  }

  const weeklyRows: Record<string, unknown>[] = [];
  const latestByClient = new Map<
    string,
    { row: ParsedRow; latestWeek: ParsedRow["weeks"][number]; clientId: number | null }
  >();

  for (const r of parsed.rows) {
    const cn = norm(r.coachName);
    const nm = norm(r.clientName);
    let clientId: number | null = null;
    if (cn && nm) clientId = byCoachName.get(`${cn}::${nm}`) ?? null;
    if (clientId === null && nm) {
      const hits = byNameOnly.get(nm) ?? [];
      if (hits.length === 1) clientId = hits[0];
    }
    if (clientId === null) {
      const prior = priorLinkByKey.get(`${cn}::${nm}`);
      if (prior != null) clientId = prior;
    }

    // Row-level upserts, one per week.
    const sortedWeeks = [...r.weeks].sort((a, b) =>
      a.weekEndingAt > b.weekEndingAt ? -1 : 1,
    );
    for (const w of sortedWeeks) {
      weeklyRows.push({
        client_id: clientId,
        client_name: r.clientName,
        coach_name: r.coachName,
        end_date: r.endDate,
        week_label: w.weekLabel,
        week_ending_at: w.weekEndingAt,
        workout_pct: w.workoutPct,
        note: w.note,
        snapshot_id: snap.id,
        updated_at: nowIso,
      });
    }
    if (sortedWeeks.length > 0) {
      latestByClient.set(`${cn}::${nm}`, {
        row: r,
        latestWeek: sortedWeeks[0],
        clientId,
      });
    }
  }

  if (weeklyRows.length > 0) {
    // Chunk the upsert to keep payloads well under 1 MB.
    const CHUNK = 500;
    for (let i = 0; i < weeklyRows.length; i += CHUNK) {
      const chunk = weeklyRows.slice(i, i + CHUNK);
      const { error: upsertErr } = await db
        .from("everfit_v3_weekly_reports")
        .upsert(chunk, { onConflict: "client_name,coach_name,week_label" });
      if (upsertErr) {
        // Common cause: the unique index is functional (LOWER/TRIM); Supabase
        // upsert wants raw column names for onConflict. Retry with the
        // explicit merge-in-place approach if that fails.
        return NextResponse.json(
          {
            error: `Weekly reports upsert failed: ${upsertErr.message}`,
            snapshotId: snap.id,
          },
          { status: 500 },
        );
      }
    }
  }

  // Update everfit_v3_client_state so the hub keeps rendering off one table.
  // We DO NOT have an everfit_id from the sheet (only names), so we key each
  // client_state row by a synthetic id: "sheet::<coach>::<name>". Sheet-fed
  // rows and JSON-fed rows can coexist without stepping on each other.
  const stateRows: Record<string, unknown>[] = [];
  for (const [, entry] of latestByClient) {
    const { row, latestWeek, clientId } = entry;
    const synthId = `sheet::${norm(row.coachName)}::${norm(row.clientName)}`;
    // Convert the % to a fraction the same way JSON sync did (out of some
    // arbitrary "assigned" bucket). MAS's sheet doesn't ship counts, only %,
    // so we store pct in the completed/assigned pair as "pct/100" to keep
    // the existing hub display working ("N/M" turns into "pct/100"). Not
    // perfect; will show as e.g. "80/100" in the UI. If MAS wants a cleaner
    // "80%" display we adjust the render layer, not the data.
    const pct = latestWeek.workoutPct;
    stateRows.push({
      everfit_id: synthId,
      name: row.clientName,
      coach_name: row.coachName,
      client_id: clientId,
      workouts_completed_7d: pct != null ? Math.round(pct) : null,
      workouts_assigned_7d: pct != null ? 100 : null,
      client_replies_7d: null,     // sheet doesn't carry this
      activity_7d: null,           // sheet doesn't carry this
      last_client_message_at: null,
      last_coach_message_at: null,
      summary: latestWeek.note,
      captured_at: nowIso,
      snapshot_id: null,           // FK is to everfit_v3_snapshots (JSON snapshots); the sheet's own snapshot lives in everfit_v3_sheet_snapshots
      updated_at: nowIso,
    });
  }
  if (stateRows.length > 0) {
    const { error: stateErr } = await db
      .from("everfit_v3_client_state")
      .upsert(stateRows, { onConflict: "everfit_id" });
    if (stateErr) {
      return NextResponse.json(
        { error: `client_state upsert failed: ${stateErr.message}`, snapshotId: snap.id },
        { status: 500 },
      );
    }
  }

  // Roll up snapshot counters for the sync-bar display.
  await db
    .from("everfit_v3_sheet_snapshots")
    .update({
      rows_ingested: weeklyRows.length,
      clients_seen: latestByClient.size,
    })
    .eq("id", snap.id);

  const matched = [...latestByClient.values()].filter((v) => v.clientId != null).length;
  return NextResponse.json({
    snapshotId: snap.id,
    tabsRead: parsed.tabsRead,
    tabsSkipped: parsed.tabsSkipped,
    clientsSeen: latestByClient.size,
    matched,
    unmatched: latestByClient.size - matched,
    weekRowsIngested: weeklyRows.length,
    errors: parsed.errors,
  });
}
