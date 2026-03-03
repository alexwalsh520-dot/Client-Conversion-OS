// POST /api/lead-gen — Run the fitness influencer lead gen pipeline
// Streams SSE progress events to the client
// GET /api/lead-gen — Return recent runs + stored leads

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ApifyClient } from "apify-client";
import Anthropic from "@anthropic-ai/sdk";

// ─── Types ──────────────────────────────────────────────────────────────────────

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
  recentPosts: any[];
  brandSource: string;
  _brandSource?: string;
  // Engagement
  engagementRate: number | null;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  dataAvailable: boolean;
  postsAnalyzed: number;
  // Scoring
  score: number;
  reason: string;
  monetization: string;
  // YouTube
  youtubeChannel: string | null;
  youtubeMethod: string | null;
  youtubeChannelId: string | null;
}

interface PipelineConfig {
  brandAccounts: string[];
  maxFollowingPerBrand: number;
  minFollowers: number;
  maxFollowers: number;
  minEngagementRate: number;
  minAvgReelViews: number;
  minScore: number;
  model: string;
  concurrency: number;
  icpPrompt: string;
}

// ─── Default Config ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PipelineConfig = {
  brandAccounts: [
    "gymshark", "1stphorm", "youngla", "darcsport", "alphaleteathletics",
    "nvgtn", "ghostlifestyle", "rawgear", "gymreapers", "gorillawear",
    "musclenation", "buffbunnyco", "rabornyofficial",
  ],
  maxFollowingPerBrand: 500,
  minFollowers: 100000,
  maxFollowers: 5000000,
  minEngagementRate: 2.0,
  minAvgReelViews: 50000,
  minScore: 60,
  model: "claude-sonnet-4-5-20250929",
  concurrency: 10,
  icpPrompt: `You score fitness influencer leads for a digital marketing agency that builds Instagram ad funnels to help fitness influencers sell coaching programs.

You are ONLY judging ICP fit — whether this person is the right type of creator for our service.

WHO WE WANT (score 70-100):
- Fitness influencers focused on gym/weightlifting/bodybuilding/physique/strength
- English-speaking, English audience (US/UK/Canada/Australia)
- Currently monetizing ONLY through brand deals, discount codes, cheap ebooks, or nothing at all

ONE HARD DISQUALIFIER (score 0):
- Bio contains a DM-based coaching CTA: 'DM me for coaching', 'DM for 1:1', etc.

OTHER DISQUALIFIERS (score 0-10):
- OnlyFans-primary account
- Gym owner / brick-and-mortar personal training business
- Supplement brand account (not a person)
- Non-English content

SCORING GUIDE:
90-100: Perfect lead. Gym content creator, big audience, no real coaching funnel
70-89: Strong lead. Right niche, minor uncertainty
40-69: Maybe. Some signals right but significant uncertainty
10-39: Probably not. Multiple concerning signals
0-9: Disqualified`,
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function levenshteinSimilarity(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const matrix: number[][] = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - matrix[b.length][a.length] / maxLen;
}

// ─── Pipeline Steps ─────────────────────────────────────────────────────────────

// Hash IDs are Apify's internal IDs — more reliable than slug lookups
const FOLLOWING_ACTORS = [
  "w0pct4EQqHEnWRnj8",                                   // louisdeconinck/instagram-following-scraper
  "XLJHmaoDGuFYahmgm",                                   // figue/instagram-followers-and-following-scrapper
  "louisdeconinck/instagram-following-scraper",            // slug fallback
  "figue/instagram-followers-and-following-scrapper",      // slug fallback
];

async function findFollowingActor(apify: ApifyClient, send: (e: string, d: any) => void): Promise<string> {
  for (const id of FOLLOWING_ACTORS) {
    try {
      const actor = await apify.actor(id).get();
      if (actor) {
        send("log", { message: `Found actor: ${actor.name || id}` });
        return id;
      }
    } catch (err: any) {
      send("log", { message: `Actor ${id}: ${err.message?.slice(0, 80) || "not found"}` });
      continue;
    }
  }
  throw new Error("No Instagram following scraper found on Apify. Make sure your APIFY_API_TOKEN is valid.");
}

