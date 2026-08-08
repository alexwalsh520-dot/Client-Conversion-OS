// ─────────────────────────────────────────────────────────────────────────
// TRUTH LAYER BRICK 5 — the forward write.
//
// The backfill sweeps history. This is how the bridge stays current: a capture
// path that sees two ids on one payload says so, once, as it runs.
//
// It ENQUEUES rather than linking inline, and that is deliberate. These call
// sites are webhooks and sync loops in the middle of the lead path. A webhook
// that blocks on bookkeeping is a webhook that drops leads, and a webhook that
// throws on bookkeeping is worse. registry_persons_backfill drains the queue
// on its own schedule, where being slow costs nothing.
//
// So this function never throws and never returns a failure the caller has to
// handle. Losing a queue row costs one link that the next backfill sweep will
// find again from the row that was stored anyway; letting a queue row cost a
// lead would be the expensive kind of mistake.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";

export type BridgeSystem = "manychat" | "ig_scoped" | "ghl" | "tracker_name";

export interface BridgeEvidence {
  systemA: BridgeSystem;
  idA: string | null | undefined;
  systemB?: BridgeSystem;
  idB?: string | null | undefined;
  /** The stored row or payload that carried both ids. Never optional. */
  source: string;
  /** Only a path that genuinely saw both ids on one payload may say "hard". */
  confidence?: "hard" | "name_match";
  displayName?: string | null;
  clientKey?: string | null;
}

/**
 * Record that one payload carried two ids for the same human.
 *
 * Fire and forget, in the same shape the door's own logging uses: the try wraps
 * the CALL, not only the promise, because `db.from(...).insert(...)` can throw
 * synchronously and a lone `.catch()` never runs when it does.
 */
export function enqueuePersonLink(evidence: BridgeEvidence): void {
  const idA = evidence.idA?.toString().trim();
  if (!idA) return;
  const idB = evidence.idB?.toString().trim() || null;

  try {
    const db = getServiceSupabase();
    void Promise.resolve(
      db.from("registry_person_link_queue").insert({
        system_a: evidence.systemA,
        id_a: idA,
        system_b: idB ? evidence.systemB ?? null : null,
        id_b: idB,
        source: evidence.source,
        confidence: evidence.confidence ?? "hard",
        display_name: evidence.displayName ?? null,
        client_key: evidence.clientKey ?? null,
      }),
    ).catch(() => {});
  } catch {
    // Deliberately silent. See the header: this must never cost a caller
    // anything, and the evidence itself is stored elsewhere regardless.
  }
}
