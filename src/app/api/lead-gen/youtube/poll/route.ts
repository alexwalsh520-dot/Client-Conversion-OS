// GET /api/lead-gen/youtube/poll?jobId=xxx — YouTube Deep Dive state machine
//
// FORKED ARCHITECTURE: Re-reads parent IG job each cycle to pick up new
// no-email profiles incrementally (parent may still be running).
//
// States:
//   pending        → Process next batch of profiles via YouTube Data API
//                    (search for channel by handle → get description → extract email)
//                    Repeats until all profiles processed.
//   yt_scraping    → Submitting channels to DataOverCoffee reCAPTCHA email actor
//                    (run exits in minutes — this is expected, NOT a failure)
//   yt_processing  → Waiting for DataOverCoffee backend (3-48 hours)
//                    Uses logged-in Google accounts + CAPTCHA solving.
//                    Checks status periodically, then resurrects run to collect results.
//   complete       → Return final results
//   failed         → Return error + partial results

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const APIFY_BASE = "https://api.apify.com/v2";
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

// How many profiles to process per poll cycle (stay under 60s timeout)
const BATCH_SIZE = 15;

// DataOverCoffee reCAPTCHA email extractor — uses logged-in Google accounts
const YT_EMAIL_ACTOR = "dataovercoffee/youtube-channel-business-email-scraper";

// DataOverCoffee status API for monitoring run progress
const DOC_STATUS_API = "https://api.dataovercoffee.com/youtube/run-status";

// Only check DataOverCoffee API every 10 minutes (not every 5 seconds)
const STATUS_CHECK_INTERVAL_MS = 10 * 60 * 1000;

// Minimum wait before first resurrect attempt (3 hours)
const MIN_WAIT_BEFORE_RESURRECT_MS = 3 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractEmailsFromText(text: string): string[] {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

function addLog(logs: any[], type: string, message: string): any[] {
  return [...logs, { ts: new Date().toISOString(), type, message }];
}

async function ytApiGet(path: string, apiKey: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${YT_API_BASE}${path}${sep}key=${apiKey}`);
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error("YT_QUOTA_EXCEEDED");
    }
    return null;
  }
  return res.json();
}

// Try to find a YouTube channel for a given Instagram username/name
async function findYouTubeChannel(
  username: string,
  fullName: string,
  apiKey: string
): Promise<{
  found: boolean;
  channelId?: string;
  channelTitle?: string;
  channelHandle?: string;
  description?: string;
  subscriberCount?: number;
  channelUrl?: string;
  email?: string;
} | null> {
  // Strategy 1: Try direct handle lookup (1 quota unit — very cheap)
  try {
    const handleData = await ytApiGet(
      `/channels?part=snippet,statistics,brandingSettings&forHandle=@${username}`,
      apiKey
    );
    if (handleData?.items?.length > 0) {
      const ch = handleData.items[0];
      const desc = ch.snippet?.description || "";
      const brandDesc = ch.brandingSettings?.channel?.description || "";
      const allText = `${desc} ${brandDesc}`;
      const emails = extractEmailsFromText(allText);

      return {
        found: true,
        channelId: ch.id,
        channelTitle: ch.snippet?.title || "",
        channelHandle: ch.snippet?.customUrl || `@${username}`,
        description: desc,
        subscriberCount: parseInt(ch.statistics?.subscriberCount || "0", 10),
        channelUrl: `https://youtube.com/@${username}`,
        email: emails[0] || "",
      };
    }
  } catch (err: any) {
    if (err.message === "YT_QUOTA_EXCEEDED") throw err;
  }

  // Strategy 2: Search by full name if different from username (100 quota units)
  if (fullName && fullName.toLowerCase() !== username.toLowerCase()) {
    try {
      const searchData = await ytApiGet(
        `/search?part=snippet&q=${encodeURIComponent(fullName)}&type=channel&maxResults=3`,
        apiKey
      );
      if (searchData?.items?.length > 0) {
        const bestMatch = searchData.items.find(
          (item: any) =>
            item.snippet?.title?.toLowerCase().includes(fullName.toLowerCase()) ||
            fullName.toLowerCase().includes(item.snippet?.title?.toLowerCase())
        ) || searchData.items[0];

        const channelId = bestMatch.snippet?.channelId || bestMatch.id?.channelId;
        if (channelId) {
          const chData = await ytApiGet(
            `/channels?part=snippet,statistics,brandingSettings&id=${channelId}`,
            apiKey
          );
          if (chData?.items?.length > 0) {
            const ch = chData.items[0];
            const desc = ch.snippet?.description || "";
            const brandDesc = ch.brandingSettings?.channel?.description || "";
            const allText = `${desc} ${brandDesc}`;
            const emails = extractEmailsFromText(allText);
            const handle = ch.snippet?.customUrl || "";

            return {
              found: true,
              channelId: ch.id,
              channelTitle: ch.snippet?.title || "",
              channelHandle: handle,
              description: desc,
              subscriberCount: parseInt(ch.statistics?.subscriberCount || "0", 10),
              channelUrl: handle
                ? `https://youtube.com/${handle}`
                : `https://youtube.com/channel/${ch.id}`,
              email: emails[0] || "",
            };
          }
        }
      }
    } catch (err: any) {
      if (err.message === "YT_QUOTA_EXCEEDED") throw err;
    }
  }

  return { found: false };
}

