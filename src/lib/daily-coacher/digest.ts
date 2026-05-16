// Daily Coacher digest engine.
//
// Picks 5 weighted-random clients per coach, generates drafts, builds
// the Slack Block Kit message, posts it. Used by both the scheduled
// cron and (one day) any manual "send now" admin trigger.
//
// Core selection algorithm: every active client with positive days
// remaining is in the candidate pool. Each gets a weight based on:
//   - Phase: onboarding > early > mid > late_mid > end_game
//   - Days since last touch (notes/meetings/tip_uses): older = heavier
//   - Already-engaged-today suppression: skip clients with a Copy event in
//     the last 24h
// Top weights are more likely to surface but every qualifying client has
// a non-zero chance, so the digest doesn't feel formulaic.
//
// Drafts are generated using the existing topic-generator with a topic
// chosen from the client's phase suggestions.

import { getServiceSupabase } from "@/lib/supabase";
import { generateTopicDraft } from "./topic-generator";
import type { TopicKey } from "./topics";
import { getTopic } from "./topics";
import { elevatedTopicsForPhase } from "./phase-suggestions";
import { type ProgramProgress } from "./summary-inputs";
import {
  postBlocks,
  openDmChannel,
  lookupUserIdByEmail,
  type PostResult,
} from "@/lib/slack/coaching-bot";

const PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://dashboard-drab-two-78.vercel.app";