function getInstagramCookies(): string {
  const raw = process.env.INSTAGRAM_COOKIES || "";
  return raw.trim();
}

function cookieFields(cookies: string): Record<string, string> {
  if (!cookies) return {};
  // Actors use different field names for cookies — include all common ones
  return { cookie: cookies, cookies: cookies, sessionCookie: cookies };
}

async function scrapeBrandFollowing(
  apify: ApifyClient,
  actorId: string,
  brand: string,
  maxResults: number
): Promise<any[]> {
  const cf = cookieFields(getInstagramCookies());
  const inputVariants = [
    { username: brand, resultsLimit: maxResults, listType: "following", ...cf },
    { usernames: [brand], resultsLimit: maxResults, listType: "following", ...cf },
    { username: brand, maxResults, listType: "following", ...cf },
    { profileUrl: `https://instagram.com/${brand}`, limit: maxResults, ...cf },
  ];

  let lastError: Error | null = null;
  for (const input of inputVariants) {
    try {
      const run = await apify.actor(actorId).call(input, { waitSecs: 300 });
      const { items } = await apify.dataset(run.defaultDatasetId).listItems();
      return items.map((item: any) => ({ ...item, _brandSource: brand }));
    } catch (err: any) {
      lastError = err;
      const msg = err.message || "";
      if (msg.includes("INPUT_SCHEMA_VIOLATION") || msg.includes("is not valid") || msg.includes("is required")) {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error(`All input formats failed for ${actorId}`);
}

function filterByFollowers(profiles: any[], min: number, max: number) {
  return profiles.filter((p) => {
    const followers = p.followersCount || p.followers || p.followerCount || 0;
    return followers >= min && followers <= max;
  });
}

function deduplicateProfiles(profiles: any[]) {
  const byUsername = new Map<string, any>();
  for (const p of profiles) {
    const username = (p.username || p.profileUsername || p.ig_username || "").toLowerCase();
    if (!username) continue;
    if (byUsername.has(username)) {
      const existing = byUsername.get(username);
      const existingBrands = existing._brandSource || "";
      const newBrand = p._brandSource || "";
      if (newBrand && !existingBrands.includes(newBrand)) {
        existing._brandSource = existingBrands ? `${existingBrands}, ${newBrand}` : newBrand;
      }
    } else {
      byUsername.set(username, p);
    }
  }
  return Array.from(byUsername.values());
}

const ENRICHMENT_ACTORS = [
  "dSCLg0C3YEZ83HzYX",                              // apify/instagram-profile-scraper
  "apify/instagram-profile-scraper",                  // slug fallback
  "scraper-mind/instagram-email-scraper",
  "scrapier/instagram-profile-email-scraper",
];

async function findEnrichmentActor(apify: ApifyClient, send: (e: string, d: any) => void): Promise<string> {
  for (const id of ENRICHMENT_ACTORS) {
    try {
      const actor = await apify.actor(id).get();
      if (actor) {
        send("log", { message: `Found enrichment: ${actor.name || id}` });
        return id;
      }
    } catch (err: any) {
      send("log", { message: `Enrichment ${id}: ${err.message?.slice(0, 80) || "not found"}` });
      continue;
    }
  }
  throw new Error("No Instagram profile enrichment actor found on Apify");
}

async function enrichProfiles(apify: ApifyClient, actorId: string, usernames: string[]): Promise<any[]> {
  const batchSize = 50;
  const allResults: any[] = [];
  const cf = cookieFields(getInstagramCookies());

  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    const inputVariants = [
      { usernames: batch, ...cf },
      { handles: batch, ...cf },
      { profiles: batch.map((u) => `https://instagram.com/${u}`), ...cf },
    ];

    for (const input of inputVariants) {
      try {
        const run = await apify.actor(actorId).call(input, { waitSecs: 600 });
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        allResults.push(...items);
        break;
      } catch (err: any) {
        const msg = err.message || "";
        if (msg.includes("INPUT_SCHEMA_VIOLATION") || msg.includes("is not valid") || msg.includes("is required")) {
          continue;
        }
        break;
      }
    }

    if (i + batchSize < usernames.length) await sleep(2000);
  }

  return allResults;
}

function normalizeProfile(item: any): LeadProfile {
  return {
    username: item.username || item.profileUsername || item.ig_username || "",
    fullName: item.fullName || item.name || item.profileName || "",
    biography: item.biography || item.bio || item.profileBio || "",
    igEmail: item.email || item.profileEmail || item.emailAddress || "",
    followersCount: item.followersCount || item.followers || item.profileFollowers || 0,
    postsCount: item.postsCount || item.posts || 0,
    externalUrl: item.externalUrl || item.website || item.profileWebsite || "",
    isBusinessAccount: item.isBusinessAccount || false,
    businessCategory: item.businessCategoryName || item.category || "",
    profileUrl: item.profileUrl || `https://instagram.com/${item.username || ""}`,
    recentPosts: item.latestPosts || item.recentPosts || item.posts_data || [],
    brandSource: item._brandSource || "unknown",
    engagementRate: null,
    avgViews: null,
    avgLikes: null,
    avgComments: null,
    dataAvailable: false,
    postsAnalyzed: 0,
    score: 0,
    reason: "",
    monetization: "",
    youtubeChannel: null,
    youtubeMethod: null,
    youtubeChannelId: null,
  };
}

function calculateEngagement(profile: LeadProfile) {
  const posts = profile.recentPosts;
  if (!posts || !Array.isArray(posts) || posts.length === 0) {
    return { engagementRate: null, avgViews: null, avgLikes: null, avgComments: null, postsAnalyzed: 0, dataAvailable: false };
  }

  const reels = posts.filter(
    (p: any) => p.type === "Video" || p.type === "Reel" || p.videoViewCount || p.videoPlayCount
  );
  const source = reels.length >= 3 ? reels : posts;

  const totalLikes = source.reduce((s: number, p: any) => s + (p.likesCount || p.likes || p.like_count || 0), 0);
  const totalComments = source.reduce((s: number, p: any) => s + (p.commentsCount || p.comments || p.comment_count || 0), 0);
  const totalViews = source.reduce((s: number, p: any) => s + (p.videoViewCount || p.videoPlayCount || p.video_view_count || 0), 0);

  const avgLikes = totalLikes / source.length;
  const avgComments = totalComments / source.length;
  const avgViews = totalViews / source.length;
  const engagementRate = profile.followersCount > 0 ? ((avgLikes + avgComments) / profile.followersCount) * 100 : 0;

  return {
    engagementRate: Math.round(engagementRate * 100) / 100,
    avgViews: Math.round(avgViews),
    avgLikes: Math.round(avgLikes),
    avgComments: Math.round(avgComments),
    postsAnalyzed: source.length,
    dataAvailable: true,
  };
}

async function scoreOneLead(anthropic: Anthropic, config: PipelineConfig, lead: LeadProfile) {
  const prompt = `${config.icpPrompt}

SCORE THIS LEAD:
- @${lead.username}
- Name: ${lead.fullName}
- Followers: ${lead.followersCount}
- Bio: "${lead.biography}"
- Business category: ${lead.businessCategory || "N/A"}
- Website: ${lead.externalUrl || "None"}
- Engagement rate: ${lead.engagementRate ?? "N/A"}%
- Avg reel views: ${lead.avgViews ?? "N/A"}
- Avg likes: ${lead.avgLikes ?? "N/A"}
- Found via: brand following list of @${lead.brandSource}

Respond with ONLY this JSON:
{"score": <0-100>, "reason": "<one sentence>", "monetization": "<what they currently do>"}`;

  try {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (response.content[0] as any).text.trim();
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    }
  } catch {
    // Silent fail
  }
  return { score: 50, reason: "AI scoring failed", monetization: "unknown" };
}

function extractYouTubeFromBio(profile: LeadProfile) {
  const textToSearch = `${profile.biography || ""} ${profile.externalUrl || ""}`;
  const ytPatterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/@?([\w-]+)/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/channel\/([\w-]+)/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/c\/([\w-]+)/i,
  ];

  for (const pattern of ytPatterns) {
    const match = textToSearch.match(pattern);
    if (match) {
      return {
        method: "bio",
        url: match[0].startsWith("http") ? match[0] : `https://${match[0]}`,
        handle: match[1],
      };
    }
  }
  return null;
}

