// GET /api/lead-gen/poll?jobId=xxx — State machine that drives the entire pipeline
//
// States:
//   pending    → Start scraping brand[current_brand_index] followers (async)
//   scraping   → Check Apify run → when done, start enrichment (async)
//   enriching  → Check Apify run → extract emails → if target met: complete
//                                                  → else: next brand (pending)
//   complete   → Return final results
//   stopped    → Return saved partial results
//   failed     → Return error + partial results
//
// CRITICAL FIX: All emailsFound responses now use DEDUPED count against
// delivered_emails table, preventing UI from showing inflated numbers.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const APIFY_BASE = "https://api.apify.com/v2";

// Following scraper actors — try no-cookie first, cookie fallback
const FOLLOWING_ACTORS = [
  "scraping_solutions~instagram-scraper-followers-following-no-cookies",
  "sejinius~instagram-following-scraper-pay-as-you-go",
];

// Enrichment actor (coderx — works on free tier)
const ENRICHMENT_ACTOR = "PP60E1JIfagMaQxIP";

const ENRICH_BATCH_SIZE = 100;
const MAX_FOLLOWING_PER_BRAND = 500;

// No hardcoded brand list — brands come from brand_bank via job config

// ─── Apify helpers ───────────────────────────────────────────────────────────

async function apifyGet(path: string, token: string) {
  const res = await fetch(`${APIFY_BASE}${path}?token=${token}`);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${res.statusText}`);
  return (await res.json()).data;
}

async function apifyRunActor(actorId: string, input: any, token: string, waitSecs = 0) {
  const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=${waitSecs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()).data;
}

async function apifyGetDataset(datasetId: string, token: string) {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`);
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json();
}

// ─── Actor input builders ─────────────────────────────────────────────────────

function buildFollowingInput(actorId: string, brand: string): any {
  if (actorId.includes("scraping_solutions") || actorId.includes("instagram-scraper-followers-following")) {
    return {
      Account: [brand],
      resultsLimit: MAX_FOLLOWING_PER_BRAND,
      dataToScrape: "Followings",
    };
  }
  if (actorId.includes("sejinius") || actorId.includes("instagram-following-scraper")) {
    return { userName: brand };
  }
  return { usernames: [brand] };
}

// ─── Email extraction ────────────────────────────────────────────────────────