const PHASE_WEIGHT: Record<ProgramProgress["phase"], number> = {
  onboarding: 5,
  early_program: 4,
  mid_program: 3,
  late_mid: 3,
  end_game: 4,
  post_program: 1,
  unknown: 1,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DigestRecipient {
  coach_name: string;
  slack_email: string | null;
  slack_user_id: string | null;
  enabled: boolean;
  snoozed_until: string | null;
}

export interface DigestCandidate {
  client_id: number;
  client_name: string;
  start_date: string | null;
  end_date: string | null;
  days_remaining: number;
  days_elapsed: number;
  program_days: number;
  phase: ProgramProgress["phase"];
  /** Highest of (last note, last meeting, last copy event) — or null if never. */
  last_touch_at: string | null;
  weight: number;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function derivePhase(start: Date, end: Date, today: Date): {
  phase: ProgramProgress["phase"];
  daysElapsed: number;
  daysRemaining: number;
  programDays: number;
  percentThrough: number;
} {
  const programDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  const daysElapsed = Math.max(0, Math.round((today.getTime() - start.getTime()) / DAY_MS));
  const daysRemaining = Math.max(0, Math.round((end.getTime() - today.getTime()) / DAY_MS));
  const percentThrough = Math.min(100, (daysElapsed / programDays) * 100);

  let phase: ProgramProgress["phase"];
  if (today > end) phase = "post_program";
  else if (daysElapsed <= 14) phase = "onboarding";
  else if (daysElapsed <= 30) phase = "early_program";
  else if (percentThrough < 70) phase = "mid_program";
  else if (percentThrough < 85) phase = "late_mid";
  else if (daysRemaining <= 14) phase = "end_game";
  else phase = "mid_program";

  return { phase, daysElapsed, daysRemaining, programDays, percentThrough };
}

/**
 * Builds the candidate pool for a coach. Returns an array of clients with
 * computed weights. Caller picks 5 via weighted-random.
 *
 * Filters:
 *   - status='active'
 *   - days_remaining > 0
 *   - no daily_coacher_tip_uses event in the last 24h (already engaged)
 */
export async function buildCandidatePool(coachName: string): Promise<DigestCandidate[]> {
  const db = getServiceSupabase();
  const today = new Date();

  // 1. Active clients of this coach
  const { data: rows, error } = await db
    .from("clients")
    .select("id, name, start_date, end_date, status, coach_name")
    .eq("coach_name", coachName)
    .eq("status", "active");
  if (error) {
    console.error("[digest] Failed to load clients for coach:", coachName, error.message);
    return [];
  }

  const activeClients = (rows ?? []) as Array<{
    id: number; name: string; start_date: string | null; end_date: string | null;
  }>;
  if (activeClients.length === 0) return [];

  // Filter to "positive days remaining"
  const eligible = activeClients
    .map((c) => {
      if (!c.start_date || !c.end_date) return null;
      const start = new Date(c.start_date);
      const end = new Date(c.end_date);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
      const phaseInfo = derivePhase(start, end, today);
      if (phaseInfo.daysRemaining <= 0) return null;
      return { ...c, ...phaseInfo };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  if (eligible.length === 0) return [];

  const clientIds = eligible.map((c) => c.id);
  const clientNames = eligible.map((c) => c.name);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 2. Suppress clients with a Copy event in the last 24h
  const { data: recentCopies } = await db
    .from("daily_coacher_tip_uses")
    .select("client_id")
    .in("client_id", clientIds)
    .gte("created_at", since24h);
  const recentlyCopied = new Set(((recentCopies ?? []) as { client_id: number }[]).map((r) => r.client_id));

  // 3. Last-touch timestamps (latest of: client_notes, coach_meetings, tip_uses)
  const [notes, meetings, tipUses] = await Promise.all([
    db.from("client_notes").select("client_name, created_at").in("client_name", clientNames),
    db.from("coach_meetings").select("client_id, created_at, notes").in("client_id", clientIds).not("notes", "is", null).neq("notes", ""),
    db.from("daily_coacher_tip_uses").select("client_id, created_at").in("client_id", clientIds),
  ]);

  const latestByClientId = new Map<number, string>();
  function bumpById(id: number, ts: string | null | undefined) {
    if (!ts) return;
    const cur = latestByClientId.get(id);
    if (!cur || ts > cur) latestByClientId.set(id, ts);
  }
  for (const m of (meetings.data ?? []) as Array<{ client_id: number; created_at: string }>) {
    bumpById(m.client_id, m.created_at);
  }
  for (const t of (tipUses.data ?? []) as Array<{ client_id: number; created_at: string }>) {
    bumpById(t.client_id, t.created_at);
  }
  // notes are keyed by client_name, so map back via eligible[]
  const notesByName = new Map<string, string>();
  for (const n of (notes.data ?? []) as Array<{ client_name: string; created_at: string }>) {
    const cur = notesByName.get(n.client_name);
    if (!cur || n.created_at > cur) notesByName.set(n.client_name, n.created_at);
  }

  // 4. Compute weights
  const candidates: DigestCandidate[] = [];
  for (const c of eligible) {
    if (recentlyCopied.has(c.id)) continue;
    const noteTs = notesByName.get(c.name) ?? null;
    const otherTs = latestByClientId.get(c.id) ?? null;
    const lastTouchAt = !noteTs ? otherTs : !otherTs ? noteTs : (noteTs > otherTs ? noteTs : otherTs);

    // Days since last touch — older = heavier weight (capped to avoid runaway).
    let stalenessWeight = 5; // never touched
    if (lastTouchAt) {
      const days = Math.max(0, Math.floor((Date.now() - new Date(lastTouchAt).getTime()) / DAY_MS));
      stalenessWeight = Math.min(10, Math.max(1, Math.round(days / 3)));
    }
    const phaseWeight = PHASE_WEIGHT[c.phase] ?? 1;
    const weight = phaseWeight * stalenessWeight;

    candidates.push({
      client_id: c.id,
      client_name: c.name,
      start_date: c.start_date,
      end_date: c.end_date,
      days_remaining: c.daysRemaining,
      days_elapsed: c.daysElapsed,
      program_days: c.programDays,
      phase: c.phase,
      last_touch_at: lastTouchAt,
      weight,
    });
  }
  return candidates;
}

/**
 * Weighted-random pick of `count` distinct candidates. Higher weight =
 * higher probability, but every candidate has some chance.
 */
export function weightedPick(pool: DigestCandidate[], count: number): DigestCandidate[] {
  const remaining = [...pool];
  const picked: DigestCandidate[] = [];
  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((s, c) => s + Math.max(1, c.weight), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < remaining.length; i++) {
      r -= Math.max(1, remaining[i].weight);
      if (r <= 0) { idx = i; break; }
    }
    picked.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return picked;
}

/**
 * Picks the topic for a candidate. Strategy: prefer the first phase-elevated
 * topic, fall back to "accountability" as a safe default if no elevation
 * applies (post_program / unknown).
 */
export function pickTopicForCandidate(c: DigestCandidate): TopicKey {
  const elevated = elevatedTopicsForPhase(c.phase);
  return elevated[0] ?? "accountability";
}

// ---------------------------------------------------------------------------
// Block Kit message construction
// ---------------------------------------------------------------------------

interface DraftItem {
  candidate: DigestCandidate;
  topic: TopicKey;
  draft: string;
  digestSendId?: number;
}

export function buildDigestBlocks(coachSlackUserId: string, coachName: string, items: DraftItem[]): unknown[] {
  const intro = items.length > 0
    ? `:sparkles: Morning <@${coachSlackUserId}>! Here are ${items.length} clients you might consider messaging today. Drafts are pre-baked, ready to copy.`
    : `:sparkles: Morning <@${coachSlackUserId}>! No suggestions today. Enjoy the lighter load.`;

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: intro } },
  ];

  if (items.length === 0) {
    return blocks;
  }

  for (const it of items) {
    const c = it.candidate;
    const topicLabel = getTopic(it.topic).label;
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeMd(c.client_name)}*  ·  Day ${c.days_elapsed} of ${c.program_days}  ·  Suggested: *${topicLabel}*`,
      },
    });
    // Draft in a code block — Slack renders a one-click copy button on hover.
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "```\n" + safeForCodeBlock(it.draft) + "\n```",
      },
    });

    const actionElements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Open in CCOS", emoji: true },
        style: "primary",
        url: `${PUBLIC_BASE_URL}/coaching/daily-coacher/${c.client_id}`,
        action_id: "open_in_ccos",
        value: JSON.stringify({ digest_send_id: it.digestSendId, client_id: c.client_id, topic: it.topic }),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Regenerate", emoji: true },
        action_id: "regenerate",
        value: JSON.stringify({ digest_send_id: it.digestSendId, client_id: c.client_id, topic: it.topic, coach_name: coachName }),
      },
    ];
    blocks.push({ type: "actions", elements: actionElements });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Snooze 1 day", emoji: true }, action_id: "snooze", value: "1" },
      { type: "button", text: { type: "plain_text", text: "Snooze 2 days", emoji: true }, action_id: "snooze", value: "2" },
      { type: "button", text: { type: "plain_text", text: "Snooze 3 days", emoji: true }, action_id: "snooze", value: "3" },
    ],
  });

  return blocks;
}

function escapeMd(s: string): string {
  // Slack's mrkdwn escapes for chars that have meaning
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeForCodeBlock(s: string): string {
  // Triple-backtick inside the draft would close the code block early.
  return s.replace(/```/g, "ʼʼʼ");
}