// ─── Apify helpers ───────────────────────────────────────────────────────────

async function apifyRunActor(actorId: string, input: any, token: string, waitSecs = 0) {
  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=${waitSecs}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()).data;
}

async function apifyGet(path: string, token: string) {
  const res = await fetch(`${APIFY_BASE}${path}?token=${token}`);
  if (!res.ok) throw new Error(`Apify ${res.status}`);
  return (await res.json()).data;
}

async function apifyGetDataset(datasetId: string, token: string) {
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`
  );
  if (!res.ok) throw new Error(`Dataset ${res.status}`);
  return res.json();
}

async function apifyResurrect(runId: string, token: string) {
  const res = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}/resurrect?token=${token}`,
    { method: "POST" }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resurrect failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()).data;
}

// Check DataOverCoffee status API (returns null on failure)
async function checkDocStatus(runId: string): Promise<any> {
  try {
    const res = await fetch(`${DOC_STATUS_API}?run_id=${runId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Build final leads array from channel results
function buildFinalLeads(channelResults: any[]): any[] {
  return channelResults
    .filter((r: any) => r.email)
    .map((r: any) => ({
      username: r.igUsername,
      fullName: r.igFullName || r.channelTitle || "",
      igEmail: "",
      ytEmail: r.email,
      email: r.email,
      followers: r.igFollowers || 0,
      subscriberCount: r.subscriberCount || 0,
      channelTitle: r.channelTitle || "",
      channelUrl: r.channelUrl || "",
      profileUrl: `https://instagram.com/${r.igUsername}`,
      brandSource: r.brandSource || "",
      source: "youtube",
      emailSource: r.emailSource || "youtube_description",
    }));
}