function extractEmailsFromText(text: string): string[] {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

function normalizeProfile(item: any, brandSource: string) {
  const username = (item.username || item.profileUsername || item.ig_username || item.userName || "").toLowerCase();
  const biography = item.biography || item.bio || item.profileBio || "";
  const externalUrl = item.externalUrl || item.external_url || item.website || item.profileWebsite || "";

  let email = item.email || item.profileEmail || item.emailAddress || "";
  if (!email) {
    const bioEmails = extractEmailsFromText(biography);
    if (bioEmails.length > 0) email = bioEmails[0];
  }
  if (!email) {
    const urlEmails = extractEmailsFromText(externalUrl);
    if (urlEmails.length > 0) email = urlEmails[0];
  }

  return {
    username,
    fullName: item.fullName || item.name || item.profileName || "",
    igEmail: email,
    followers: item.followersCount || item.followers || item.profileFollowers || 0,
    biography,
    website: externalUrl,
    profileUrl: item.profileUrl || `https://instagram.com/${username}`,
    brandSource,
    businessCategory: item.businessCategoryName || item.category || "",
    isBusinessAccount: item.isBusinessAccount || false,
  };
}

// ─── Activity log helper ──────────────────────────────────────────────────────

function addLog(logs: any[], type: string, message: string): any[] {
  return [...logs, { ts: new Date().toISOString(), type, message }];
}

// ─── Deduplication helper ──────────────────────────────────────────────────────
// Returns [dedupedLeads, dedupedCount] — consistent across all responses

function deduplicateLeads(emailLeads: any[], deliveredSet: Set<string>): any[] {
  const seen = new Set<string>();
  return emailLeads.filter((l: any) => {
    const e = l.igEmail.toLowerCase();
    if (deliveredSet.has(e) || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}

// ─── Per-brand stats helper ─────────────────────────────────────────────────

function computeBrandResults(foundLeads: any[]): Record<string, any> {
  const results: Record<string, any> = {};
  for (const lead of foundLeads) {
    const brand = lead.brandSource || "unknown";
    if (!results[brand]) {
      results[brand] = { scraped: 0, withEmail: 0, withoutEmail: 0 };
    }
    results[brand].scraped++;
    if (lead.igEmail) results[brand].withEmail++;
    else results[brand].withoutEmail++;
  }
  return results;
}

// ─── GET Handler (State Machine) ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const db = getServiceSupabase();

  const { data: job, error: fetchErr } = await db
    .from("lead_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const target = job.target_emails || 100;
  const foundLeads: any[] = job.found_leads || [];
  const emailLeads = foundLeads.filter((l: any) => l.igEmail);
  let logs: any[] = job.activity_log || [];
  const brandsCompleted: string[] = job.brands_completed || [];

  // Read brands from job config
  const BRAND_ACCOUNTS: string[] = job.config?.allBrands || job.config?.brandAccounts || [];
  const cachedBrands: Set<string> = new Set(job.config?.brandsCached || []);

  // ─── CRITICAL FIX: Load delivered emails ONCE, compute deduped count ──────
  // This ensures ALL responses show the accurate deduped count
  const { data: deliveredEmailRows } = await db.from("delivered_emails").select("email");
  const deliveredSet = new Set((deliveredEmailRows || []).map((e: any) => e.email.toLowerCase()));
  const dedupedEmailLeads = deduplicateLeads(emailLeads, deliveredSet);
  const dedupedCount = dedupedEmailLeads.length;
  const totalScraped = foundLeads.length;
  const profilesWithoutEmail = foundLeads.filter((l: any) => !l.igEmail).length;

  // Brand results for dashboard
  const brandResults = computeBrandResults(foundLeads);

  // Base response shape used everywhere
  const baseResponse = {
    target,
    brands: BRAND_ACCOUNTS,
    brandsCompleted,
    totalScraped,
    profilesWithoutEmail,
    brandResults,
    rawEmailCount: emailLeads.length,
    leads: dedupedEmailLeads,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: complete
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "complete") {
    return NextResponse.json({
      ...baseResponse,
      status: "complete",
      leads: job.results || dedupedEmailLeads,
      emailsFound: (job.results || dedupedEmailLeads).length,
      currentBrand: job.current_brand || "",
      currentBrandIndex: job.current_brand_index || 0,
      activityLog: logs.slice(-30),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: failed
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "failed") {
    return NextResponse.json({
      ...baseResponse,
      status: "failed",
      error: job.error || "Job failed",
      leads: dedupedEmailLeads,
      emailsFound: dedupedCount,
      currentBrand: job.current_brand || "",
      activityLog: logs.slice(-30),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: stopped — User manually stopped, return saved results
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "stopped") {
    return NextResponse.json({
      ...baseResponse,
      status: "stopped",
      leads: job.results || dedupedEmailLeads,
      emailsFound: (job.results || dedupedEmailLeads).length,
      currentBrand: job.current_brand || "",
      currentBrandIndex: job.current_brand_index || 0,
      activityLog: logs.slice(-30),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: pending → Start scraping next brand's followers
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "pending") {
    const brandIndex = job.current_brand_index || 0;

    // ── Target check BEFORE starting a new brand ──────────────────────────
    if (dedupedCount >= target) {
      const finalLeads = dedupedEmailLeads
        .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0))
        .slice(0, target);
      if (finalLeads.length > 0) {
        const emailRows = finalLeads.map((l: any) => ({
          email: l.igEmail.toLowerCase(),
          username: l.username,
          job_id: jobId,
        }));
        await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
      }
      logs = addLog(logs, "complete", `Target reached! ${finalLeads.length} unique emails from ${brandsCompleted.length} brands.`);
      await db.from("lead_jobs").update({
        status: "complete",
        found_leads: foundLeads,
        results: finalLeads,
        lead_count: foundLeads.length,
        email_count: finalLeads.length,
        brands_completed: brandsCompleted,
        brand_results: brandResults,
        activity_log: logs,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      return NextResponse.json({
        ...baseResponse,
        status: "complete",
        leads: finalLeads,
        emailsFound: finalLeads.length,
        currentBrand: "",
        activityLog: logs.slice(-30),
      });
    }

    // Check if we've exhausted all brands
    if (brandIndex >= BRAND_ACCOUNTS.length) {
      const finalLeads = dedupedEmailLeads
        .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0))
        .slice(0, target);

      if (finalLeads.length > 0) {
        const emailRows = finalLeads.map((l: any) => ({
          email: l.igEmail.toLowerCase(),
          username: l.username,
          job_id: jobId,
        }));
        await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
      }

      logs = addLog(logs, "complete", `All ${BRAND_ACCOUNTS.length} brands processed. Found ${finalLeads.length} emails.`);

      await db.from("lead_jobs").update({
        status: "complete",
        results: finalLeads,
        found_leads: foundLeads,
        lead_count: foundLeads.length,
        email_count: finalLeads.length,
        brand_results: brandResults,
        activity_log: logs,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      return NextResponse.json({
        ...baseResponse,
        status: "complete",
        leads: finalLeads,
        emailsFound: finalLeads.length,
        currentBrand: "",
        activityLog: logs.slice(-30),
      });
    }

    const brand = BRAND_ACCOUNTS[brandIndex];

    // ── CACHE CHECK: Skip Apify scrape if brand is cached ──────────────────
    if (cachedBrands.has(brand)) {
      // Load unenriched usernames from scraped_profiles
      const { data: unenrichedRows } = await db
        .from("scraped_profiles")
        .select("username")
        .eq("brand_source", brand)
        .is("enriched_at", null);

      const unenriched = (unenrichedRows || []).map((r: any) => r.username);

      if (unenriched.length === 0) {
        // Brand fully processed — skip entirely
        logs = addLog(logs, "brand_cached", `@${brand}: Already scraped & enriched (cached). Skipping.`);
        const updatedCompleted = [...brandsCompleted, brand];
        await db.from("lead_jobs").update({
          status: "pending",
          current_brand_index: brandIndex + 1,
          current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
          scrape_actor_index: 0,
          brands_completed: updatedCompleted,
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: "pending",
          emailsFound: dedupedCount,
          currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
          currentBrandIndex: brandIndex + 1,
          brandsCompleted: updatedCompleted,
          message: `@${brand}: cached ✓ — skipping`,
          activityLog: logs.slice(-30),
        });
      }

      // Has unenriched profiles — skip scrape, go straight to enrichment
      logs = addLog(logs, "enrich_cached", `@${brand}: ${unenriched.length} unenriched profiles from cache (skipping scrape)`);
      const firstBatch = unenriched.slice(0, ENRICH_BATCH_SIZE);
      const remainingQueue = unenriched.slice(ENRICH_BATCH_SIZE);

      try {
        const enrichRun = await apifyRunActor(ENRICHMENT_ACTOR, { usernames: firstBatch }, apifyToken, 0);
        await db.from("lead_jobs").update({
          status: "enriching",
          current_brand: brand,
          current_brand_index: brandIndex,
          enrich_run_id: enrichRun.id || "",
          enrich_dataset_id: enrichRun.defaultDatasetId || "",
          enrich_queue: remainingQueue,
          scraped_usernames: unenriched,
          scraped_count: (job.scraped_count || 0) + unenriched.length,
          batch_number: 1,
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: "enriching",
          emailsFound: dedupedCount,
          currentBrand: brand,
          currentBrandIndex: brandIndex,
          message: `@${brand}: Enriching ${unenriched.length} cached profiles...`,
          activityLog: logs.slice(-30),
        });
      } catch (err: any) {
        logs = addLog(logs, "enrich_error", `@${brand}: Enrichment from cache failed: ${(err.message || "").slice(0, 60)}`);
        // Skip brand
        await db.from("lead_jobs").update({
          status: "pending",
          current_brand_index: brandIndex + 1,
          current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
          brands_completed: [...brandsCompleted, brand],
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: "pending",
          emailsFound: dedupedCount,
          currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
          currentBrandIndex: brandIndex + 1,
          message: `@${brand}: cache enrichment failed, moving on...`,
          activityLog: logs.slice(-30),
        });
      }
    }

    // ── NORMAL PATH: Scrape followers from Apify ─────────────────────────
    const actorIndex = job.scrape_actor_index || 0;
    const actorId = FOLLOWING_ACTORS[actorIndex] || FOLLOWING_ACTORS[0];

    logs = addLog(logs, "scrape_start", `Scraping @${brand} followers... (brand ${brandIndex + 1}/${BRAND_ACCOUNTS.length})`);

    try {
      const input = buildFollowingInput(actorId, brand);
      const run = await apifyRunActor(actorId, input, apifyToken, 0);

      logs = addLog(logs, "scrape_running", `@${brand}: Apify run started (${actorId.split("~")[0]})`);

      await db.from("lead_jobs").update({
        status: "scraping",
        current_brand: brand,
        current_brand_index: brandIndex,
        scrape_run_id: run.id || "",
        scrape_dataset_id: run.defaultDatasetId || "",
        scrape_actor_index: actorIndex,
        activity_log: logs,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      return NextResponse.json({
        ...baseResponse,
        status: "scraping",
        emailsFound: dedupedCount,
        currentBrand: brand,
        currentBrandIndex: brandIndex,
        message: `Scraping @${brand} followers...`,
        activityLog: logs.slice(-30),
      });
    } catch (err: any) {
      // If first actor fails, try second
      if (actorIndex === 0 && FOLLOWING_ACTORS.length > 1) {
        logs = addLog(logs, "scrape_retry", `@${brand}: Actor 1 failed, trying actor 2...`);
        await db.from("lead_jobs").update({
          scrape_actor_index: 1,
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: "pending",
          emailsFound: dedupedCount,
          currentBrand: brand,
          currentBrandIndex: brandIndex,
          message: `Retrying @${brand} with backup scraper...`,
          activityLog: logs.slice(-30),
        });
      }

      // Skip this brand
      logs = addLog(logs, "scrape_skip", `@${brand}: All scrapers failed, skipping. (${(err.message || "").slice(0, 60)})`);
      await db.from("lead_jobs").update({
        status: "pending",
        current_brand_index: brandIndex + 1,
        current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
        scrape_actor_index: 0,
        brands_completed: [...brandsCompleted, brand],
        activity_log: logs,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      return NextResponse.json({
        ...baseResponse,
        status: "pending",
        emailsFound: dedupedCount,
        currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
        currentBrandIndex: brandIndex + 1,
        brandsCompleted: [...brandsCompleted, brand],
        message: `Skipped @${brand}, moving to next...`,
        activityLog: logs.slice(-30),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: scraping → Check if followers scrape is done
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "scraping" && job.scrape_run_id) {
    try {
      const run = await apifyGet(`/actor-runs/${job.scrape_run_id}`, apifyToken);
      const runStatus = run.status;
      const brand = job.current_brand || "unknown";
      const brandIndex = job.current_brand_index || 0;

      if (runStatus === "SUCCEEDED") {
        const datasetId = job.scrape_dataset_id || run.defaultDatasetId;
        const items = await apifyGetDataset(datasetId, apifyToken);
        const followers = Array.isArray(items) ? items : [];

        const usernameSet = new Set<string>();
        for (const item of followers) {
          const uname = (item.username || item.profileUsername || item.ig_username || item.userName || "").toLowerCase();
          if (uname) usernameSet.add(uname);
        }
        const usernames = Array.from(usernameSet);

        logs = addLog(logs, "scrape_done", `@${brand}: Found ${usernames.length} followers`);

        // ── Save scraped followers to scraped_profiles cache ──────────────
        if (usernames.length > 0) {
          const profileRows = usernames.map((u: string) => ({
            username: u,
            brand_source: brand,
            has_email: false,
          }));
          // Batch upsert in chunks of 100
          for (let i = 0; i < profileRows.length; i += 100) {
            await db.from("scraped_profiles")
              .upsert(profileRows.slice(i, i + 100), { onConflict: "username,brand_source" });
          }
          // Update brand_bank
          await db.from("brand_bank").update({
            last_scraped_at: new Date().toISOString(),
            followers_scraped: usernames.length,
          }).eq("handle", brand);
        }

        // ── Filter out already-enriched usernames ────────────────────────
        const { data: alreadyEnrichedRows } = await db
          .from("scraped_profiles")
          .select("username")
          .in("username", usernames.slice(0, 500))
          .not("enriched_at", "is", null);

        const enrichedSet = new Set((alreadyEnrichedRows || []).map((r: any) => r.username));
        const toEnrich = usernames.filter((u: string) => !enrichedSet.has(u));

        if (toEnrich.length < usernames.length) {
          logs = addLog(logs, "enrich_skip_cached", `@${brand}: ${usernames.length - toEnrich.length} profiles already enriched, ${toEnrich.length} to enrich`);
        }

        if (usernames.length === 0) {
          logs = addLog(logs, "scrape_empty", `@${brand}: 0 results, moving to next brand`);
          await db.from("lead_jobs").update({
            status: "pending",
            current_brand_index: brandIndex + 1,
            current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
            scrape_run_id: "",
            scrape_dataset_id: "",
            scrape_actor_index: 0,
            brands_completed: [...brandsCompleted, brand],
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "pending",
            emailsFound: dedupedCount,
            currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
            currentBrandIndex: brandIndex + 1,
            brandsCompleted: [...brandsCompleted, brand],
            message: `@${brand}: no followers found, trying next brand...`,
            activityLog: logs.slice(-30),
          });
        }

        // All scraped profiles already enriched? Skip to next brand
        if (toEnrich.length === 0) {
          logs = addLog(logs, "enrich_skip_all", `@${brand}: All ${usernames.length} profiles already enriched. Skipping.`);
          const updatedCompleted = [...brandsCompleted, brand];
          await db.from("lead_jobs").update({
            status: "pending",
            current_brand_index: brandIndex + 1,
            current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
            scrape_run_id: "",
            scrape_dataset_id: "",
            scrape_actor_index: 0,
            brands_completed: updatedCompleted,
            scraped_count: (job.scraped_count || 0) + usernames.length,
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "pending",
            emailsFound: dedupedCount,
            currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
            currentBrandIndex: brandIndex + 1,
            brandsCompleted: updatedCompleted,
            message: `@${brand}: all profiles already enriched — skipping`,
            activityLog: logs.slice(-30),
          });
        }

        // Start enrichment — batch the unenriched profiles only
        const firstBatch = toEnrich.slice(0, ENRICH_BATCH_SIZE);
        const remainingQueue = toEnrich.slice(ENRICH_BATCH_SIZE);

        logs = addLog(logs, "enrich_start", `@${brand}: Enriching ${firstBatch.length} profiles (batch 1/${Math.ceil(toEnrich.length / ENRICH_BATCH_SIZE)})...`);

        try {
          const enrichRun = await apifyRunActor(ENRICHMENT_ACTOR, { usernames: firstBatch }, apifyToken, 0);

          await db.from("lead_jobs").update({
            status: "enriching",
            enrich_run_id: enrichRun.id || "",
            enrich_dataset_id: enrichRun.defaultDatasetId || "",
            enrich_queue: remainingQueue,
            scraped_usernames: usernames,
            scraped_count: (job.scraped_count || 0) + usernames.length,
            batch_number: 1,
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "enriching",
            emailsFound: dedupedCount,
            currentBrand: brand,
            currentBrandIndex: brandIndex,
            message: `@${brand}: Enriching profiles for emails...`,
            enrichBatch: 1,
            enrichTotalBatches: Math.ceil(toEnrich.length / ENRICH_BATCH_SIZE),
            activityLog: logs.slice(-30),
          });
        } catch (err: any) {
          logs = addLog(logs, "enrich_error", `@${brand}: Enrichment failed to start: ${(err.message || "").slice(0, 60)}`);
          await db.from("lead_jobs").update({
            status: "pending",
            current_brand_index: brandIndex + 1,
            current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
            scrape_actor_index: 0,
            brands_completed: [...brandsCompleted, brand],
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "pending",
            emailsFound: dedupedCount,
            currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
            currentBrandIndex: brandIndex + 1,
            brandsCompleted: [...brandsCompleted, brand],
            message: `@${brand}: enrichment failed, trying next brand...`,
            activityLog: logs.slice(-30),
          });
        }

      } else if (runStatus === "FAILED" || runStatus === "TIMED-OUT" || runStatus === "ABORTED") {
        const actorIndex = job.scrape_actor_index || 0;

        if (actorIndex < FOLLOWING_ACTORS.length - 1) {
          logs = addLog(logs, "scrape_retry", `@${brand}: Scraper ${runStatus.toLowerCase()}, trying backup...`);
          await db.from("lead_jobs").update({
            status: "pending",
            scrape_actor_index: actorIndex + 1,
            scrape_run_id: "",
            scrape_dataset_id: "",
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "pending",
            emailsFound: dedupedCount,
            currentBrand: brand,
            currentBrandIndex: brandIndex,
            message: `@${brand}: retrying with backup scraper...`,
            activityLog: logs.slice(-30),
          });
        }

        logs = addLog(logs, "scrape_skip", `@${brand}: All scrapers failed (${runStatus}), skipping`);
        await db.from("lead_jobs").update({
          status: "pending",
          current_brand_index: brandIndex + 1,
          current_brand: BRAND_ACCOUNTS[brandIndex + 1] || "",
          scrape_actor_index: 0,
          scrape_run_id: "",
          scrape_dataset_id: "",
          brands_completed: [...brandsCompleted, brand],
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: "pending",
          emailsFound: dedupedCount,
          currentBrand: BRAND_ACCOUNTS[brandIndex + 1] || "",
          currentBrandIndex: brandIndex + 1,
          brandsCompleted: [...brandsCompleted, brand],
          message: `@${brand}: scraping failed, moving on...`,
          activityLog: logs.slice(-30),
        });

      } else {
        // Still running
        const stats = run.stats || {};
        return NextResponse.json({
          ...baseResponse,
          status: "scraping",
          emailsFound: dedupedCount,
          currentBrand: brand,
          currentBrandIndex: brandIndex,
          message: `Scraping @${brand} followers...`,
          runProgress: { datasetItemCount: stats.datasetItemCount || 0 },
          activityLog: logs.slice(-30),
        });
      }
    } catch (err: any) {
      return NextResponse.json({
        ...baseResponse,
        status: "scraping",
        emailsFound: dedupedCount,
        currentBrand: job.current_brand || "",
        currentBrandIndex: job.current_brand_index || 0,
        message: `Checking scrape status... (${(err.message || "").slice(0, 40)})`,
        activityLog: logs.slice(-30),
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: enriching → Check if enrichment batch is done
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "enriching" && job.enrich_run_id) {
    try {
      const run = await apifyGet(`/actor-runs/${job.enrich_run_id}`, apifyToken);
      const runStatus = run.status;
      const brand = job.current_brand || "unknown";
      const brandIndex = job.current_brand_index || 0;

      if (runStatus === "SUCCEEDED") {
        const datasetId = job.enrich_dataset_id || run.defaultDatasetId;
        const enrichedItems = await apifyGetDataset(datasetId, apifyToken);

        // Process enriched items
        const newLeads: any[] = [];
        for (const item of (Array.isArray(enrichedItems) ? enrichedItems : [])) {
          const profile = normalizeProfile(item, brand);
          newLeads.push(profile);
        }

        const allFoundLeads = [...foundLeads, ...newLeads];
        const allEmailLeads = allFoundLeads.filter((l: any) => l.igEmail);

        // ── Update scraped_profiles with enrichment results ──────────────
        if (newLeads.length > 0) {
          const enrichNow = new Date().toISOString();
          const withEmail = newLeads.filter((l: any) => l.igEmail && l.username).map((l: any) => l.username);
          const withoutEmail = newLeads.filter((l: any) => !l.igEmail && l.username).map((l: any) => l.username);

          if (withEmail.length > 0) {
            await db.from("scraped_profiles")
              .update({ enriched_at: enrichNow, has_email: true })
              .in("username", withEmail)
              .eq("brand_source", brand);
          }
          if (withoutEmail.length > 0) {
            await db.from("scraped_profiles")
              .update({ enriched_at: enrichNow, has_email: false })
              .in("username", withoutEmail)
              .eq("brand_source", brand);
          }
        }

        // Dedup against delivered_emails (using the set loaded at top)
        const newDedupedLeads = deduplicateLeads(allEmailLeads, deliveredSet);
        const emailCount = newDedupedLeads.length;
        const newTotalScraped = allFoundLeads.length;
        const newProfilesNoEmail = allFoundLeads.filter((l: any) => !l.igEmail).length;
        const newBrandResults = computeBrandResults(allFoundLeads);

        // Count new emails found this batch
        const prevDeduped = dedupedCount;
        const newEmailsThisBatch = emailCount - prevDeduped;

        logs = addLog(logs, "enrich_done", `@${brand}: +${Math.max(0, newEmailsThisBatch)} new emails (${emailCount}/${target} total)`);

        const enrichQueue: string[] = job.enrich_queue || [];

        // More profiles from THIS brand to enrich AND not at target yet?
        if (enrichQueue.length > 0 && emailCount < target) {
          const nextBatch = enrichQueue.slice(0, ENRICH_BATCH_SIZE);
          const remainingQueue = enrichQueue.slice(ENRICH_BATCH_SIZE);
          const batchNum = (job.batch_number || 1) + 1;

          logs = addLog(logs, "enrich_start", `@${brand}: Enriching batch ${batchNum} (${nextBatch.length} profiles)...`);

          try {
            const newRun = await apifyRunActor(ENRICHMENT_ACTOR, { usernames: nextBatch }, apifyToken, 0);

            await db.from("lead_jobs").update({
              enrich_run_id: newRun.id || "",
              enrich_dataset_id: newRun.defaultDatasetId || "",
              enrich_queue: remainingQueue,
              found_leads: allFoundLeads,
              batch_number: batchNum,
              brand_results: newBrandResults,
              activity_log: logs,
              updated_at: new Date().toISOString(),
            }).eq("id", jobId);

            return NextResponse.json({
              ...baseResponse,
              status: "enriching",
              emailsFound: emailCount,
              rawEmailCount: allEmailLeads.length,
              leads: newDedupedLeads,
              totalScraped: newTotalScraped,
              profilesWithoutEmail: newProfilesNoEmail,
              brandResults: newBrandResults,
              currentBrand: brand,
              currentBrandIndex: brandIndex,
              message: `@${brand}: ${emailCount}/${target} emails — enriching batch ${batchNum}...`,
              enrichBatch: batchNum,
              activityLog: logs.slice(-30),
            });
          } catch {
            logs = addLog(logs, "enrich_error", `@${brand}: Next batch failed, finishing brand`);
          }
        }

        // Brand done (or target reached) — check if we're done overall
        if (emailCount >= target) {
          // TARGET REACHED! Complete the job
          const finalLeads = newDedupedLeads
            .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0))
            .slice(0, target);

          if (finalLeads.length > 0) {
            const emailRows = finalLeads.map((l: any) => ({
              email: l.igEmail.toLowerCase(),
              username: l.username,
              job_id: jobId,
            }));
            await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
          }

          logs = addLog(logs, "complete", `Target reached! ${finalLeads.length} unique emails collected from ${[...brandsCompleted, brand].length} brands.`);

          await db.from("lead_jobs").update({
            status: "complete",
            found_leads: allFoundLeads,
            results: finalLeads,
            lead_count: allFoundLeads.length,
            email_count: finalLeads.length,
            brands_completed: [...brandsCompleted, brand],
            brand_results: newBrandResults,
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "complete",
            leads: finalLeads,
            emailsFound: finalLeads.length,
            rawEmailCount: allEmailLeads.length,
            totalScraped: newTotalScraped,
            profilesWithoutEmail: newProfilesNoEmail,
            brandResults: newBrandResults,
            currentBrand: brand,
            currentBrandIndex: brandIndex,
            brandsCompleted: [...brandsCompleted, brand],
            activityLog: logs.slice(-30),
          });
        }

        // Not at target yet — move to next brand
        const nextBrandIndex = brandIndex + 1;
        const updatedBrandsCompleted = [...brandsCompleted, brand];

        if (nextBrandIndex >= BRAND_ACCOUNTS.length) {
          // No more brands — complete with what we have
          const finalLeads = newDedupedLeads
            .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0));

          if (finalLeads.length > 0) {
            const emailRows = finalLeads.map((l: any) => ({
              email: l.igEmail.toLowerCase(),
              username: l.username,
              job_id: jobId,
            }));
            await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
          }

          logs = addLog(logs, "complete", `All brands exhausted. Found ${finalLeads.length}/${target} emails.`);

          await db.from("lead_jobs").update({
            status: "complete",
            found_leads: allFoundLeads,
            results: finalLeads,
            lead_count: allFoundLeads.length,
            email_count: finalLeads.length,
            brands_completed: updatedBrandsCompleted,
            brand_results: newBrandResults,
            activity_log: logs,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return NextResponse.json({
            ...baseResponse,
            status: "complete",
            leads: finalLeads,
            emailsFound: finalLeads.length,
            rawEmailCount: allEmailLeads.length,
            totalScraped: newTotalScraped,
            profilesWithoutEmail: newProfilesNoEmail,
            brandResults: newBrandResults,
            currentBrand: "",
            brandsCompleted: updatedBrandsCompleted,
            activityLog: logs.slice(-30),
          });
        }

        // Move to next brand
        logs = addLog(logs, "brand_done", `@${brand}: Done. ${emailCount}/${target} emails so far. Moving to @${BRAND_ACCOUNTS[nextBrandIndex]}...`);

        await db.from("lead_jobs").update({
          status: "pending",
          current_brand_index: nextBrandIndex,
          current_brand: BRAND_ACCOUNTS[nextBrandIndex],
          scrape_run_id: "",
          scrape_dataset_id: "",
          scrape_actor_index: 0,
          enrich_run_id: "",
          enrich_dataset_id: "",
          enrich_queue: [],
          found_leads: allFoundLeads,
          brands_completed: updatedBrandsCompleted,
          brand_results: newBrandResults,
          batch_number: 0,
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: "pending",
          emailsFound: emailCount,
          rawEmailCount: allEmailLeads.length,
          leads: newDedupedLeads,
          totalScraped: newTotalScraped,
          profilesWithoutEmail: newProfilesNoEmail,
          brandResults: newBrandResults,
          currentBrand: BRAND_ACCOUNTS[nextBrandIndex],
          currentBrandIndex: nextBrandIndex,
          brandsCompleted: updatedBrandsCompleted,
          message: `@${brand} done (${emailCount} emails). Next: @${BRAND_ACCOUNTS[nextBrandIndex]}`,
          activityLog: logs.slice(-30),
        });

      } else if (runStatus === "FAILED" || runStatus === "TIMED-OUT" || runStatus === "ABORTED") {
        logs = addLog(logs, "enrich_error", `@${brand}: Enrichment ${runStatus.toLowerCase()}`);

        const enrichQueue: string[] = job.enrich_queue || [];
        if (enrichQueue.length > 0) {
          const nextBatch = enrichQueue.slice(0, ENRICH_BATCH_SIZE);
          const remainingQueue = enrichQueue.slice(ENRICH_BATCH_SIZE);
          try {
            const newRun = await apifyRunActor(ENRICHMENT_ACTOR, { usernames: nextBatch }, apifyToken, 0);
            logs = addLog(logs, "enrich_retry", `@${brand}: Retrying with next batch...`);
            await db.from("lead_jobs").update({
              enrich_run_id: newRun.id || "",
              enrich_dataset_id: newRun.defaultDatasetId || "",
              enrich_queue: remainingQueue,
              batch_number: (job.batch_number || 1) + 1,
              activity_log: logs,
              updated_at: new Date().toISOString(),
            }).eq("id", jobId);

            return NextResponse.json({
              ...baseResponse,
              status: "enriching",
              emailsFound: dedupedCount,
              currentBrand: brand,
              currentBrandIndex: brandIndex,
              message: `@${brand}: retrying enrichment...`,
              activityLog: logs.slice(-30),
            });
          } catch { /* fall through */ }
        }

        // Skip to next brand
        const nextBrandIndex = brandIndex + 1;
        logs = addLog(logs, "brand_skip", `@${brand}: Enrichment failed, moving on`);

        const isDone = nextBrandIndex >= BRAND_ACCOUNTS.length;
        await db.from("lead_jobs").update({
          status: isDone ? "complete" : "pending",
          current_brand_index: nextBrandIndex,
          current_brand: BRAND_ACCOUNTS[nextBrandIndex] || "",
          scrape_actor_index: 0,
          enrich_run_id: "",
          enrich_queue: [],
          brands_completed: [...brandsCompleted, brand],
          brand_results: brandResults,
          activity_log: logs,
          ...(isDone ? {
            results: dedupedEmailLeads,
            email_count: dedupedCount,
            lead_count: foundLeads.length,
          } : {}),
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          ...baseResponse,
          status: isDone ? "complete" : "pending",
          emailsFound: dedupedCount,
          leads: isDone ? dedupedEmailLeads : undefined,
          currentBrand: BRAND_ACCOUNTS[nextBrandIndex] || "",
          currentBrandIndex: nextBrandIndex,
          brandsCompleted: [...brandsCompleted, brand],
          message: `@${brand}: enrichment failed, ${isDone ? "finishing up" : "trying next brand"}...`,
          activityLog: logs.slice(-30),
        });

      } else {
        // Still running
        const stats = run.stats || {};
        return NextResponse.json({
          ...baseResponse,
          status: "enriching",
          emailsFound: dedupedCount,
          currentBrand: brand,
          currentBrandIndex: brandIndex,
          message: `@${brand}: Extracting emails from profiles...`,
          enrichBatch: job.batch_number || 1,
          runProgress: {
            datasetItemCount: stats.datasetItemCount || 0,
            requestsFinished: stats.requestsFinished || 0,
          },
          activityLog: logs.slice(-30),
        });
      }
    } catch (err: any) {
      return NextResponse.json({
        ...baseResponse,
        status: "enriching",
        emailsFound: dedupedCount,
        currentBrand: job.current_brand || "",
        currentBrandIndex: job.current_brand_index || 0,
        message: `Checking enrichment... (${(err.message || "").slice(0, 40)})`,
        activityLog: logs.slice(-30),
      });
    }
  }

  // Unknown state — return current info
  return NextResponse.json({
    ...baseResponse,
    status: job.status,
    emailsFound: dedupedCount,
    currentBrand: job.current_brand || "",
    currentBrandIndex: job.current_brand_index || 0,
    activityLog: logs.slice(-30),
  });
}