async function searchYouTube(profile: LeadProfile, apiKey: string) {
  const queries = [profile.username, profile.fullName].filter(Boolean);

  for (const query of queries) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=3&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error?.code === 403) return "QUOTA_EXCEEDED";
      if (!data.items?.length) continue;

      const top = data.items[0];
      const title = top.snippet.channelTitle.toLowerCase();
      const search = query.toLowerCase();

      if (title.includes(search) || search.includes(title) || levenshteinSimilarity(title, search) > 0.6) {
        return {
          method: "youtube_search",
          channelId: top.snippet.channelId,
          url: `https://youtube.com/channel/${top.snippet.channelId}`,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── POST: Run Pipeline ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate env
  const apifyToken = process.env.APIFY_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const youtubeKey = process.env.YOUTUBE_API_KEY;

  if (!apifyToken) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured. Note: if ANTHROPIC_API_KEY is empty in your shell environment (set by Claude Desktop), add the lead-gen key to Vercel env vars." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const userConfig: PipelineConfig = { ...DEFAULT_CONFIG, ...body.config };
  const isTest = body.test === true;

  if (isTest) {
    userConfig.brandAccounts = [userConfig.brandAccounts[0]];
    userConfig.maxFollowingPerBrand = 20;
  }

  const apify = new ApifyClient({ token: apifyToken });
  const claude = new Anthropic({ apiKey: anthropicKey });

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        send("log", { message: isTest ? "TEST MODE: 1 brand, 20 following" : `Running ${userConfig.brandAccounts.length} brands` });

        const hasCookies = !!getInstagramCookies();
        if (!hasCookies) {
          send("log", { message: "⚠️ No INSTAGRAM_COOKIES env var found — scrapers may return limited or no results. Add your IG cookies to Vercel env vars." });
        } else {
          send("log", { message: "✅ Instagram cookies loaded" });
        }

        // Step 1: Scrape following
        send("step", { step: 1, label: "Scraping brand following lists" });
        const actorId = await findFollowingActor(apify, send);

        let allFollowing: any[] = [];
        let brandErrors = 0;

        for (const brand of userConfig.brandAccounts) {
          try {
            send("log", { message: `Scraping @${brand}...` });
            const following = await scrapeBrandFollowing(apify, actorId, brand, userConfig.maxFollowingPerBrand);
            allFollowing.push(...following);
            send("log", { message: `  @${brand}: ${following.length} accounts` });
          } catch (err: any) {
            send("log", { message: `  @${brand}: FAILED - ${err.message}` });
            brandErrors++;
          }
          await sleep(1000);
        }

        // Filter + dedupe
        const filtered = filterByFollowers(allFollowing, userConfig.minFollowers, userConfig.maxFollowers);
        const unique = deduplicateProfiles(filtered);
        send("log", { message: `${unique.length} unique profiles in follower range` });

        if (unique.length === 0) {
          send("log", { message: "No profiles found in range. The free Apify tier requires Instagram cookies for full results. See the setup guide." });
          send("complete", { leads: [], stats: { brands: userConfig.brandAccounts.length, brandErrors, raw: allFollowing.length, filtered: 0, enriched: 0, qualified: 0, youtube: 0 } });
          controller.close();
          return;
        }

        // Step 2: Enrich
        send("step", { step: 2, label: "Enriching profiles" });
        const enrichActorId = await findEnrichmentActor(apify, send);
        send("log", { message: `Using enrichment: ${enrichActorId}` });
        const enrichedRaw = await enrichProfiles(apify, enrichActorId, unique.map((u: any) => u.username || u.profileUsername || u.ig_username));

        // Merge enriched with originals
        const enrichedMap = new Map<string, any>();
        for (const item of enrichedRaw) {
          const uname = (item.username || item.profileUsername || "").toLowerCase();
          if (uname) enrichedMap.set(uname, item);
        }

        const profiles: LeadProfile[] = unique.map((orig: any) => {
          const uname = (orig.username || orig.profileUsername || "").toLowerCase();
          const enriched = enrichedMap.get(uname);
          if (enriched) return normalizeProfile({ ...enriched, _brandSource: orig._brandSource });
          return normalizeProfile(orig);
        });

        send("log", { message: `Enriched: ${enrichedRaw.length}. Emails found: ${profiles.filter((p) => p.igEmail).length}` });

        // Step 3: Engagement
        send("step", { step: 3, label: "Calculating engagement" });
        const withEngagement = profiles.map((p) => ({ ...p, ...calculateEngagement(p) }));
        const engFiltered = withEngagement.filter(
          (p) => !p.dataAvailable || (p.engagementRate! >= userConfig.minEngagementRate && p.avgViews! >= userConfig.minAvgReelViews)
        );
        send("log", { message: `${engFiltered.length} passed engagement filter (${withEngagement.length - engFiltered.length} removed)` });

        // Step 4: AI Scoring
        send("step", { step: 4, label: "AI scoring leads" });
        const scored: LeadProfile[] = [];
        for (let i = 0; i < engFiltered.length; i += userConfig.concurrency) {
          const batch = engFiltered.slice(i, i + userConfig.concurrency);
          const results = await Promise.all(
            batch.map(async (lead) => {
              const scoring = await scoreOneLead(claude, userConfig, lead);
              return { ...lead, ...scoring };
            })
          );
          scored.push(...results);
          send("log", { message: `Scored ${Math.min(i + userConfig.concurrency, engFiltered.length)}/${engFiltered.length}` });
          if (i + userConfig.concurrency < engFiltered.length) await sleep(500);
        }

        const qualified = scored.filter((p) => p.score >= userConfig.minScore);
        send("log", { message: `${qualified.length} qualified (score >= ${userConfig.minScore})` });

        // Step 5: YouTube discovery
        send("step", { step: 5, label: "Finding YouTube channels" });
        let ytSearchCount = 0;
        const ytSearchLimit = 95;
        let ytQuotaExceeded = false;

        for (const lead of qualified) {
          const bioResult = extractYouTubeFromBio(lead);
          if (bioResult) {
            lead.youtubeChannel = bioResult.url;
            lead.youtubeMethod = "bio";
            continue;
          }

          if (youtubeKey && ytSearchCount < ytSearchLimit && !ytQuotaExceeded) {
            const result = await searchYouTube(lead, youtubeKey);
            ytSearchCount++;
            if (result === "QUOTA_EXCEEDED") {
              ytQuotaExceeded = true;
            } else if (result && typeof result === "object") {
              lead.youtubeChannel = result.url;
              lead.youtubeMethod = "youtube_search";
              lead.youtubeChannelId = result.channelId;
              continue;
            }
          }

          lead.youtubeMethod = "not_found";
        }

        const ytFound = qualified.filter((p) => p.youtubeChannel);
        send("log", { message: `YouTube found: ${ytFound.length}/${qualified.length}` });

        // Sort all scored leads by score descending
        scored.sort((a, b) => b.score - a.score);

        // Done
        send("complete", {
          leads: scored.map((l) => ({
            score: l.score,
            username: l.username,
            fullName: l.fullName,
            igEmail: l.igEmail,
            youtubeChannel: l.youtubeChannel,
            youtubeMethod: l.youtubeMethod,
            followers: l.followersCount,
            engagementRate: l.engagementRate,
            avgViews: l.avgViews,
            avgLikes: l.avgLikes,
            monetization: l.monetization,
            reason: l.reason,
            brandSource: l.brandSource,
            biography: l.biography,
            website: l.externalUrl,
            profileUrl: l.profileUrl,
            businessCategory: l.businessCategory,
            dataAvailable: l.dataAvailable,
          })),
          stats: {
            brands: userConfig.brandAccounts.length,
            brandErrors,
            raw: allFollowing.length,
            filtered: unique.length,
            enriched: profiles.length,
            engagementPassed: engFiltered.length,
            qualified: qualified.length,
            youtube: ytFound.length,
            emails: scored.filter((p) => p.igEmail).length,
          },
        });
      } catch (err: any) {
        send("error", { message: err.message || "Pipeline failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