// ---------------------------------------------------------------------------
// Send pipeline (per-coach)
// ---------------------------------------------------------------------------

export interface SendDigestResult {
  ok: boolean;
  sent_to_user_id?: string;
  client_count?: number;
  message_ts?: string;
  reason?: string;
}

/**
 * Sends today's digest to one coach. Resolves Slack user ID (caches it),
 * builds candidate pool, picks 5 weighted-random, generates drafts in
 * parallel, posts the Slack message, logs each suggestion to
 * daily_coacher_digest_sends, and stamps last_sent_at.
 *
 * Skips silently when:
 *   - Coach is disabled
 *   - Coach is snoozed (returns ok=true with reason='snoozed')
 *   - Pool < 5 (returns ok=true with reason='below_threshold')
 *   - No Slack ID available (returns ok=false with reason='no_slack_id')
 */
export async function sendDigestForCoach(recipient: DigestRecipient): Promise<SendDigestResult> {
  const db = getServiceSupabase();

  if (!recipient.enabled) return { ok: true, reason: "disabled" };
  if (recipient.snoozed_until && new Date(recipient.snoozed_until) > new Date()) {
    return { ok: true, reason: "snoozed" };
  }

  // Resolve Slack user ID (cached on the row)
  let slackUserId = recipient.slack_user_id;
  if (!slackUserId) {
    if (!recipient.slack_email) return { ok: false, reason: "no_slack_email" };
    const found = await lookupUserIdByEmail(recipient.slack_email);
    if (!found) return { ok: false, reason: "lookup_failed" };
    slackUserId = found;
    await db
      .from("daily_coacher_recipients")
      .update({ slack_user_id: slackUserId })
      .eq("coach_name", recipient.coach_name);
  }

  // Build pool
  const pool = await buildCandidatePool(recipient.coach_name);
  if (pool.length < 5) {
    return { ok: true, reason: "below_threshold", client_count: pool.length };
  }

  const picks = weightedPick(pool, 5);

  // Generate drafts in parallel (each takes ~7-10s; parallel keeps total under 15s)
  const draftResults = await Promise.allSettled(
    picks.map(async (p) => {
      const topic = pickTopicForCandidate(p);
      const result = await generateTopicDraft(p.client_id, topic);
      return { candidate: p, topic, draft: result.draft } satisfies DraftItem;
    })
  );

  const items: DraftItem[] = draftResults
    .filter((r): r is PromiseFulfilledResult<DraftItem> => r.status === "fulfilled")
    .map((r) => r.value);

  if (items.length === 0) {
    return { ok: false, reason: "no_drafts_generated" };
  }

  // Open DM
  const dmChannel = await openDmChannel(slackUserId);
  if (!dmChannel) return { ok: false, reason: "dm_open_failed" };

  // Pre-insert digest_sends rows so we have IDs to embed in the buttons
  const insertPayload = items.map((it) => ({
    coach_name: recipient.coach_name,
    slack_user_id: slackUserId,
    client_id: it.candidate.client_id,
    topic: it.topic,
    draft_excerpt: it.draft.slice(0, 500),
  }));
  const { data: inserted, error: insertErr } = await db
    .from("daily_coacher_digest_sends")
    .insert(insertPayload)
    .select("id, client_id, topic");
  if (insertErr) {
    console.warn("[digest] failed to pre-insert digest_sends:", insertErr.message);
  }
  if (inserted) {
    const insertedById = new Map<string, number>();
    for (const r of inserted as Array<{ id: number; client_id: number; topic: string }>) {
      insertedById.set(`${r.client_id}:${r.topic}`, r.id);
    }
    for (const it of items) {
      it.digestSendId = insertedById.get(`${it.candidate.client_id}:${it.topic}`);
    }
  }

  // Build + post
  const blocks = buildDigestBlocks(slackUserId, recipient.coach_name, items);
  const result: PostResult = await postBlocks(
    dmChannel,
    blocks,
    `Daily Coacher: ${items.length} suggestions for today`
  );

  if (!result.ok) {
    return { ok: false, reason: result.error ?? "post_failed" };
  }

  // Stamp message_ts on the digest_sends rows for in-place "Regenerate" updates
  if (result.ts && inserted) {
    await db
      .from("daily_coacher_digest_sends")
      .update({ slack_message_ts: result.ts })
      .in("id", (inserted as Array<{ id: number }>).map((r) => r.id));
  }

  // Stamp last_sent_at on the recipient
  await db
    .from("daily_coacher_recipients")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("coach_name", recipient.coach_name);

  return { ok: true, sent_to_user_id: slackUserId, client_count: items.length, message_ts: result.ts };
}
