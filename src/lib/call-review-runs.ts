// Shared run bookkeeping for every Jeremy job (call reviews, nightly briefs,
// weekly report, setter DM reviews). One table, mm_review_runs:
//   kind "call"   -> fathom_id = the recording id
//   kind "digest" -> the sales brief keys on digest_date; every other report
//                    keys on fathom_id = "<report>:<period>" (marketing:,
//                    weekly:, setter:) because mm_review_runs_kind_check only
//                    allows the two kinds and digest_date is unique.
import type { SupabaseClient } from "@supabase/supabase-js";
import { jeremySend, jeremyPoll } from "@/lib/jeremy";

type Sb = SupabaseClient;

export interface RunRow {
  id: number; kind: string; fathom_id: string | null; digest_date: string | null;
  run_id: string | null; conversation_id: string | null;
  status: string; attempts: number; created_at: string;
}

/** "call" | "digest" | "marketing" | "weekly" | "setter" */
export function runReport(run: RunRow): string {
  if (run.kind === "call") return "call";
  const id = String(run.fathom_id || "");
  const prefix = id.split(":")[0];
  return prefix && id.includes(":") ? prefix : "digest";
}

export function runLabel(run: RunRow): string {
  return run.kind === "call" ? `call:${run.fathom_id}` : `${runReport(run)}:${run.digest_date || String(run.fathom_id || "").split(":").slice(1).join(":")}`;
}

export async function markRun(sb: Sb, id: number, patch: Record<string, unknown>) {
  await sb.from("mm_review_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function upsertRun(sb: Sb, row: Record<string, unknown>, onConflict: "fathom_id" | "digest_date") {
  const { error } = await sb.from("mm_review_runs").upsert({
    ...row,
    status: "running",
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict });
  if (error) throw new Error(error.message);
}

function runKey(kind: string, key: string): { column: "digest_date" | "fathom_id"; value: string } {
  return kind === "digest" ? { column: "digest_date", value: key } : { column: "fathom_id", value: `${kind}:${key}` };
}

/** True when this report already completed for the period, or is in flight
 *  with Jeremy right now (younger than 2h) — re-running a day must never post
 *  the same brief twice or orphan a running turn. */
export async function alreadyDone(sb: Sb, kind: string, key: string): Promise<boolean> {
  const k = runKey(kind, key);
  const { data } = await sb.from("mm_review_runs").select("status,created_at").eq("kind", "digest").eq(k.column, k.value).limit(1);
  const run = data?.[0] as { status: string; created_at: string } | undefined;
  if (!run) return false;
  if (run.status === "completed") return true;
  return run.status === "running" && Date.parse(run.created_at) > Date.now() - 2 * 3600e3;
}

/**
 * Send a non-call Jeremy job and give it up to `waitMs` to finish inline;
 * otherwise the 30-minute call-reviews tick collects it through `finalize`.
 */
export async function sendAndMaybeCollect(
  sb: Sb,
  kind: string,
  key: string,
  message: string,
  finalize: (run: RunRow, reply: string) => Promise<string>,
  opts: { force?: boolean; waitMs?: number } = {}
): Promise<string> {
  if (!opts.force && (await alreadyDone(sb, kind, key))) return `${kind} already completed for ${key} (pass force=1 to redo)`;
  const res = await jeremySend(message);
  const k = runKey(kind, key);
  await upsertRun(sb, {
    kind: "digest",
    run_id: res.run_id || null,
    conversation_id: res.conversation_id || null,
    attempts: 1,
    digest_date: k.column === "digest_date" ? k.value : null,
    fathom_id: k.column === "fathom_id" ? k.value : null,
  }, k.column);
  const deadline = Date.now() + (opts.waitMs ?? 100000);
  if (deadline <= Date.now()) return `${kind} sent; the 30-min tick will collect it`;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20000));
    try {
      const poll = await jeremyPoll({ runId: res.run_id, conversationId: res.conversation_id });
      if (poll.status === "completed" && poll.reply) {
        const { data: run } = await sb.from("mm_review_runs").select("*").eq("kind", "digest").eq(k.column, k.value).maybeSingle();
        if (!run) return `${kind} completed but run row missing`;
        const what = await finalize(run as RunRow, poll.reply);
        await markRun(sb, (run as RunRow).id, { status: "completed" });
        return `${kind} ${what} (inline)`;
      }
      if (poll.status !== "running") return `${kind} failed (${poll.status}); tick will record it`;
    } catch { /* transient; retry */ }
  }
  return `${kind} running; the 30-min tick will collect it`;
}
