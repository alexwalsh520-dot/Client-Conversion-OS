/**
 * Daily Coacher summary regen cron — runs every 3 days at 3:00 UTC.
 *
 * For every active client whose summary is stale OR missing AND whose
 * created_at is at least 24 hours old, regenerate the summary in
 * parallel batches.
 *
 * Cost discipline: only regens clients that actually need it (input
 * timestamp > summary_updated_at OR no summary). On a typical run,
 * expect ~20-50 of the 227 active clients to qualify, ~$0.60-$1.50/run.
 *
 * The 24-hour gate gives Nicole time to attach the onboarding Fathom
 * link and the intake form before the first generation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { regenerateAndPersistSummary } from "@/lib/daily-coacher/summary-generator";

export const runtime = "nodejs";
export const maxDuration = 300;

const PARALLEL_BATCH = 5;
const NEW_CLIENT_DELAY_HOURS = 24;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
}

interface ClientRow {
  id: number;
  name: string;
  nutrition_form_id: number | null;
  daily_coacher_summary: string | null;
  daily_coacher_summary_updated_at: string | null;
  onboarding_transcript_fetched_at: string | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const startedAt = Date.now();
  const newClientCutoff = new Date(Date.now() - NEW_CLIENT_DELAY_HOURS * 60 * 60 * 1000).toISOString();

  // 1. Active clients older than 24h
  const { data: clientsData, error: clientsErr } = await db
    .from("clients")
    .select("id, name, nutrition_form_id, daily_coacher_summary, daily_coacher_summary_updated_at, onboarding_transcript_fetched_at, created_at")
    .eq("status", "active")
    .lte("created_at", newClientCutoff);
  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }
  const clients = (clientsData ?? []) as ClientRow[];

  if (clients.length === 0) {
    return NextResponse.json({ regenerated: 0, scanned: 0, elapsed_ms: Date.now() - startedAt });
  }

  // 2. Determine which need regen by comparing input timestamps to summary timestamp
  const clientIds = clients.map((c) => c.id);
  const clientNames = clients.map((c) => c.name);
  const intakeIds = clients.map((c) => c.nutrition_form_id).filter((x): x is number => x != null);

  const [notesAgg, meetingsAgg, liveAgg, intakeAgg] = await Promise.all([
    db.from("client_notes").select("client_name, created_at").in("client_name", clientNames),
    db.from("coach_meetings").select("client_id, created_at").in("client_id", clientIds),
    db.from("daily_coacher_live_messages").select("client_id, created_at").in("client_id", clientIds),
    intakeIds.length > 0
      ? db.from("nutrition_intake_forms").select("id, synced_at").in("id", intakeIds)
      : Promise.resolve({ data: [] as Array<{ id: number; synced_at: string | null }>, error: null }),
  ]);

  const latestNoteByName = new Map<string, string>();
  for (const r of (notesAgg.data ?? []) as Array<{ client_name: string; created_at: string }>) {
    const cur = latestNoteByName.get(r.client_name);
    if (!cur || r.created_at > cur) latestNoteByName.set(r.client_name, r.created_at);
  }
  const latestMeetingById = new Map<number, string>();
  for (const r of (meetingsAgg.data ?? []) as Array<{ client_id: number; created_at: string }>) {
    const cur = latestMeetingById.get(r.client_id);
    if (!cur || r.created_at > cur) latestMeetingById.set(r.client_id, r.created_at);
  }
  const latestLiveById = new Map<number, string>();
  for (const r of (liveAgg.data ?? []) as Array<{ client_id: number; created_at: string }>) {
    const cur = latestLiveById.get(r.client_id);
    if (!cur || r.created_at > cur) latestLiveById.set(r.client_id, r.created_at);
  }
  const intakeSyncedById = new Map<number, string | null>();
  for (const r of (intakeAgg.data ?? []) as Array<{ id: number; synced_at: string | null }>) {
    intakeSyncedById.set(r.id, r.synced_at);
  }

  const candidates: ClientRow[] = clients.filter((c) => {
    const inputs = [
      c.onboarding_transcript_fetched_at,
      latestNoteByName.get(c.name) ?? null,
      latestMeetingById.get(c.id) ?? null,
      latestLiveById.get(c.id) ?? null,
      c.nutrition_form_id ? intakeSyncedById.get(c.nutrition_form_id) ?? null : null,
    ].filter((t): t is string => Boolean(t));
    if (inputs.length === 0 && !c.daily_coacher_summary) {
      // No summary AND no inputs — skip (nothing to summarize meaningfully).
      // The summary generator handles sparse data, but generating a
      // "no info on file" summary every 3 days is wasteful.
      return false;
    }
    if (!c.daily_coacher_summary) return true; // backfill
    if (!c.daily_coacher_summary_updated_at) return true;
    const summaryAt = c.daily_coacher_summary_updated_at;
    return inputs.some((t) => t > summaryAt);
  });

  // 3. Regen in small parallel batches to keep DB + Anthropic load reasonable
  let regenerated = 0;
  const failures: Array<{ id: number; name: string; error: string }> = [];

  for (let i = 0; i < candidates.length; i += PARALLEL_BATCH) {
    const batch = candidates.slice(i, i + PARALLEL_BATCH);
    const results = await Promise.allSettled(batch.map((c) => regenerateAndPersistSummary(c.id)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value) {
        regenerated++;
      } else if (r.status === "rejected") {
        failures.push({ id: batch[j].id, name: batch[j].name, error: r.reason instanceof Error ? r.reason.message : "unknown" });
      }
    }
  }

  return NextResponse.json({
    scanned: clients.length,
    candidates: candidates.length,
    regenerated,
    failures,
    elapsed_ms: Date.now() - startedAt,
  });
}