// Deduplicate YouTube leads against delivered_emails table and within the batch
async function deduplicateYtLeads(leads: any[], db: any): Promise<any[]> {
  if (leads.length === 0) return [];
  const { data: rows } = await db.from("delivered_emails").select("email");
  const delivered = new Set((rows || []).map((e: any) => e.email.toLowerCase()));
  const seen = new Set<string>();
  return leads.filter((l: any) => {
    const e = (l.email || "").toLowerCase();
    if (!e || delivered.has(e) || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}

// ─── GET Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const ytApiKey = process.env.YOUTUBE_API_KEY;
  const apifyToken = process.env.APIFY_API_TOKEN;

  if (!ytApiKey) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY not configured" }, { status: 500 });
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

  let profiles: any[] = job.profiles_without_email || [];
  let channelResults: any[] = job.yt_channel_results || [];
  let logs: any[] = job.activity_log || [];
  const batchIndex = job.yt_batch_index || 0;
  const config: any = job.config || {};

  // ─── INCREMENTAL: Re-read parent job for new no-email profiles ──────────
  const sourceJobId = job.source_job_id;
  if (sourceJobId && job.status === "pending") {
    try {
      const { data: parentJob } = await db
        .from("lead_jobs")
        .select("found_leads, status")
        .eq("id", sourceJobId)
        .single();

      if (parentJob?.found_leads) {
        const parentNoEmail = (parentJob.found_leads as any[]).filter(
          (p: any) => p.username && !p.igEmail
        );

        const existingUsernames = new Set(
          profiles.map((p: any) => (p.username || "").toLowerCase())
        );

        const newProfiles = parentNoEmail.filter(
          (p: any) => !existingUsernames.has((p.username || "").toLowerCase())
        );

        if (newProfiles.length > 0) {
          profiles = [...profiles, ...newProfiles];
          logs = addLog(logs, "yt_sync", `+${newProfiles.length} new profiles from parent scan (${profiles.length} total)`);

          await db.from("lead_jobs").update({
            profiles_without_email: profiles,
            activity_log: logs,
            config: { ...config, profileCount: profiles.length },
          }).eq("id", jobId);
        }
      }
    } catch {
      // Parent read failed — continue with existing profiles
    }
  }

  // Shared response shape
  function makeResponse(extra: any = {}) {
    const withEmail = channelResults.filter((r: any) => r.email);
    return NextResponse.json({
      status: job.status,
      totalProfiles: profiles.length,
      profilesProcessed: Math.min(batchIndex * BATCH_SIZE, profiles.length),
      channelsFound: job.yt_channels_found || channelResults.filter((r: any) => r.found).length,
      emailsFound: job.yt_emails_found || withEmail.length,
      descriptionEmails: withEmail.filter((r: any) => r.emailSource !== "youtube_recaptcha").length,
      leads: extra.leads || withEmail,
      activityLog: logs.slice(-25),
      ...extra,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: complete
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "complete") {
    const finalLeads = (job.results || []).length > 0
      ? job.results
      : channelResults.filter((r: any) => r.email);
    return makeResponse({ status: "complete", leads: finalLeads });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: failed
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "failed") {
    return makeResponse({
      status: "failed",
      error: job.error || "Job failed",
      leads: channelResults.filter((r: any) => r.email),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: stopped
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "stopped") {
    return makeResponse({
      status: "stopped",
      leads: job.results || channelResults.filter((r: any) => r.email),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: pending → Process next batch via YouTube Data API
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "pending") {
    const startIdx = batchIndex * BATCH_SIZE;

    // All batches done?
    if (startIdx >= profiles.length) {
      // Get ALL found channels — submit them ALL to DataOverCoffee
      // (even ones with description emails — the reCAPTCHA email is the real business email)
      const allFoundChannels = channelResults.filter(
        (r: any) => r.found && (r.channelId || r.channelHandle)
      );

      if (allFoundChannels.length > 0 && apifyToken) {
        // Build channel identifiers — prefer channel IDs (most reliable)
        const channels = allFoundChannels.map((r: any) =>
          r.channelId || r.channelHandle || `@${r.igUsername}`
        );

        logs = addLog(
          logs,
          "yt_submit",
          `${allFoundChannels.length} YouTube channels found. Submitting for business email extraction (reCAPTCHA)...`
        );

        try {
          const run = await apifyRunActor(
            YT_EMAIL_ACTOR,
            { channels },
            apifyToken,
            0
          );

          await db.from("lead_jobs").update({
            status: "yt_scraping",
            yt_scrape_run_id: run.id || "",
            yt_scrape_dataset_id: run.defaultDatasetId || "",
            activity_log: logs,
            config: {
              ...config,
              yt_channels_submitted: allFoundChannels.length,
            },
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);

          return makeResponse({
            status: "yt_scraping",
            message: `Submitting ${allFoundChannels.length} channels for email extraction...`,
          });
        } catch (err: any) {
          logs = addLog(logs, "yt_submit_fail", `Email extraction unavailable: ${(err.message || "").slice(0, 80)}`);
        }
      }

      // Complete with description-only emails (no Apify token or no channels found)
      const rawLeads = buildFinalLeads(channelResults);
      const finalLeads = await deduplicateYtLeads(rawLeads, db);

      if (finalLeads.length > 0) {
        const emailRows = finalLeads.map((l: any) => ({
          email: l.email.toLowerCase(),
          username: l.username,
          job_id: jobId,
        }));
        await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
      }

      logs = addLog(
        logs,
        "complete",
        `YouTube search complete. ${finalLeads.length} description emails found from ${channelResults.filter((r: any) => r.found).length} channels.`
      );

      await db.from("lead_jobs").update({
        status: "complete",
        results: finalLeads,
        email_count: finalLeads.length,
        lead_count: channelResults.length,
        yt_emails_found: finalLeads.length,
        activity_log: logs,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      return makeResponse({ status: "complete", leads: finalLeads });
    }

    // Process this batch
    const batch = profiles.slice(startIdx, startIdx + BATCH_SIZE);
    const batchNum = batchIndex + 1;
    const totalBatches = Math.ceil(profiles.length / BATCH_SIZE);

    logs = addLog(logs, "yt_batch", `Searching YouTube — batch ${batchNum}/${totalBatches} (${batch.length} profiles)`);

    const newResults: any[] = [];
    let channelsFoundThisBatch = 0;
    let emailsFoundThisBatch = 0;
    let quotaExceeded = false;

    for (const profile of batch) {
      const username = (profile.username || "").toLowerCase();
      const fullName = profile.fullName || "";

      if (!username) continue;

      try {
        const result = await findYouTubeChannel(username, fullName, ytApiKey);

        if (result && result.found) {
          channelsFoundThisBatch++;
          const entry: any = {
            igUsername: username,
            igFullName: fullName,
            igFollowers: profile.followers || 0,
            brandSource: profile.brandSource || "",
            found: true,
            channelId: result.channelId,
            channelTitle: result.channelTitle,
            channelHandle: result.channelHandle,
            channelUrl: result.channelUrl,
            subscriberCount: result.subscriberCount,
            email: result.email || "",
            emailSource: result.email ? "youtube_description" : "",
          };

          if (result.email) {
            emailsFoundThisBatch++;
          }

          newResults.push(entry);
        } else {
          newResults.push({
            igUsername: username,
            igFullName: fullName,
            igFollowers: profile.followers || 0,
            brandSource: profile.brandSource || "",
            found: false,
          });
        }
      } catch (err: any) {
        if (err.message === "YT_QUOTA_EXCEEDED") {
          quotaExceeded = true;
          logs = addLog(logs, "yt_quota", "YouTube API quota reached. Completing with current results.");
          break;
        }
        newResults.push({
          igUsername: username,
          igFullName: fullName,
          found: false,
          error: (err.message || "").slice(0, 50),
        });
      }
    }

    const updatedResults = [...channelResults, ...newResults];
    const totalChannelsFound = updatedResults.filter((r: any) => r.found).length;
    const totalEmailsFound = updatedResults.filter((r: any) => r.email).length;

    if (channelsFoundThisBatch > 0) {
      logs = addLog(
        logs,
        "yt_found",
        `Batch ${batchNum}: ${channelsFoundThisBatch} channels found, ${emailsFoundThisBatch} with description emails`
      );
    }

    const nextBatchIndex = quotaExceeded ? Math.ceil(profiles.length / BATCH_SIZE) : batchIndex + 1;

    await db.from("lead_jobs").update({
      status: "pending",
      yt_channel_results: updatedResults,
      yt_batch_index: nextBatchIndex,
      yt_channels_found: totalChannelsFound,
      yt_emails_found: totalEmailsFound,
      activity_log: logs,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    const processed = Math.min(nextBatchIndex * BATCH_SIZE, profiles.length);
    return makeResponse({
      status: "pending",
      profilesProcessed: processed,
      channelsFound: totalChannelsFound,
      emailsFound: totalEmailsFound,
      message: quotaExceeded
        ? "YouTube API quota reached. Finalizing..."
        : `Searching YouTube... ${processed}/${profiles.length} profiles checked`,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: yt_scraping → Submission to DataOverCoffee in progress
  //
  // The DataOverCoffee actor exits quickly (within minutes). SUCCEEDED status
  // means the channels have been submitted to their backend, NOT that results
  // are ready. We transition to yt_processing to wait for actual results.
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "yt_scraping" && job.yt_scrape_run_id && apifyToken) {
    try {
      const run = await apifyGet(`/actor-runs/${job.yt_scrape_run_id}`, apifyToken);
      const runStatus = run.status;

      if (runStatus === "SUCCEEDED") {
        // DataOverCoffee: SUCCEEDED = channels submitted, NOT results ready
        // Transition to yt_processing to wait for the backend
        const now = new Date().toISOString();
        logs = addLog(
          logs,
          "yt_submitted",
          `Channels submitted for email extraction. Processing with Google accounts + reCAPTCHA solving... (typically 3-48 hours)`
        );

        await db.from("lead_jobs").update({
          status: "yt_processing",
          activity_log: logs,
          config: {
            ...config,
            yt_submitted_at: now,
            yt_last_status_check: null,
            yt_resurrected: false,
            yt_resurrect_count: 0,
          },
          updated_at: now,
        }).eq("id", jobId);

        return makeResponse({
          status: "yt_processing",
          message: "Channels submitted. Extracting business emails with Google accounts... (3-48 hours)",
          submittedAt: now,
        });

      } else if (
        runStatus === "FAILED" ||
        runStatus === "TIMED-OUT" ||
        runStatus === "ABORTED"
      ) {
        // Submission failed — complete with description-only emails
        const rawLeads = buildFinalLeads(channelResults);
        const finalLeads = await deduplicateYtLeads(rawLeads, db);

        logs = addLog(logs, "yt_submit_fail", `Channel submission ${runStatus.toLowerCase()}. Using description emails only.`);

        if (finalLeads.length > 0) {
          const emailRows = finalLeads.map((l: any) => ({
            email: l.email.toLowerCase(),
            username: l.username,
            job_id: jobId,
          }));
          await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
        }

        await db.from("lead_jobs").update({
          status: "complete",
          results: finalLeads,
          email_count: finalLeads.length,
          yt_emails_found: finalLeads.length,
          activity_log: logs,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return makeResponse({ status: "complete", leads: finalLeads });

      } else {
        // RUNNING, READY, etc — still submitting
        return makeResponse({
          status: "yt_scraping",
          message: "Submitting channels for business email extraction...",
        });
      }
    } catch {
      return makeResponse({
        status: "yt_scraping",
        message: "Submitting channels...",
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE: yt_processing → Waiting for DataOverCoffee backend
  //
  // DataOverCoffee uses a fleet of logged-in Google accounts to solve
  // reCAPTCHAs and extract the hidden "View email address" business emails.
  // This takes 3-48 hours. We check status periodically, then resurrect
  // the Apify run to collect results.
  //
  // Flow: Check status API → Ready? → Resurrect run → Fetch dataset → Complete
  // ─────────────────────────────────────────────────────────────────────────
  if (job.status === "yt_processing" && apifyToken) {
    const runId = job.yt_scrape_run_id;
    const datasetId = job.yt_scrape_dataset_id;
    const submittedAt = config.yt_submitted_at ? new Date(config.yt_submitted_at) : null;
    const lastCheck = config.yt_last_status_check ? new Date(config.yt_last_status_check) : null;
    const resurrected = config.yt_resurrected || false;
    const resurrectCount = config.yt_resurrect_count || 0;
    const now = new Date();

    if (!runId) {
      return makeResponse({ status: "yt_processing", message: "Waiting for processing..." });
    }

    const timeSinceSubmit = submittedAt ? (now.getTime() - submittedAt.getTime()) : 0;
    const timeSinceCheck = lastCheck ? (now.getTime() - lastCheck.getTime()) : Infinity;
    const hoursElapsed = Math.round(timeSinceSubmit / (60 * 60 * 1000) * 10) / 10;

    // ── If we already resurrected, check if the resurrected run completed ──
    if (resurrected) {
      try {
        const run = await apifyGet(`/actor-runs/${runId}`, apifyToken);

        if (run.status === "SUCCEEDED") {
          // Resurrected run completed — fetch results from dataset!
          const dsId = datasetId || run.defaultDatasetId;
          let items: any[] = [];
          try {
            items = await apifyGetDataset(dsId, apifyToken);
            if (!Array.isArray(items)) items = [];
          } catch {
            items = [];
          }

          // Merge DataOverCoffee results with our channel results
          const updatedResults = [...channelResults];
          let newEmailsFound = 0;

          // Log the actual DataOverCoffee output format for debugging
          if (items.length > 0) {
            const sampleKeys = Object.keys(items[0]).join(", ");
            logs = addLog(logs, "yt_dataset_keys", `DataOverCoffee fields: ${sampleKeys.slice(0, 200)}`);
          }

          let unmatchedEmails = 0;
          for (const item of items) {
            // DataOverCoffee output: try many possible field names for email
            const email =
              item.email ||
              item.businessEmail ||
              item.business_email ||
              item.channelEmail ||
              item.channel_email ||
              item.contactEmail ||
              item.contact_email ||
              item.youtubeEmail ||
              item.youtube_email ||
              "";

            if (!email) continue;

            const channelId = item.channelId || item.channel_id || item.id || "";
            const channelName = (
              item.channelName || item.channel_name || item.name ||
              item.title || item.channelTitle || item.channel_title || ""
            ).toLowerCase();
            const channelUrl = item.channelUrl || item.channel_url || item.url || item.link || "";
            const channelHandle = (
              item.handle || item.channelHandle || item.channel_handle ||
              item.customUrl || item.username || ""
            ).toLowerCase().replace(/^@/, "");

            // Match to our channel results by channelId, URL, handle, or title
            const match = updatedResults.find(
              (r: any) =>
                r.found &&
                (
                  (channelId && r.channelId === channelId) ||
                  (channelUrl && (r.channelUrl === channelUrl || channelUrl.includes(r.channelId))) ||
                  (channelHandle && (
                    r.channelHandle?.toLowerCase().replace(/^@/, "") === channelHandle ||
                    r.igUsername?.toLowerCase() === channelHandle
                  )) ||
                  (channelName && r.channelTitle?.toLowerCase() === channelName)
                )
            );

            if (match) {
              // DataOverCoffee reCAPTCHA email takes priority over description email
              match.email = email;
              match.emailSource = "youtube_recaptcha";
              newEmailsFound++;
            } else {
              unmatchedEmails++;
            }
          }

          if (unmatchedEmails > 0) {
            logs = addLog(logs, "yt_unmatched", `${unmatchedEmails} DataOverCoffee emails couldn't be matched to channels`);
          }

          const rawLeads = buildFinalLeads(updatedResults);
          const finalLeads = await deduplicateYtLeads(rawLeads, db);

          logs = addLog(
            logs,
            "yt_results",
            `Business email extraction complete! ${newEmailsFound} reCAPTCHA emails found. ${finalLeads.length} total emails.`
          );

          // Save to delivered_emails
          if (finalLeads.length > 0) {
            const emailRows = finalLeads.map((l: any) => ({
              email: l.email.toLowerCase(),
              username: l.username,
              job_id: jobId,
            }));
            await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
          }

          await db.from("lead_jobs").update({
            status: "complete",
            yt_channel_results: updatedResults,
            results: finalLeads,
            email_count: finalLeads.length,
            lead_count: updatedResults.length,
            yt_emails_found: finalLeads.length,
            activity_log: logs,
            updated_at: now.toISOString(),
          }).eq("id", jobId);

          return makeResponse({ status: "complete", leads: finalLeads });

        } else if (run.status === "RUNNING" || run.status === "READY") {
          // Resurrected run still processing — wait
          return makeResponse({
            status: "yt_processing",
            message: "Collecting business emails from resurrected run...",
            submittedAt: config.yt_submitted_at,
            hoursElapsed,
            resurrected: true,
          });

        } else if (run.status === "FAILED" || run.status === "TIMED-OUT" || run.status === "ABORTED") {
          // Resurrect failed — try again if we haven't exceeded max retries
          if (resurrectCount < 3) {
            logs = addLog(logs, "yt_resurrect_retry", `Resurrect attempt ${resurrectCount + 1} failed. Retrying...`);
            await db.from("lead_jobs").update({
              config: { ...config, yt_resurrected: false, yt_resurrect_count: resurrectCount + 1 },
              activity_log: logs,
            }).eq("id", jobId);
            // Will retry on next poll
          } else {
            // Max retries — complete with what we have
            const rawLeads = buildFinalLeads(channelResults);
            const finalLeads = await deduplicateYtLeads(rawLeads, db);
            logs = addLog(logs, "yt_resurrect_fail", "Max resurrect attempts reached. Completing with description emails.");

            if (finalLeads.length > 0) {
              const emailRows = finalLeads.map((l: any) => ({
                email: l.email.toLowerCase(),
                username: l.username,
                job_id: jobId,
              }));
              await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
            }

            await db.from("lead_jobs").update({
              status: "complete",
              results: finalLeads,
              email_count: finalLeads.length,
              yt_emails_found: finalLeads.length,
              activity_log: logs,
              updated_at: now.toISOString(),
            }).eq("id", jobId);

            return makeResponse({ status: "complete", leads: finalLeads });
          }
        }
      } catch {
        // Apify API error — wait and retry
        return makeResponse({
          status: "yt_processing",
          message: "Checking results...",
          submittedAt: config.yt_submitted_at,
          hoursElapsed,
          resurrected: true,
        });
      }
    }

    // ── Not yet resurrected — check if results are ready ──────────────────

    // Throttle status checks (every 10 minutes max)
    if (timeSinceCheck < STATUS_CHECK_INTERVAL_MS) {
      return makeResponse({
        status: "yt_processing",
        message: `Extracting business emails with Google accounts... ${hoursElapsed}h elapsed`,
        submittedAt: config.yt_submitted_at,
        hoursElapsed,
        resurrected: false,
      });
    }

    // Check DataOverCoffee status API
    let shouldResurrect = false;
    try {
      const docStatus = await checkDocStatus(runId);
      if (docStatus) {
        const status = (docStatus.status || "").toLowerCase();
        if (status === "completed" || status === "ready" || status === "done") {
          shouldResurrect = true;
          logs = addLog(logs, "yt_ready", "DataOverCoffee reports results ready. Collecting...");
        }
      }
    } catch {
      // Status API failed — fall through to time-based check
    }

    // Fallback: If enough time has passed, try to resurrect anyway
    if (!shouldResurrect && timeSinceSubmit >= MIN_WAIT_BEFORE_RESURRECT_MS) {
      shouldResurrect = true;
      logs = addLog(logs, "yt_time_resurrect", `${hoursElapsed}h elapsed. Attempting to collect results...`);
    }

    if (shouldResurrect) {
      try {
        await apifyResurrect(runId, apifyToken);
        logs = addLog(logs, "yt_resurrect", "Run resurrected. Collecting business emails...");

        await db.from("lead_jobs").update({
          config: {
            ...config,
            yt_resurrected: true,
            yt_last_status_check: now.toISOString(),
            yt_resurrect_count: resurrectCount + 1,
          },
          activity_log: logs,
          updated_at: now.toISOString(),
        }).eq("id", jobId);

        return makeResponse({
          status: "yt_processing",
          message: "Results ready! Collecting business emails...",
          submittedAt: config.yt_submitted_at,
          hoursElapsed,
          resurrected: true,
        });
      } catch (err: any) {
        // Resurrect failed — update last check time and wait
        logs = addLog(logs, "yt_resurrect_wait", `Not ready yet (${(err.message || "").slice(0, 50)}). Will check again in 10 min.`);

        await db.from("lead_jobs").update({
          config: { ...config, yt_last_status_check: now.toISOString() },
          activity_log: logs,
          updated_at: now.toISOString(),
        }).eq("id", jobId);
      }
    } else {
      // Just update the last check time
      await db.from("lead_jobs").update({
        config: { ...config, yt_last_status_check: now.toISOString() },
        updated_at: now.toISOString(),
      }).eq("id", jobId);
    }

    return makeResponse({
      status: "yt_processing",
      message: `Extracting business emails with Google accounts... ${hoursElapsed}h elapsed`,
      submittedAt: config.yt_submitted_at,
      hoursElapsed,
      resurrected: false,
    });
  }

  // Unknown state
  return makeResponse({});
}
