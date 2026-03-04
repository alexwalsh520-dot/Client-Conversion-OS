// POST /api/lead-gen — Run the fitness influencer lead gen pipeline
// Streams SSE progress events to the client
// GET /api/lead-gen — Return recent runs + stored leads

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import Anthropic from "@anthropic-ai/sdk";

// ─── Apify REST API (replaces apify-client SDK to avoid bundler issues) ────────

const APIFY_BASE = "https://api.apify.com/v2";

async function apifyGet(path: string, token: string) {
  const res = await fetch(`${APIFY_BASE}${path}?token=${token}`);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

async function apifyRunActor(actorId: string, input: any, token: string, waitSecs = 300) {
  const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=${waitSecs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.data;
}

async function apifyGetDataset(datasetId: string, token: string) {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`);
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json(); // returns array directly
}

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

// Actor priority: no-cookie actors FIRST (more reliable), cookie actors as fallback
const FOLLOWING_ACTORS = [
  "scraping_solutions~instagram-scraper-followers-following-no-cookies",  // NO cookies, 500 free/run
  "sejinius~instagram-following-scraper-pay-as-you-go",                  // NO session ID needed
  "XLJHmaoDGuFYahmgm",  // figue — needs cookies + type:"following"
  "w0pct4EQqHEnWRnj8",  // louisdeconinck — needs cookies, 100 free limit
];

function getInstagramCookieString(): string {
  const raw = (process.env.INSTAGRAM_COOKIES || "").trim();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as { name: string; value: string }[];
      return arr.map((c) => `${c.name}=${c.value}`).join("; ");
    } catch {
      return raw;
    }
  }
  return raw;
}

function getInstagramCookieArray(): any[] {
  const raw = (process.env.INSTAGRAM_COOKIES || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function extractSessionId(cookieStr: string): string {
  const match = cookieStr.match(/sessionid=([^;]+)/);
  return match ? match[1].trim() : "";
}

interface ActorSchema {
  fields: string[];
  propertyTypes: Record<string, string>;
  enumValues: Record<string, string[]>;
  descriptions: Record<string, string>;
  cookieField: string | null;
  usernameField: string | null;
  limitField: string | null;
  typeField: string | null;
  needsCookies: boolean;
}

// Fetch actor's input schema from its latest build — includes field types
async function fetchActorSchema(
  actorId: string,
  token: string,
  send?: (e: string, d: any) => void
): Promise<ActorSchema> {
  const result: ActorSchema = {
    fields: [],
    propertyTypes: {},
    enumValues: {},
    descriptions: {},
    cookieField: null,
    usernameField: null,
    limitField: null,
    typeField: null,
    needsCookies: false,
  };
  try {
    const actor = await apifyGet(`/acts/${actorId}`, token);
    const buildId = actor?.taggedBuilds?.latest?.buildId;
    if (buildId) {
      const build = await apifyGet(`/acts/${actorId}/builds/${buildId}`, token);
      if (build?.inputSchema) {
        const schema = typeof build.inputSchema === "string" ? JSON.parse(build.inputSchema) : build.inputSchema;
        const props = schema.properties || {};
        const required = new Set(schema.required || []);
        result.fields = Object.keys(props);

        // Capture property types, enums, and descriptions
        for (const [key, val] of Object.entries(props)) {
          const prop = val as any;
          result.propertyTypes[key] = prop.type || "unknown";
          if (prop.enum) result.enumValues[key] = prop.enum;
          if (prop.description) result.descriptions[key] = prop.description.slice(0, 200);
        }

        if (send) send("log", { message: `  Schema: [${result.fields.map(f => `${f}(${result.propertyTypes[f]})`).join(", ")}]` });

        // Find cookie field
        result.cookieField = result.fields.find((f) =>
          /cookie|session|login/i.test(f) && !/proxy/i.test(f)
        ) || null;
        // Is cookie required?
        result.needsCookies = result.cookieField ? required.has(result.cookieField) : false;

        // Find username field (priority: usernames > username > account > handle)
        result.usernameField = result.fields.find((f) =>
          /^usernames?$/i.test(f)
        ) || result.fields.find((f) =>
          /^accounts?$/i.test(f)
        ) || result.fields.find((f) =>
          /^userName$/i.test(f)
        ) || result.fields.find((f) =>
          /username|handle|user(?!agent)/i.test(f)
        ) || null;

        // Find limit field (exclude the username field to prevent "Account" matching "count")
        result.limitField = result.fields.find((f) =>
          f !== result.usernameField && /limit|maxresult|resultsperpage/i.test(f)
        ) || result.fields.find((f) =>
          f !== result.usernameField && /^count|countper|^max(?!pages)/i.test(f)
        ) || result.fields.find((f) =>
          f !== result.usernameField && /maxpages/i.test(f)
        ) || null;

        // Find type field (followers vs following)
        result.typeField = result.fields.find((f) =>
          /^type$|scrapeType|listType|mode|dataToScrape/i.test(f)
        ) || null;

        if (send) {
          send("log", { message: `  → user: "${result.usernameField}", cookie: "${result.cookieField}"(${result.needsCookies ? "required" : "optional"}), limit: "${result.limitField}", type: "${result.typeField}"` });
        }
      }
    }
  } catch (err: any) {
    if (send) send("log", { message: `  Schema fetch error: ${err.message?.slice(0, 80)}` });
  }
  return result;
}

// Build schema-driven inputs, smart about cookie formats based on schema types
async function scrapeBrandFollowing(
  token: string,
  actorId: string,
  brand: string,
  maxResults: number,
  send?: (e: string, d: any) => void
): Promise<any[]> {
  const cookieStr = getInstagramCookieString();
  const cookieArray = getInstagramCookieArray();
  const sessionId = extractSessionId(cookieStr);

  // Fetch the actor's actual input schema
  const schema = await fetchActorSchema(actorId, token, send);

  // If actor requires cookies and we don't have them, skip immediately
  if (schema.needsCookies && !cookieStr) {
    if (send) send("log", { message: `  ⏭ Skipping — requires cookies but none configured` });
    return [];
  }

  // ── Build the base input from schema fields ──
  const base: Record<string, any> = {};

  // Username field — use schema type to decide array vs string
  // Also check description for URL hints
  const userDesc = schema.usernameField ? (schema.descriptions[schema.usernameField] || "") : "";
  const wantsUrl = /url|link|http|profile.*url/i.test(userDesc);

  if (schema.usernameField) {
    const fieldType = schema.propertyTypes[schema.usernameField];
    const brandValue = wantsUrl ? `https://www.instagram.com/${brand}/` : brand;
    if (fieldType === "array") {
      base[schema.usernameField] = [brandValue];
    } else if (fieldType === "string") {
      base[schema.usernameField] = brandValue;
    } else {
      base[schema.usernameField] = schema.usernameField.endsWith("s") ? [brandValue] : brandValue;
    }
  } else {
    base.usernames = [brand];
  }

  // Limit field — floor of 100 to satisfy actor minimums
  if (schema.limitField) {
    const limitName = schema.limitField.toLowerCase();
    if (limitName.includes("page")) {
      base[schema.limitField] = Math.max(2, Math.ceil(maxResults / 50));
    } else {
      base[schema.limitField] = Math.max(100, maxResults);
    }
  }

  // Type field — use enum values if available (actors may want "Followings" not "following")
  if (schema.typeField) {
    const enums = schema.enumValues[schema.typeField];
    if (enums && enums.length > 0) {
      const match = enums.find((v: string) => /following/i.test(v));
      base[schema.typeField] = match || enums[0];
      if (send) send("log", { message: `  Type enum: [${enums.join(", ")}] → "${base[schema.typeField]}"` });
    } else {
      base[schema.typeField] = "following";
    }
  }

  // ── Build cookie format attempts based on schema ──
  const attempts: { label: string; input: Record<string, any> }[] = [];

  if (!schema.cookieField) {
    // No cookie field — actor doesn't need cookies. Run with base input.
    attempts.push({ label: "no-cookies", input: { ...base } });
    // Also try URL format for array username fields (some actors want IG profile URLs)
    if (schema.usernameField && schema.propertyTypes[schema.usernameField] === "array" && !wantsUrl) {
      const urlBase = { ...base, [schema.usernameField]: [`https://www.instagram.com/${brand}/`] };
      attempts.push({ label: "no-cookies+url", input: urlBase });
    }
  } else {
    const cookieFieldName = schema.cookieField;
    const cookieType = schema.propertyTypes[cookieFieldName];

    if (cookieStr) {
      if (send) send("log", { message: `  Cookies: ${cookieStr.length} chars, sid=${sessionId ? "yes" : "no"}, schema type=${cookieType}` });

      if (cookieType === "string") {
        // String type — try JSON string of array first, then header string, then sessionid
        if (cookieArray.length > 0) {
          attempts.push({ label: "JSON-string", input: { ...base, [cookieFieldName]: JSON.stringify(cookieArray) } });
        }
        attempts.push({ label: "header-string", input: { ...base, [cookieFieldName]: cookieStr } });
        if (sessionId) {
          attempts.push({ label: "sessionid-only", input: { ...base, [cookieFieldName]: `sessionid=${sessionId}` } });
        }
      } else if (cookieType === "array") {
        // Array type — only try actual arrays
        if (cookieArray.length > 0) {
          attempts.push({ label: "JSON-array", input: { ...base, [cookieFieldName]: cookieArray } });
        }
      } else {
        // Unknown type — try all formats
        if (cookieArray.length > 0) {
          attempts.push({ label: "JSON-string", input: { ...base, [cookieFieldName]: JSON.stringify(cookieArray) } });
          attempts.push({ label: "header-string", input: { ...base, [cookieFieldName]: cookieStr } });
          attempts.push({ label: "JSON-array", input: { ...base, [cookieFieldName]: cookieArray } });
        } else if (cookieStr) {
          attempts.push({ label: "header-string", input: { ...base, [cookieFieldName]: cookieStr } });
        }
      }
    }

    // Also try without cookies if they're optional
    if (!schema.needsCookies) {
      attempts.push({ label: "no-cookies", input: { ...base } });
    }
  }

  if (attempts.length === 0) {
    if (send) send("log", { message: `  ⏭ No valid input combinations` });
    return [];
  }

  // ── Try each attempt ──
  for (const attempt of attempts) {
    try {
      if (send) send("log", { message: `  Try: ${attempt.label}, keys=[${Object.keys(attempt.input).join(",")}]` });
      const run = await apifyRunActor(actorId, attempt.input, token);

      // Check run status
      const status = run.status;
      if (send && status) send("log", { message: `  Run status: ${status}` });
      if (status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") {
        if (send) send("log", { message: `  → Run ${status}, trying next...` });
        continue;
      }

      const items = await apifyGetDataset(run.defaultDatasetId, token);
      const results = (Array.isArray(items) ? items : []).map((item: any) => ({ ...item, _brandSource: brand }));
      if (send) send("log", { message: `  → ${results.length} items` });
      if (results.length > 0) return results;
    } catch (err: any) {
      const msg = err.message || "";
      if (send) send("log", { message: `  → Error: ${msg.slice(0, 120)}` });
      continue;
    }
  }

  return [];
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
    const username = (p.username || p.profileUsername || p.ig_username || p.userName || "").toLowerCase();
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
  "dSCLg0C3YEZ83HzYX",  // apify/instagram-profile-scraper
];

async function findEnrichmentActor(token: string, send: (e: string, d: any) => void): Promise<string> {
  for (const id of ENRICHMENT_ACTORS) {
    try {
      const actor = await apifyGet(`/acts/${id}`, token);
      if (actor) {
        send("log", { message: `Found enrichment: ${actor.name || id}` });
        return id;
      }
    } catch (err: any) {
      send("log", { message: `Enrichment ${id}: ${err.message?.slice(0, 100) || "not found"}` });
      continue;
    }
  }
  throw new Error("No Instagram profile enrichment actor found on Apify");
}

async function enrichProfiles(token: string, actorId: string, usernames: string[]): Promise<any[]> {
  const batchSize = 50;
  const allResults: any[] = [];
  const cookieStr = getInstagramCookieString();
  const sessionId = extractSessionId(cookieStr);
  const cf: Record<string, any> = cookieStr ? {
    cookie: cookieStr,
    cookies: cookieStr,
    sessionCookie: sessionId || cookieStr,
    sessionId: sessionId,
  } : {};

  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    const inputVariants = [
      { usernames: batch, ...cf },
      { handles: batch, ...cf },
      { profiles: batch.map((u) => `https://instagram.com/${u}`), ...cf },
    ];

    for (const input of inputVariants) {
      try {
        const run = await apifyRunActor(actorId, input, token, 600);
        const items = await apifyGetDataset(run.defaultDatasetId, token);
        allResults.push(...(Array.isArray(items) ? items : []));
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

  const body = await req.json().catch(() => ({}));
  const mode: "full" | "quick" = body.mode === "quick" ? "quick" : "full";

  if (mode === "full" && !anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured. Note: if ANTHROPIC_API_KEY is empty in your shell environment (set by Claude Desktop), add the lead-gen key to Vercel env vars." }, { status: 500 });
  }

  const userConfig: PipelineConfig = { ...DEFAULT_CONFIG, ...body.config };
  const isTest = body.test === true;

  if (isTest) {
    userConfig.brandAccounts = [userConfig.brandAccounts[0]];
    userConfig.maxFollowingPerBrand = Math.min(userConfig.maxFollowingPerBrand, 100);
  }

  const claude = mode === "full" ? new Anthropic({ apiKey: anthropicKey! }) : null;

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      const fnStart = Date.now(); // Track function start for global time budget

      try {
        send("log", { message: `${mode === "quick" ? "⚡ QUICK SCAN" : "🔬 FULL PIPELINE"}${isTest ? " (TEST)" : ""}: ${userConfig.brandAccounts.length} brand${userConfig.brandAccounts.length > 1 ? "s" : ""}, up to ${userConfig.maxFollowingPerBrand} following` });

        const hasCookies = !!getInstagramCookieString();
        if (!hasCookies) {
          send("log", { message: "⚠️ No INSTAGRAM_COOKIES env var found — scrapers may return limited or no results. Add your IG cookies to Vercel env vars." });
        } else {
          send("log", { message: "✅ Instagram cookies loaded" });
        }

        // Step 1: Scrape following
        send("step", { step: 1, label: "Scraping brand following lists" });

        // Find all available actors
        const availableActors: string[] = [];
        for (const id of FOLLOWING_ACTORS) {
          try {
            const actor = await apifyGet(`/acts/${id}`, apifyToken);
            if (actor) {
              send("log", { message: `Found actor: ${actor.name || id} (${id})` });
              availableActors.push(id);
            }
          } catch (err: any) {
            send("log", { message: `Actor ${id}: ${err.message?.slice(0, 80) || "not found"}` });
          }
        }
        if (availableActors.length === 0) {
          throw new Error("No Instagram following scraper found on Apify. Make sure your APIFY_API_TOKEN is valid.");
        }

        let allFollowing: any[] = [];
        let brandErrors = 0;

        for (const brand of userConfig.brandAccounts) {
          try {
            send("log", { message: `Scraping @${brand}...` });

            // Try each actor until one returns results
            let following: any[] = [];
            for (const actorId of availableActors) {
              following = await scrapeBrandFollowing(apifyToken, actorId, brand, userConfig.maxFollowingPerBrand, send);
              if (following.length > 0) {
                send("log", { message: `  @${brand}: ${following.length} accounts (via ${actorId.slice(0, 6)}...)` });
                break;
              }
              send("log", { message: `  Actor ${actorId.slice(0, 6)}... returned 0, trying next...` });
            }

            if (following.length === 0) {
              send("log", { message: `  @${brand}: 0 accounts from all actors` });
            }
            allFollowing.push(...following);
          } catch (err: any) {
            send("log", { message: `  @${brand}: FAILED - ${err.message}` });
            brandErrors++;
          }
          await sleep(1000);
        }

        // Deduplicate (DON'T filter by followers yet — following scraper returns basic data without follower counts)
        const unique = deduplicateProfiles(allFollowing);
        send("log", { message: `${unique.length} unique profiles scraped (${allFollowing.length} raw)` });

        if (unique.length === 0) {
          send("log", { message: "No profiles found. Check that your Apify API token is valid and the actors are accessible." });
          send("complete", { leads: [], stats: { brands: userConfig.brandAccounts.length, brandErrors, raw: allFollowing.length, filtered: 0, enriched: 0, qualified: 0, youtube: 0 } });
          controller.close();
          return;
        }

        // ── QUICK SCAN: time-budgeted enrichment + email extraction ──
        // Runs BEFORE the full pipeline enrichment to avoid the 600s waitForFinish
        // that exceeds Vercel's 60-second function timeout
        if (mode === "quick") {
          send("step", { step: 2, label: "Quick enrichment" });

          const qUsernames = unique.map((u: any) =>
            (u.username || u.profileUsername || u.ig_username || u.userName || "").toLowerCase()
          ).filter(Boolean);

          let qEnrichedResults: any[] = [];
          const qActorId = ENRICHMENT_ACTORS[0]; // Use known actor ID directly — skip discovery to save time
          const qCookieStr = getInstagramCookieString();
          const qSessionId = extractSessionId(qCookieStr);
          const qCf: Record<string, any> = qCookieStr ? { cookie: qCookieStr, sessionId: qSessionId } : {};

          // Small batches with GLOBAL deadline — accounts for scraping time too
          const Q_BATCH = 10;
          const Q_DEADLINE_MS = 50000; // Hard deadline: 50s from function start (leaves 10s for response)
          const Q_MAX_WAIT = 10; // Max seconds per Apify API call

          const timeUsed = Date.now() - fnStart;
          const timeLeft = Q_DEADLINE_MS - timeUsed;
          send("log", { message: `Enriching ${qUsernames.length} profiles (${Math.round(timeLeft / 1000)}s remaining, batches of ${Q_BATCH})...` });

          if (timeLeft < 8000) {
            send("log", { message: `⏱ Only ${Math.round(timeLeft / 1000)}s left — skipping enrichment, using raw data` });
          } else {
            for (let qi = 0; qi < qUsernames.length; qi += Q_BATCH) {
              const elapsed = Date.now() - fnStart;
              const remaining = Q_DEADLINE_MS - elapsed;
              if (remaining < 8000) {
                send("log", { message: `⏱ ${Math.round(remaining / 1000)}s left — stopping enrichment (got ${qEnrichedResults.length})` });
                break;
              }

              const qBatch = qUsernames.slice(qi, qi + Q_BATCH);
              const qBatchNum = Math.floor(qi / Q_BATCH) + 1;
              const qWait = Math.min(Q_MAX_WAIT, Math.floor((remaining - 5000) / 1000));

              send("log", { message: `  Batch ${qBatchNum}: ${qBatch.length} profiles (${qWait}s limit, ${Math.round(remaining / 1000)}s left)...` });

              try {
                const qRun = await apifyRunActor(qActorId, { usernames: qBatch, ...qCf }, apifyToken, qWait);
                if (qRun.defaultDatasetId) {
                  try {
                    const qItems = await apifyGetDataset(qRun.defaultDatasetId, apifyToken);
                    const qArr = Array.isArray(qItems) ? qItems : [];
                    qEnrichedResults.push(...qArr);
                    send("log", { message: `  → ${qArr.length} enriched (${qRun.status})` });
                  } catch {
                    send("log", { message: `  → Dataset fetch failed` });
                  }
                }
              } catch (err: any) {
                send("log", { message: `  → Error: ${(err.message || "").slice(0, 80)}` });
                break;
              }
            }
          }

          // Merge enriched data with originals
          const qMap = new Map<string, any>();
          for (const qItem of qEnrichedResults) {
            const qu = (qItem.username || qItem.profileUsername || qItem.userName || "").toLowerCase();
            if (qu) qMap.set(qu, qItem);
          }

          const qProfiles: LeadProfile[] = unique.map((orig: any) => {
            const qu = (orig.username || orig.profileUsername || orig.userName || "").toLowerCase();
            const qEnriched = qMap.get(qu);
            if (qEnriched) return normalizeProfile({ ...qEnriched, _brandSource: orig._brandSource });
            return normalizeProfile(orig);
          });

          send("log", { message: `Enriched: ${qEnrichedResults.length}/${qUsernames.length}` });

          // Step 3: Extract emails from bios
          send("step", { step: 3, label: "Extracting emails" });
          const qEmailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

          for (const p of qProfiles) {
            if (!p.igEmail && p.biography) {
              const m = p.biography.match(qEmailRe);
              if (m) p.igEmail = m[0];
            }
            if (!p.igEmail && p.externalUrl) {
              const mm = p.externalUrl.match(/mailto:([^\s?]+)/i);
              if (mm) p.igEmail = mm[1];
            }
          }

          const qWithEmail = qProfiles.filter((p) => !!p.igEmail);
          qWithEmail.sort((a, b) => b.followersCount - a.followersCount);

          send("log", { message: `⚡ Quick Scan done: ${qWithEmail.length} with email, ${qEnrichedResults.length} enriched, ${qProfiles.length} total` });

          send("complete", {
            leads: qWithEmail.map((l) => ({
              score: 0,
              username: l.username,
              fullName: l.fullName,
              igEmail: l.igEmail,
              youtubeChannel: null,
              youtubeMethod: null,
              followers: l.followersCount,
              engagementRate: null,
              avgViews: null,
              avgLikes: null,
              monetization: "",
              reason: "Quick scan — email in bio",
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
              enriched: qEnrichedResults.length,
              withEmail: qWithEmail.length,
              engagementPassed: 0,
              qualified: qWithEmail.length,
              youtube: 0,
              emails: qWithEmail.length,
            },
          });
          controller.close();
          return;
        }

        // ── FULL PIPELINE: Step 2 — Enrich profiles ──
        send("step", { step: 2, label: "Enriching profiles" });
        const enrichActorId = await findEnrichmentActor(apifyToken, send);
        send("log", { message: `Using enrichment: ${enrichActorId}` });
        const usernamesToEnrich = unique.map((u: any) => u.username || u.profileUsername || u.ig_username || u.userName || "").filter(Boolean);
        send("log", { message: `Enriching ${usernamesToEnrich.length} usernames...` });
        const enrichedRaw = await enrichProfiles(apifyToken, enrichActorId, usernamesToEnrich);

        // Merge enriched with originals
        const enrichedMap = new Map<string, any>();
        for (const item of enrichedRaw) {
          const uname = (item.username || item.profileUsername || "").toLowerCase();
          if (uname) enrichedMap.set(uname, item);
        }

        const allProfiles: LeadProfile[] = unique.map((orig: any) => {
          const uname = (orig.username || orig.profileUsername || orig.userName || "").toLowerCase();
          const enriched = enrichedMap.get(uname);
          if (enriched) return normalizeProfile({ ...enriched, _brandSource: orig._brandSource });
          return normalizeProfile(orig);
        });

        send("log", { message: `Enriched: ${enrichedRaw.length}/${usernamesToEnrich.length}. Emails: ${allProfiles.filter((p) => p.igEmail).length}` });

        // NOW filter by followers (after enrichment has added follower counts)
        const profiles = allProfiles.filter((p) => {
          if (p.followersCount === 0) return true; // Keep un-enriched profiles (no data to filter on)
          return p.followersCount >= userConfig.minFollowers && p.followersCount <= userConfig.maxFollowers;
        });
        send("log", { message: `${profiles.length} in follower range (${allProfiles.length - profiles.length} filtered out)` });

        if (profiles.length === 0) {
          send("log", { message: "No profiles in follower range after enrichment." });
          send("complete", { leads: [], stats: { brands: userConfig.brandAccounts.length, brandErrors, raw: allFollowing.length, filtered: 0, enriched: enrichedRaw.length, qualified: 0, youtube: 0 } });
          controller.close();
          return;
        }

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
              const scoring = await scoreOneLead(claude!, userConfig, lead);
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
