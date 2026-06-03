import { getServiceSupabase } from "@/lib/supabase";
import { getSettings, cadenceWindowHours } from "./settings";
import { generateVariationsJob, type GenerateJobResult } from "./generate";

// Auto-pre-generation hook for the Variations Factory.
//
// Once a day (wired to the daily cron — see note at the bottom) this finds the
// current WINNING ads and, for any that don't already have a recent variations
// job, generates one so ~10 fresh variations are waiting when the owner opens
// the dashboard in the morning.
//
// It is idempotent (skips ads that already have a recent job) and hard
// cost-capped (MAX_ADS_PER_RUN) so a single run can never blow the budget.

// Hard cap on how many ads get a job per run. Each ad = ~variationsPerJob
// images (default 10). 3 ads x 10 images x ~$0.04 ≈ $1.20 per run worst case.
const MAX_ADS_PER_RUN = 3;

// (Freshness window now comes from the configured cadence — see cadenceWindowHours.)

// How far back to look for spend when ranking winners.
const WINNER_LOOKBACK_DAYS = 14;

// Minimum spend (USD) over the lookback window for an ad to count as a winner
// worth varying. Cheap floor that filters out noise / barely-run ads.
const MIN_WINNER_SPEND_USD = 50;

export type PregenerateOptions = {
  // Override the per-run ad cap (still clamped to a safe maximum).
  maxAds?: number;
  // If true, ignore the freshness check and (re)generate for the top winners.
  force?: boolean;
};

export type PregenerateResult = {
  ran: boolean;
  reason?: string;
  consideredWinners: string[];
  generated: GenerateJobResult[];
  skipped: { adId: string; reason: string }[];
};

// Finds winning ads: ads with the most spend over the lookback window that ALSO
// have a stored creative image (we can only vary an ad we have a reference for).
// Returns ad_ids ranked by spend, highest first.
async function findWinnerAdIds(limit: number): Promise<string[]> {
  const db = getServiceSupabase();
  const since = new Date(Date.now() - WINNER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Sum spend per ad over the window.
  const { data: rows } = await db
    .from("ads_meta_insights_daily")
    .select("ad_id, spend_cents")
    .gte("date", since);

  const spendByAd = new Map<string, number>();
  for (const r of (rows || []) as { ad_id: string; spend_cents: number }[]) {
    if (!r.ad_id) continue;
    spendByAd.set(r.ad_id, (spendByAd.get(r.ad_id) || 0) + (r.spend_cents || 0));
  }

  const ranked = Array.from(spendByAd.entries())
    .filter(([, cents]) => cents / 100 >= MIN_WINNER_SPEND_USD)
    .sort((a, b) => b[1] - a[1])
    .map(([adId]) => adId);

  if (ranked.length === 0) return [];

  // Keep only ads we have a stored reference image for. Check a generous slice
  // of the top spenders so we can still fill `limit` after the image filter.
  const candidates = ranked.slice(0, Math.max(limit * 5, 25));
  const withImage = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const chunk = candidates.slice(i, i + 200);
    const { data } = await db
      .from("ad_creative_image")
      .select("ad_id")
      .in("ad_id", chunk)
      .not("stored_image_url", "is", null);
    (data || []).forEach((r: { ad_id: string }) => withImage.add(r.ad_id));
  }

  return candidates.filter((id) => withImage.has(id)).slice(0, limit);
}

// Returns the set of ad_ids from `adIds` that already have a job newer than the
// freshness window — these are skipped so we don't regenerate every run. The
// window is the configured cadence (daily / every 3 days / weekly), so a daily
// cron tick only regenerates an ad once per cadence period.
async function findRecentlyGenerated(adIds: string[], windowHours: number): Promise<Set<string>> {
  if (adIds.length === 0) return new Set();
  const db = getServiceSupabase();
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const fresh = new Set<string>();
  const { data } = await db
    .from("ad_variations")
    .select("source_ad_id")
    .in("source_ad_id", adIds)
    .gte("created_at", cutoff);
  (data || []).forEach((r: { source_ad_id: string }) => fresh.add(r.source_ad_id));
  return fresh;
}

// Main entry point — call this from the daily cron. Idempotent + cost-capped.
export async function pregenerateForWinners(
  opts: PregenerateOptions = {}
): Promise<PregenerateResult> {
  const settings = await getSettings();
  if (!settings.enabled) {
    return {
      ran: false,
      reason: "variations_factory disabled in settings",
      consideredWinners: [],
      generated: [],
      skipped: [],
    };
  }

  const maxAds = Math.min(Math.max(1, opts.maxAds ?? MAX_ADS_PER_RUN), MAX_ADS_PER_RUN);
  const winners = await findWinnerAdIds(maxAds);

  if (winners.length === 0) {
    return {
      ran: true,
      reason: "no eligible winning ads (need spend + stored reference image)",
      consideredWinners: [],
      generated: [],
      skipped: [],
    };
  }

  const windowHours = cadenceWindowHours(settings.cadence);
  const recent = opts.force ? new Set<string>() : await findRecentlyGenerated(winners, windowHours);

  const generated: GenerateJobResult[] = [];
  const skipped: { adId: string; reason: string }[] = [];

  for (const adId of winners) {
    if (recent.has(adId)) {
      skipped.push({ adId, reason: "already has a recent job" });
      continue;
    }
    try {
      const result = await generateVariationsJob(adId, { settings });
      generated.push(result);
    } catch (err) {
      skipped.push({
        adId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ran: true, consideredWinners: winners, generated, skipped };
}

// ---------------------------------------------------------------------------
// WIRING NOTE (not enabled here on purpose):
//
// To run this automatically each morning, add a call to the daily cron that
// already fans out the syncs:
//   src/app/api/cron/ads-tracker-sync/route.ts
// After the existing sync calls complete, do:
//   import { pregenerateForWinners } from "@/lib/ads-variations/auto";
//   const variations = await pregenerateForWinners();
// and include `variations` in the response. Because the sync runs once daily
// (Vercel Hobby cron limit), the variations job piggybacks on it with no extra
// cron entry. Alternatively add a dedicated entry to vercel.json pointing at a
// new GET route that calls pregenerateForWinners() behind the CRON_SECRET.
//
// It is intentionally LEFT UNCALLED so no mass image generation happens until
// the owner has reviewed the settings and the OPENAI_API_KEY is in place.
// ---------------------------------------------------------------------------
