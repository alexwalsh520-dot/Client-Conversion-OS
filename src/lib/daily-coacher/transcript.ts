// Daily Coacher: onboarding-call transcript fetching with caching.
//
// The coach (Nicole) pastes a Fathom share URL on the client record.
// This module turns that URL into transcript text and caches the result
// on the client row so we don't re-hit Fathom on every summary regen.
//
// Flow:
//   1. getOnboardingTranscript(client) checks the cache.
//   2. If the link hasn't changed since the last fetch, return cached text.
//   3. Otherwise resolve URL → recording_id → transcript, then write to cache.
//
// Why this module talks to Fathom directly instead of using src/lib/fathom.ts:
//   - The shared lib reads FATHOM_API_KEY, which is scoped to the SALES team's
//     Fathom account. Onboarding calls live in Nicole's separate account,
//     accessible via FATHOM_API_KEY_ONBOARDING.
//   - The shared lib also targets `/meetings/{id}/transcript`, which returns 404.
//     The working endpoint is `/recordings/{recording_id}/transcript`. We use
//     a small private fetch helper here so we don't have to modify the shared
//     lib (which is consumed by the sales team's features).
//
// API shape notes (current Fathom v1, May 2026):
//   - Listing returns meetings with NO `id` field — only `recording_id` (numeric)
//     and a `url` of the form `https://fathom.video/calls/{call_id}`. The
//     call_id is for the web UI; only `recording_id` works with the transcript
//     endpoint.
//   - Transcript segments have shape:
//       { speaker: { display_name, matched_calendar_invitee_email },
//         text, timestamp: "HH:MM:SS" }

import { getServiceSupabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const FATHOM_BASE_URL = "https://api.fathom.ai/external/v1";

// Window for the listing search, centered on onboarding_date. Onboarding calls
// happen close to the recorded onboarding date; ±30 days absorbs scheduling
// slips while keeping the API call bounded.
const LISTING_WINDOW_DAYS = 30;

interface OnboardingMeeting {
  url?: string;
  share_url?: string;
  recording_id?: number;
  created_at?: string;
}

interface ListResponse {
  items?: OnboardingMeeting[];
  next_cursor?: string;
}

interface TranscriptSegment {
  speaker: {
    display_name?: string;
    matched_calendar_invitee_email?: string;
  };
  text: string;
  timestamp: string; // "HH:MM:SS"
}

interface TranscriptResponse {
  transcript?: TranscriptSegment[] | null;
}

// ---------------------------------------------------------------------------
// Private fetch helper (uses the onboarding-scoped key)
// ---------------------------------------------------------------------------

function getOnboardingApiKey(): string | null {
  const key =
    process.env.FATHOM_API_KEY_ONBOARDING || process.env.FATHOM_API_KEY;
  if (!key) {
    console.warn(
      "[daily-coacher/transcript] No Fathom API key found. " +
        "Set FATHOM_API_KEY_ONBOARDING (preferred) or FATHOM_API_KEY."
    );
    return null;
  }
  return key;
}

async function fathomFetch<T>(path: string): Promise<T> {
  const apiKey = getOnboardingApiKey();
  if (!apiKey) throw new Error("Missing FATHOM_API_KEY_ONBOARDING");

  const response = await fetch(`${FATHOM_BASE_URL}${path}`, {
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Fathom API error (HTTP ${response.status}) on ${path}: ${body.substring(0, 200)}`
    );
  }
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Extracts the share token from a Fathom share URL.
 * Returns null for unrecognized formats. Caller treats null as "no transcript
 * context available" — never fatal.
 */
export function extractFathomShareToken(url: string): string | null {
  if (!url) return null;
  const match = url.match(/fathom\.video\/share\/([\w-]+)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Resolution: share URL → recording_id → transcript text
// ---------------------------------------------------------------------------

function formatSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => {
      const speaker = seg.speaker?.display_name || "Unknown";
      return `[${seg.timestamp}] ${speaker}: ${seg.text}`;
    })
    .join("\n");
}

async function fetchTranscriptByRecordingId(
  recordingId: number
): Promise<string | null> {
  try {
    const data = await fathomFetch<TranscriptResponse>(
      `/recordings/${recordingId}/transcript`
    );
    if (!data.transcript || data.transcript.length === 0) return null;
    return formatSegments(data.transcript);
  } catch (err) {
    console.warn(
      `[daily-coacher/transcript] Failed to fetch transcript for recording ${recordingId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Walks paginated /meetings listing in a date window and finds the meeting
 * whose share_url matches `targetShareUrl`. Returns the meeting (with
 * recording_id) or null.
 */
async function findMeetingByShareUrl(
  targetShareUrl: string,
  dateHint?: string | null
): Promise<OnboardingMeeting | null> {
  const params = new URLSearchParams();
  if (dateHint) {
    const date = new Date(dateHint);
    if (!isNaN(date.getTime())) {
      const windowMs = LISTING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      params.set(
        "created_after",
        new Date(date.getTime() - windowMs).toISOString()
      );
      params.set(
        "created_before",
        new Date(date.getTime() + windowMs).toISOString()
      );
    }
  }

  const basePath = `/meetings${params.toString() ? `?${params.toString()}` : ""}`;
  let cursor: string | undefined;

  while (true) {
    const path = cursor
      ? `${basePath}${basePath.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
      : basePath;

    let data: ListResponse;
    try {
      data = await fathomFetch<ListResponse>(path);
    } catch (err) {
      console.warn(
        "[daily-coacher/transcript] Listing failed:",
        err instanceof Error ? err.message : err
      );
      return null;
    }

    const items = data.items || [];
    const match = items.find((m) => m.share_url === targetShareUrl);
    if (match) return match;

    if (!data.next_cursor || items.length === 0) return null;
    cursor = data.next_cursor;
  }
}

async function resolveAndFetchTranscript(
  shareUrl: string,
  dateHint?: string | null
): Promise<string | null> {
  // Validate URL is a Fathom share URL we recognize.
  if (!extractFathomShareToken(shareUrl)) {
    console.warn(
      "[daily-coacher/transcript] Could not parse Fathom URL:",
      shareUrl
    );
    return null;
  }

  const meeting = await findMeetingByShareUrl(shareUrl, dateHint);
  if (!meeting) {
    console.warn(
      `[daily-coacher/transcript] No meeting matching share URL ${shareUrl}` +
        (dateHint ? ` (searched ±${LISTING_WINDOW_DAYS} days around ${dateHint})` : "")
    );
    return null;
  }

  if (!meeting.recording_id) {
    console.warn(
      `[daily-coacher/transcript] Found meeting but no recording_id on payload`,
      { share_url: meeting.share_url }
    );
    return null;
  }

  return fetchTranscriptByRecordingId(meeting.recording_id);
}

// ---------------------------------------------------------------------------
// Top-level helper: cache-aware transcript getter
// ---------------------------------------------------------------------------

export interface TranscriptInputs {
  id: number;
  onboardingFathomLink?: string | null;
  onboardingDate?: string | null;
}

/**
 * Returns the onboarding-call transcript for a client, using the cached
 * value when the share URL hasn't changed since the last fetch.
 *
 * Cache key is the URL string itself, stored in
 * `clients.onboarding_fathom_link_fetched_for`. When the coach pastes a new
 * URL on the client record, the cached value is ignored and we refetch.
 *
 * Returns null when:
 *   - No onboarding Fathom link is set on the client.
 *   - The URL can't be resolved to a transcript (bad URL, recording not yet
 *     processed by Fathom, API unavailable, key doesn't have access).
 *
 * On failed resolution we deliberately do NOT update the cache columns, so
 * the next call retries (Fathom processing can take time after a call ends —
 * we want to pick up the transcript whenever it becomes available).
 */
export async function getOnboardingTranscript(
  client: TranscriptInputs
): Promise<string | null> {
  const link = client.onboardingFathomLink?.trim();
  if (!link) return null;

  const supabase = getServiceSupabase();

  // Check cache.
  const { data, error } = await supabase
    .from("clients")
    .select(
      "onboarding_transcript_cached, onboarding_fathom_link_fetched_for"
    )
    .eq("id", client.id)
    .single();

  if (error) {
    console.error(
      "[daily-coacher/transcript] Failed to read client cache:",
      error.message
    );
    return null;
  }

  if (
    data?.onboarding_transcript_cached &&
    data.onboarding_fathom_link_fetched_for === link
  ) {
    return data.onboarding_transcript_cached as string;
  }

  // Cache miss or stale — resolve from Fathom.
  const transcript = await resolveAndFetchTranscript(link, client.onboardingDate);
  if (!transcript) return null;

  // Persist to cache.
  const { error: writeError } = await supabase
    .from("clients")
    .update({
      onboarding_transcript_cached: transcript,
      onboarding_transcript_fetched_at: new Date().toISOString(),
      onboarding_fathom_link_fetched_for: link,
    })
    .eq("id", client.id);

  if (writeError) {
    // Non-fatal: we got the transcript, persisting failed. Caller still gets the text.
    console.error(
      "[daily-coacher/transcript] Failed to persist transcript cache:",
      writeError.message
    );
  }

  return transcript;
}
