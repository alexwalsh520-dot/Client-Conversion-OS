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
 *   * "extend_days"   — MAS 2026-09-17: same additive extension as
 *                       "extend" but with an arbitrary day count (1..365).
 *                       Cycle closes with outcome='retained_manual' once
 *                       the push clears the 14-day window; the KPI counts
 *                       it as a retention.
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
      if (!client?.end_date) {
        return NextResponse.json(
          { error: "Client has no end_date; cannot extend." },
          { status: 400 },
        );
      }

      // Additive on end_date. MAS's rule (2026-09-15): "the client's end date
      // gets the appropriate amount of days ADDED to their program." A client
      // at -139 days extending +12 weeks lands at -55, still in the retention
      // window; they only exit when the new date pushes days_remaining past 14
      // or they are marked opp lost. Earlier MAX-of-today logic was wrong.
      const currentEnd = new Date(client.end_date);
      const newEnd = new Date(currentEnd);
      newEnd.setDate(newEnd.getDate() + addDays);
      const newEndDateStr = newEnd.toISOString().slice(0, 10);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newDaysRemaining = Math.round(
        (newEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Fetch the open cycle so we can log the extension as a note either way.
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

      // Update end_date first.
      const { error: endErr } = await db
        .from("clients")
        .update({ end_date: newEndDateStr })
        .eq("id", clientId);
      if (endErr) throw new Error(endErr.message);

      // Log the extension on the cycle so the coach can see when and by whom
      // an extension happened, even if the cycle stays open.
      const remainingLabel =
        newDaysRemaining >= 0 ? `+${newDaysRemaining}` : String(newDaysRemaining);
      await db.from("retention_notes").insert({
        cycle_id: cyRow.id,
        note_text: `Extended +${weeks} weeks. New end date ${newEndDateStr} (${remainingLabel} days remaining).`,
        source: "manual",
        author_email: userEmail,
      });

      // Only close the cycle when the extension truly moves the client past
      // the 14-day threshold. Otherwise they stay on the retention tab with
      // their notes intact until the next action (opp lost, another
      // extension that clears the threshold, or a further slip past that
      // eventually forces opp_lost).
      let cycleClosed = false;
      if (newDaysRemaining > WINDOW_DAYS) {
        const outcome = weeks === 4 ? "retained_4wk" : "retained_12wk";
        const nowIso = new Date().toISOString();
        const { error: closeErr } = await db
          .from("retention_cycles")
          .update({ outcome, outcome_at: nowIso, outcome_by: userEmail })
          .eq("id", cyRow.id)
          .is("outcome", null);
        if (closeErr) throw new Error(closeErr.message);
        cycleClosed = true;
      }

      return NextResponse.json({
        ok: true,
        newEndDate: newEndDateStr,
        newDaysRemaining,
        stillInWindow: !cycleClosed,
      });
    }

    if (action === "edit_note") {
      const noteId = Number(body.noteId);
      const text = String(body.text ?? "").trim();
      if (!noteId || !text) {
        return NextResponse.json(
          { error: "noteId and non-empty text required" },
          { status: 400 },
        );
      }
      // Only manual notes are editable (MAS 2026-09-17). chat_batch and
      // system-authored notes stay immutable audit trail.
      const { data: cur, error: readErr } = await db
        .from("retention_notes")
        .select("id, source")
        .eq("id", noteId)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!cur) {
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      }
      if (cur.source !== "manual") {
        return NextResponse.json(
          { error: `Only manual notes are editable (this note is '${cur.source}').` },
          { status: 400 },
        );
      }
      const { data: updated, error: updErr } = await db
        .from("retention_notes")
        .update({ note_text: text })
        .eq("id", noteId)
        .select()
        .single();
      if (updErr) throw new Error(updErr.message);
      return NextResponse.json({ note: updated });
    }

    if (action === "extend_days") {
      const clientId = Number(body.clientId);
      const daysRaw = Number(body.days);
      if (!clientId || !Number.isFinite(daysRaw)) {
        return NextResponse.json(
          { error: "clientId and days (integer, 1-365) required" },
          { status: 400 },
        );
      }
      const days = Math.floor(daysRaw);
      if (days < 1 || days > 365) {
        return NextResponse.json(
          { error: "days must be between 1 and 365" },
          { status: 400 },
        );
      }

      const { data: client, error: clientErr } = await db
        .from("clients")
        .select("id, end_date")
        .eq("id", clientId)
        .single();
      if (clientErr) throw new Error(clientErr.message);
      if (!client?.end_date) {
        return NextResponse.json(
          { error: "Client has no end_date; cannot extend." },
          { status: 400 },
        );
      }

      // Same additive rule as the fixed 4wk/12wk buttons: end_date + N days.
      const currentEnd = new Date(client.end_date);
      const newEnd = new Date(currentEnd);
      newEnd.setDate(newEnd.getDate() + days);
      const newEndDateStr = newEnd.toISOString().slice(0, 10);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newDaysRemaining = Math.round(
        (newEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

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

      const { error: endErr } = await db
        .from("clients")
        .update({ end_date: newEndDateStr })
        .eq("id", clientId);
      if (endErr) throw new Error(endErr.message);

      const remainingLabel =
        newDaysRemaining >= 0 ? `+${newDaysRemaining}` : String(newDaysRemaining);
      await db.from("retention_notes").insert({
        cycle_id: cyRow.id,
        note_text: `Manual increase +${days} day${days === 1 ? "" : "s"}. New end date ${newEndDateStr} (${remainingLabel} days remaining).`,
        source: "manual",
        author_email: userEmail,
      });

      // Only close the cycle when the manual extension clears the 14-day
      // window, mirroring the +4wk / +12wk logic. When it does, stamp
      // outcome='retained_manual' so the KPI counts it and history stays
      // distinguishable from a preset retention.
      let cycleClosed = false;
      if (newDaysRemaining > WINDOW_DAYS) {
        const nowIso = new Date().toISOString();
        const { error: closeErr } = await db
          .from("retention_cycles")
          .update({
            outcome: "retained_manual",
            outcome_at: nowIso,
            outcome_by: userEmail,
          })
          .eq("id", cyRow.id)
          .is("outcome", null);
        if (closeErr) throw new Error(closeErr.message);
        cycleClosed = true;
      }

      return NextResponse.json({
        ok: true,
        newEndDate: newEndDateStr,
        newDaysRemaining,
        stillInWindow: !cycleClosed,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
