// GET /api/lead-gen/poll?jobId=xxx — Poll for async enrichment results
// Called by the frontend every 5s after a Quick Scan kicks off enrichment on Apify.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const APIFY_BASE = "https://api.apify.com/v2";

// ─── Helpers (duplicated from route.ts to keep poll endpoint self-contained) ──

async function apifyGet(path: string, token: string) {
  const res = await fetch(`${APIFY_BASE}${path}?token=${token}`);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

async function apifyGetDataset(datasetId: string, token: string) {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`);
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json(); // returns array directly
}

interface LeadProfile {
  username: string;
  fullName: string;
  biography: string;
  igEmail: string;
  followersCount: number;
  postsCount: number;
  externalUrl: string;
  isBusinessAccount: boolean;
  businessCategory: string;
  profileUrl: string;
  brandSource: string;
  dataAvailable: boolean;
}

function normalizeProfile(item: any, brandSource: string): LeadProfile {
  return {
    username: item.username || item.profileUsername || item.ig_username || item.userName || "",
    fullName: item.fullName || item.name || item.profileName || "",
    biography: item.biography || item.bio || item.profileBio || "",
    igEmail: item.email || item.profileEmail || item.emailAddress || "",
    followersCount: item.followersCount || item.followers || item.profileFollowers || 0,
    postsCount: item.postsCount || item.posts || 0,
    externalUrl: item.externalUrl || item.website || item.profileWebsite || "",
    isBusinessAccount: item.isBusinessAccount || false,
    businessCategory: item.businessCategoryName || item.category || "",
    profileUrl: item.profileUrl || `https://instagram.com/${item.username || item.userName || ""}`,
    brandSource,
    dataAvailable: true,
  };
}

function extractEmailsFromBio(bio: string): string[] {
  if (!bio) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(bio.match(re) || [])];
}

// ─── GET Handler ──────────────────────────────────────────────────────────────

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

  // Fetch job
  const { data: job, error: fetchErr } = await db
    .from("lead_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // ── Already complete — return cached results ──
  if (job.status === "complete" && job.results) {
    return NextResponse.json({
      status: "complete",
      leads: job.results,
      stats: {
        scrapedCount: job.scraped_count,
        enrichedCount: job.lead_count,
        emailCount: job.email_count,
      },
    });
  }

  // ── Failed — return error ──
  if (job.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: job.error || "Enrichment failed",
    });
  }

  // ── Enriching — check Apify run status ──
  if (job.status === "enriching" && job.enrich_run_id) {
    try {
      const run = await apifyGet(`/actor-runs/${job.enrich_run_id}`, apifyToken);
      const runStatus = run.status; // READY, RUNNING, SUCCEEDED, FAILED, TIMED-OUT, ABORTED

      if (runStatus === "SUCCEEDED") {
        // Fetch enriched dataset
        const datasetId = job.enrich_dataset_id || run.defaultDatasetId;
        const enrichedItems = await apifyGetDataset(datasetId, apifyToken);

        // Build brand source lookup from stored brand_results
        const brandMap = new Map<string, string>();
        if (Array.isArray(job.brand_results)) {
          for (const br of job.brand_results) {
            brandMap.set((br.username || "").toLowerCase(), br.brandSource || "unknown");
          }
        }

        // Normalize profiles + extract emails from bios
        const leads: any[] = [];
        const enrichedMap = new Map<string, any>();

        for (const item of (Array.isArray(enrichedItems) ? enrichedItems : [])) {
          const uname = (item.username || item.profileUsername || item.ig_username || item.userName || "").toLowerCase();
          if (uname) enrichedMap.set(uname, item);
        }

        // Process all scraped usernames — merge enriched data where available
        const allUsernames = job.scraped_usernames || [];
        for (const uname of allUsernames) {
          const enriched = enrichedMap.get(uname.toLowerCase());
          if (!enriched) continue; // skip un-enriched profiles

          const brand = brandMap.get(uname.toLowerCase()) || "unknown";
          const profile = normalizeProfile(enriched, brand);

          // Extract email from profile data OR from bio
          let email = profile.igEmail;
          if (!email) {
            const bioEmails = extractEmailsFromBio(profile.biography);
            if (bioEmails.length > 0) email = bioEmails[0];
          }
          // Also check externalUrl bio text for emails
          if (!email) {
            const urlEmails = extractEmailsFromBio(profile.externalUrl);
            if (urlEmails.length > 0) email = urlEmails[0];
          }

          leads.push({
            username: profile.username,
            fullName: profile.fullName,
            igEmail: email,
            followers: profile.followersCount,
            biography: profile.biography,
            website: profile.externalUrl,
            profileUrl: profile.profileUrl,
            brandSource: profile.brandSource,
            businessCategory: profile.businessCategory,
            isBusinessAccount: profile.isBusinessAccount,
            dataAvailable: true,
          });
        }

        // Sort: leads WITH email first, then by followers desc
        leads.sort((a, b) => {
          if (a.igEmail && !b.igEmail) return -1;
          if (!a.igEmail && b.igEmail) return 1;
          return (b.followers || 0) - (a.followers || 0);
        });

        const emailCount = leads.filter((l) => l.igEmail).length;

        // Save results to Supabase
        await db.from("lead_jobs").update({
          status: "complete",
          results: leads,
          lead_count: leads.length,
          email_count: emailCount,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({
          status: "complete",
          leads,
          stats: {
            scrapedCount: job.scraped_count,
            enrichedCount: leads.length,
            emailCount,
          },
        });

      } else if (runStatus === "FAILED" || runStatus === "TIMED-OUT" || runStatus === "ABORTED") {
        // Enrichment failed
        const errMsg = `Enrichment ${runStatus.toLowerCase()}`;
        await db.from("lead_jobs").update({
          status: "failed",
          error: errMsg,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return NextResponse.json({ status: "failed", error: errMsg });

      } else {
        // Still running (READY, RUNNING)
        // Try to get progress info from run stats
        const usage = run.usage || {};
        const stats = run.stats || {};

        return NextResponse.json({
          status: "enriching",
          progress: {
            runStatus,
            startedAt: run.startedAt,
            scrapedCount: job.scraped_count,
            // Apify stats for progress estimation
            datasetItemCount: stats.datasetItemCount || 0,
            requestsFinished: stats.requestsFinished || 0,
            requestsTotal: stats.requestsTotal || job.scraped_count,
          },
        });
      }
    } catch (err: any) {
      return NextResponse.json({
        status: "enriching",
        progress: {
          runStatus: "CHECKING",
          scrapedCount: job.scraped_count,
          error: err.message?.slice(0, 100),
        },
      });
    }
  }

  // Fallback — unknown state
  return NextResponse.json({
    status: job.status,
    scrapedCount: job.scraped_count,
  });
}
