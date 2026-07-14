// Persist the canonical per-sale attribution facts emitted by getAdsTrackerDashboard's onSaleFact
// sink into sale_attribution_facts. Upsert by sale_key so re-computing any overlapping window just
// refreshes the same rows (idempotent). Only attributed sales are emitted, so only they land here.
import { getServiceSupabase } from "@/lib/supabase";
import type { SaleFact } from "./server";

export async function persistSaleFacts(facts: SaleFact[]): Promise<number> {
  if (!facts.length) return 0;
  const sb = getServiceSupabase();
  const now = new Date().toISOString();
  // De-dupe by sale_key within this batch (a window can emit the same key twice across groups).
  const byKey = new Map<string, SaleFact>();
  for (const f of facts) if (f.sale_key) byKey.set(f.sale_key, f);
  const rows = Array.from(byKey.values()).map((f) => ({
    sale_key: f.sale_key,
    client_key: f.client_key,
    keyword_normalized: f.keyword_normalized,
    method: f.method,
    collected_cents: f.collected_cents || 0,
    contracted_cents: f.contracted_cents || 0,
    occurred_day: f.occurred_day || null,
    prospect_name: f.prospect_name || null,
    subscriber_id: f.subscriber_id || null,
    computed_at: now,
  }));
  const { error } = await sb.from("sale_attribution_facts").upsert(rows, { onConflict: "sale_key" });
  if (error) throw error;
  return rows.length;
}

// Persist the dashboard's reconciled revenue buckets for one creator, so readers cite the same
// coverage the Ads Dashboard shows (paid-attributed / organic / unattributed) instead of dividing
// raw facts by an all-source ledger. Pass payload.attribution from getAdsTrackerDashboard.
export async function persistAttributionSummary(
  clientKey: string,
  attribution: Record<string, unknown> | undefined,
  windowFrom: string | null,
  windowTo: string | null,
): Promise<void> {
  if (!attribution) return;
  const allTime = (attribution.allTime as Record<string, unknown>) || {};
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const sb = getServiceSupabase();
  await sb.from("attribution_summary").upsert({
    client_key: clientKey,
    paid_attributed: num(attribution.paidAttributedRevenue),
    organic: num(attribution.organicRevenue),
    unattributed: num(attribution.unattributedRevenue),
    total_collected: num(attribution.totalCollectedRevenue),
    all_time_paid_attributed: num(allTime.paidAttributedRevenue),
    all_time_unattributed: num(allTime.unattributedRevenue),
    window_from: windowFrom,
    window_to: windowTo,
    computed_at: new Date().toISOString(),
  }, { onConflict: "client_key" });
}
