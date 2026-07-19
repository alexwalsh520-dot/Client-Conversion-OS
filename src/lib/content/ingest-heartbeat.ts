// The ingest heartbeat — "when did the pipeline last successfully pull from Instagram?"
//
// This exists because the first freshness signal measured the wrong thing. It used
// max(creator_content.created_at), which only advances when a genuinely NEW post is inserted —
// upserting 600 unchanged rows does not touch created_at. So a perfectly healthy pipeline looked
// "28h stale" simply because the creator hadn't posted, and the two states were indistinguishable:
//
//   pipeline dead              -> nobody notices (the real incident)
//   creator just hasn't posted -> false alarm (what actually happened Jul 18-19)
//
// The heartbeat separates them. content_pipeline_runs already records every run's per-step body, so
// no new table is needed: the newest run whose ingest step reported body.ok is the last real sync.

import type { SupabaseClient } from "@supabase/supabase-js";

export type IngestHeartbeat = {
  last_ok_at: string | null; // when the ingest last genuinely succeeded
  age_hours: number | null;
  stale: boolean; // the PIPELINE is behind — not a statement about whether the creator posted
  last_upserted: number | null;
};

// A run is a successful ingest when the child returned 2xx AND its body did not report ok:false.
// (The ingest route answers 207 with ok:false on partial failure, and `fetch().ok` is true for 207 —
// which is exactly how a failing ingest passed as green.)
function ingestStepOk(steps: unknown): { ok: boolean; upserted: number | null } {
  const arr = Array.isArray(steps) ? steps : [];
  for (const s of arr as Array<Record<string, unknown>>) {
    const path = String(s.path || "");
    if (!path.includes("/api/content/ingest") || path.includes("apify")) continue;
    const body = (s.body || null) as { ok?: boolean; results?: Array<{ ok?: boolean; upserted?: number }> } | null;
    if (!body || body.ok === false) return { ok: false, upserted: null };
    const first = body.results && body.results[0];
    return { ok: true, upserted: typeof first?.upserted === "number" ? first.upserted : null };
  }
  return { ok: false, upserted: null };
}

const STALE_AFTER_HOURS = 6;

export async function getIngestHeartbeat(sb: SupabaseClient): Promise<IngestHeartbeat> {
  // The fast cron runs every 2h, so a couple of dozen rows comfortably covers the staleness window.
  const { data } = await sb
    .from("content_pipeline_runs")
    .select("ran_at, steps")
    .eq("cron_name", "content-pipeline")
    .order("ran_at", { ascending: false })
    .limit(30);

  for (const row of (data || []) as Array<{ ran_at: string; steps: unknown }>) {
    const steps = typeof row.steps === "string" ? JSON.parse(row.steps || "[]") : row.steps;
    const r = ingestStepOk(steps);
    if (r.ok) {
      const ageHours = (Date.now() - new Date(row.ran_at).getTime()) / 3_600_000;
      return {
        last_ok_at: row.ran_at,
        age_hours: Math.round(ageHours * 10) / 10,
        stale: ageHours > STALE_AFTER_HOURS,
        last_upserted: r.upserted,
      };
    }
  }
  // No successful ingest inside the window we can see — that is genuinely stale.
  return { last_ok_at: null, age_hours: null, stale: true, last_upserted: null };
}
