/**
 * Retention window API.
 *
 * POST /api/coaching/retention  { action, ... }
 *
 * Actions:
 *   * "list"          — returns every open retention cycle + its notes,
 *                       joined against the client roster. Also runs the
 *                       sync described below before returning, so the UI
 *                       always reads a consistent snapshot.
 *   * "add_note"      — writes a note. Either bulk (source='chat_batch',
 *                       fans out across every currently-open cycle with the
 *                       same batch_id) or per-client (source='manual',
 *                       clientId required).
 *   * "mark_opp_lost" — closes the client's open cycle with outcome='opp_lost'
 *                       AND flips clients.status to 'completed'.
 *   * "extend"        — closes the cycle with 'retained_4wk' or
 *                       'retained_12wk' AND pushes end_date to
 *                       MAX(current end_date, today) + N days. The MAX
 *                       guards against a heavily-negative client keeping
 *                       negative days_remaining after the extension.
 *
 * Sync invariants enforced on every "list" (and on demand via "sync"):
 *   * Every active client whose end_date::date <= today+14 has ONE open
 *     retention cycle.
 *   * A client with an open cycle who is no longer eligible (status !=
 *     'active', or end_date > today+14) has that cycle auto-closed with
 *     outcome='left_window'. The notes on that cycle stay attached to it
 *     as history; a fresh cycle opens next time the client re-enters.
 *
 * Auth: any signed-in coaching-team user.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { randomUUID } from "crypto";

const WINDOW_DAYS = 14;
const EXTEND_4W_DAYS = 28;
const EXTEND_12W_DAYS = 84;

type OpenCycleRow = {
  id: number;
  client_id: number;
  entered_window_at: string;
  end_date_at_entry: string;
};

// Sync open cycles against current client state. Returns the fresh set of
// open cycles. Called at the top of "list" and "add_note" so the UI always
// sees a self-consistent view.
async function syncOpenCycles(
  db: ReturnType<typeof getServiceSupabase>,
): Promise<OpenCycleRow[]> {
  // Snapshot the world in one query so we can diff it locally.
  const { data: clients, error: clientsErr } = await db
    .from("clients")
    .select("id, status, end_date");
  if (clientsErr) throw new Error(`clients query failed: ${clientsErr.message}`);

  const { data: openRows, error: openErr } = await db
    .from("retention_cycles")
    .select("id, client_id, entered_window_at, end_date_at_entry")
    .is("outcome", null);
  if (openErr) throw new Error(`open cycles query failed: ${openErr.message}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + WINDOW_DAYS);

  const eligibleClientIds = new Set<number>();
  const endDateByClient = new Map<number, string>();
  for (const c of (clients ?? []) as { id: number; status: string; end_date: string | null }[]) {
    if (c.status !== "active") continue;
    if (!c.end_date) continue;
    const end = new Date(c.end_date);
    if (end.getTime() <= cutoff.getTime()) {
      eligibleClientIds.add(c.id);
      endDateByClient.set(c.id, c.end_date);
    }
  }

  const openByClient = new Map<number, OpenCycleRow>();
  for (const r of (openRows ?? []) as OpenCycleRow[]) openByClient.set(r.client_id, r);

  // 1) Open a cycle for every eligible client that doesn't have one.
  const toOpen = [...eligibleClientIds]
    .filter((id) => !openByClient.has(id))
    .map((id) => ({
      client_id: id,
      end_date_at_entry: (endDateByClient.get(id) ?? "").slice(0, 10),
    }));

  if (toOpen.length > 0) {
    // Insert one at a time to survive races cleanly (unique partial index
    // rejects duplicate opens, and we don't want the whole batch to fail).
    for (const row of toOpen) {
      await db
        .from("retention_cycles")
        .insert({
          client_id: row.client_id,
          end_date_at_entry: row.end_date_at_entry,
        })
        .then(() => undefined, () => undefined); // swallow conflict
    }
  }

  // 2) Close cycles whose client is no longer eligible (status changed to
  //    completed via some other flow, or end_date was pushed out).
  const toClose = [...openByClient.entries()]
    .filter(([clientId]) => !eligibleClientIds.has(clientId))
    .map(([, row]) => row.id);

  if (toClose.length > 0) {
    await db
      .from("retention_cycles")
      .update({
        outcome: "left_window",
        outcome_at: new Date().toISOString(),
        outcome_by: "system:sync",
      })
      .in("id", toClose)
      .is("outcome", null);
  }

  // Re-read the open set after the sync so callers see the ground truth.
  const { data: refreshed, error: refreshErr } = await db
    .from("retention_cycles")
    .select("id, client_id, entered_window_at, end_date_at_entry")
    .is("outcome", null);
  if (refreshErr) throw new Error(`refresh open cycles failed: ${refreshErr.message}`);

  return (refreshed ?? []) as OpenCycleRow[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = session.user.email ?? "unknown";
  const db = getServiceSupabase();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok for list */
  }
  const action = (body.action as string) ?? "list";

  try {
    if (action === "list" || action === "sync") {
      const openCycles = await syncOpenCycles(db);

      if (openCycles.length === 0) {
        return NextResponse.json({ cycles: [] });
      }

      const clientIds = openCycles.map((c) => c.client_id);
      const cycleIds = openCycles.map((c) => c.id);

      const [clientsRes, notesRes] = await Promise.all([
        db
          .from("clients")
          .select(
            "id, name, email, coach_name, program, offer, start_date, end_date, status, phone_number",
          )
          .in("id", clientIds),
        db
          .from("retention_notes")
          .select("id, cycle_id, note_text, source, batch_id, author_email, created_at")
          .in("cycle_id", cycleIds)
          .order("created_at", { ascending: false }),
      ]);

      if (clientsRes.error) throw new Error(clientsRes.error.message);
      if (notesRes.error) throw new Error(notesRes.error.message);

      const clientById = new Map<number, Record<string, unknown>>();
      for (const c of clientsRes.data ?? []) clientById.set(c.id as number, c);

      const notesByCycle = new Map<number, unknown[]>();
      for (const n of notesRes.data ?? []) {
        const arr = notesByCycle.get(n.cycle_id as number) ?? [];
        arr.push(n);
        notesByCycle.set(n.cycle_id as number, arr);
      }

      const cycles = openCycles
        .map((cy) => {
          const client = clientById.get(cy.client_id);
          if (!client) return null;
          return {
            cycleId: cy.id,
            enteredWindowAt: cy.entered_window_at,
            endDateAtEntry: cy.end_date_at_entry,
            client,
            notes: notesByCycle.get(cy.id) ?? [],
          };
        })
        .filter(Boolean);

      return NextResponse.json({ cycles });
    }

    if (action === "add_note") {
      const text = String(body.text ?? "").trim();
      if (!text) {
        return NextResponse.json({ error: "text is required" }, { status: 400 });
      }
      const clientId = body.clientId != null ? Number(body.clientId) : null;

      // Bulk (chat_batch): fan out to every currently open cycle after a
      // sync so the note only lands on truly-open cycles.
      if (clientId == null) {
        const open = await syncOpenCycles(db);
        if (open.length === 0) {
          return NextResponse.json({ inserted: 0, batchId: null });
        }
        const batchId = randomUUID();
        const rows = open.map((c) => ({
          cycle_id: c.id,
          note_text: text,
          source: "chat_batch" as const,
          batch_id: batchId,
          author_email: userEmail,
        }));
        const { error: insErr } = await db.from("retention_notes").insert(rows);
        if (insErr) throw new Error(insErr.message);
        return NextResponse.json({ inserted: rows.length, batchId });
      }

      // Per-client manual note: needs an open cycle for that client.
      const { data: cyRow, error: cyErr } = await db
        .from("retention_cycles")
        .select("id")
        .eq("client_id", clientId)
        .is("outcome", null)
        .maybeSingle();
      if (cyErr) throw new Error(cyErr.message);
      if (!cyRow) {
        return NextResponse.json(
          { error: "Client has no open retention cycle" },
          { status: 404 },
        );
      }
      const { data: inserted, error: insErr } = await db
        .from("retention_notes")
        .insert({
          cycle_id: cyRow.id,
          note_text: text,
          source: "manual",
          author_email: userEmail,
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      return NextResponse.json({ note: inserted });
    }

    if (action === "mark_opp_lost") {
      const clientId = Number(body.clientId);
      if (!clientId) {
        return NextResponse.json({ error: "clientId required" }, { status: 400 });
      }
      // Close cycle first, then flip status. Same order = same intent even if
      // one call fails: the cycle is closed, admin can see it in history.
      const nowIso = new Date().toISOString();
      const { error: closeErr } = await db
        .from("retention_cycles")
        .update({ outcome: "opp_lost", outcome_at: nowIso, outcome_by: userEmail })
        .eq("client_id", clientId)
        .is("outcome", null);
      if (closeErr) throw new Error(closeErr.message);

      const { error: statusErr } = await db
        .from("clients")
        .update({ status: "completed" })
        .eq("id", clientId);
      if (statusErr) throw new Error(statusErr.message);
      return NextResponse.json({ ok: true });
    }

    if (action === "extend") {
      const clientId = Number(body.clientId);
      const weeks = Number(body.weeks);
      if (!clientId || (weeks !== 4 && weeks !== 12)) {
        return NextResponse.json(
          { error: "clientId and weeks (4 or 12) required" },
          { status: 400 },
        );
      }
      const addDays = weeks === 4 ? EXTEND_4W_DAYS : EXTEND_12W_DAYS;

      const { data: client, error: clientErr } = await db
        .from("clients")
        .select("id, end_date")
        .eq("id", clientId)
        .single();
      if (clientErr) throw new Error(clientErr.message);

      // MAX(current end_date, today) + addDays. A -50-day-overdue client
      // extending 4 weeks should end 28 days from today, not stay at -22.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentEnd = client?.end_date ? new Date(client.end_date) : today;
      const baseline = currentEnd.getTime() > today.getTime() ? currentEnd : today;
      const newEnd = new Date(baseline);
      newEnd.setDate(newEnd.getDate() + addDays);
      const newEndDateStr = newEnd.toISOString().slice(0, 10);

      const nowIso = new Date().toISOString();
      const outcome = weeks === 4 ? "retained_4wk" : "retained_12wk";
      const { error: closeErr } = await db
        .from("retention_cycles")
        .update({ outcome, outcome_at: nowIso, outcome_by: userEmail })
        .eq("client_id", clientId)
        .is("outcome", null);
      if (closeErr) throw new Error(closeErr.message);

      const { error: endErr } = await db
        .from("clients")
        .update({ end_date: newEndDateStr })
        .eq("id", clientId);
      if (endErr) throw new Error(endErr.message);

      return NextResponse.json({ ok: true, newEndDate: newEndDateStr });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
