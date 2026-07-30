// Team-call notifications: Fathom webhook -> Slack private channel.
//
// Goal: when a NON-sales call finishes, post four lines to Slack — that the
// call finished, who it was between, what was covered, and what feedback was
// given. Sales calls are suppressed entirely.
//
// Why classification lives here and not in the Fathom webhook config:
//   Fathom's POST /webhooks takes `triggered_for` plus the include_* toggles
//   and NOTHING else. `recorded_by`, `teams`, and `meeting_type` are filters on
//   the LIST endpoint, not on webhooks — sending them to /webhooks is silently
//   ignored. So 100% of the filtering has to happen on our side.
//
// Why we classify on the invitee roster rather than the title or domain:
//   - `meeting_type` is null on every meeting in the account; nobody tags calls.
//   - Titles are things like "Alex", "MAW", "Impromptu Google Meet Meeting" —
//     too thin to classify on, and no call has ever contained "strategy session".
//   - Fathom's own `calendar_invitees_domains_type` is unreliable here: it has
//     learned start2finishcoaching.com AND gmail.com as "internal", and the same
//     pair of people has landed in both buckets on different calls.
//   An explicit roster is the only signal that doesn't drift. A call counts as a
//   team call only if EVERY human invitee is on it; one unknown attendee means
//   we assume prospect and stay silent.

import Anthropic from "@anthropic-ai/sdk";
import { postToSlack } from "@/lib/slack";

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

// Known team addresses.
//
// Most of the sales team books with PERSONAL Gmail addresses, not company ones,
// so there is no domain rule that separates staff from prospects — clients
// (Tyson, Jake, Lucy, Keith) are on Gmail too. Each address below was confirmed
// against 3 months of real meeting history by who it co-attends with:
//   austinrichard6  — only ever on "Sales Team Huddle"
//   brozee2019      — Jacob Broz; his own 1:1 ("Broz") + "Sales Team Huddle"
//   amaraedwin9 / umunnakelechi89 / nwosudebbie / gideonadebowale11
//                   — the four setters, only ever on "Setter Connect"
//   alexwalsh520    — Alex's personal address, used alongside his company one
// Will has two addresses; his Fathom account is on the CLIENT's domain
// (start2finishcoaching.com), so omitting that one would suppress every call
// he runs. That domain is deliberately NOT a roster domain — Tyson's people
// are on it too.
const DEFAULT_ROSTER = [
  "matthew@clientconversion.io",
  "alex@clientconversion.io",
  "alexwalsh520@gmail.com",
  "jacob@clientconversion.io",
  "brozee2019@gmail.com",
  "austinrichard6@gmail.com",
  "will@clientconversion.io",
  "will@start2finishcoaching.com",
  "saeed16765@gmail.com", // Ahmad — product manager
  "amaraedwin9@gmail.com",
  "umunnakelechi89@gmail.com",
  "nwosudebbie@gmail.com",
  "gideonadebowale11@gmail.com",
  "nicole@clientconversion.io",
  "dana@clientconversion.io",
  "stef@clientconversion.io",
];

// Canonical person IDs. Several people book from more than one address (Alex
// and Will each have two), so the leadership-combo rules below have to compare
// PEOPLE, not email strings.
const PERSON_IDS: Record<string, string> = {
  "matthew@clientconversion.io": "matthew",
  "alex@clientconversion.io": "alex",
  "alexwalsh520@gmail.com": "alex",
  "will@clientconversion.io": "will",
  "will@start2finishcoaching.com": "will",
  "saeed16765@gmail.com": "ahmad",
  "jacob@clientconversion.io": "jacob",
  "brozee2019@gmail.com": "jacob",
  "austinrichard6@gmail.com": "austin",
  "amaraedwin9@gmail.com": "amara",
  "umunnakelechi89@gmail.com": "kelechi",
  "nwosudebbie@gmail.com": "debbie",
  "gideonadebowale11@gmail.com": "gideon",
  "nicole@clientconversion.io": "nicole",
  "dana@clientconversion.io": "dana",
  "stef@clientconversion.io": "stef",
};

// Leadership calls Matthew is already across — no point notifying him about a
// conversation he was in. Matched as EXACT sets: a call has to be precisely
// these people and nobody else. Note that Matt+Alex+Will ("MAW") is
// deliberately NOT here — it wasn't in the exclusion list, so it still posts.
const EXCLUDED_COMBOS: string[][] = [
  ["matthew", "alex"],
  ["matthew", "alex", "ahmad"],
  ["matthew", "will"],
  ["matthew", "will", "ahmad"],
];

function personId(email: string): string | null {
  return PERSON_IDS[email.trim().toLowerCase()] ?? null;
}

// Transcript speakers on impromptu calls have display names but no email, so
// the combo rules need a name route too. Keys are lowercase first names and
// the nicknames that actually show up in Fathom.
const NAME_TO_PERSON: Record<string, string> = {
  matthew: "matthew",
  matt: "matthew",
  alex: "alex",
  will: "will",
  ahmad: "ahmad",
  saeed: "ahmad",
  jacob: "jacob",
  broz: "jacob",
  austin: "austin",
  amara: "amara",
  kelechi: "kelechi",
  debbie: "debbie",
  deborah: "debbie",
  gideon: "gideon",
  nicole: "nicole",
  dana: "dana",
  stef: "stef",
};

// Longest keys first so "matthew" wins over "matt".
const NAME_KEYS = Object.keys(NAME_TO_PERSON).sort((a, b) => b.length - a.length);

/**
 * Resolve a spoken/display name to a person.
 *
 * Matching is prefix-tolerant in both directions because the transcript and the
 * calendar disagree: Fathom's speaker labels say "Alexander" where the invite
 * says "Alex". An exact-token match silently failed to suppress a Matt+Alex
 * 1:1. Over-matching is the safe direction here — this feeds the exclusion
 * rules only, so a false match suppresses a notification rather than leaking
 * one.
 */
function personIdFromName(name: string): string | null {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const p of parts) {
    if (NAME_TO_PERSON[p]) return NAME_TO_PERSON[p];
  }
  for (const p of parts) {
    if (p.length < 3) continue;
    for (const key of NAME_KEYS) {
      if (p.startsWith(key) || key.startsWith(p)) return NAME_TO_PERSON[key];
    }
  }
  return null;
}

/**
 * True when the attendee set is exactly one of the excluded leadership combos.
 * Any unrecognised attendee makes this false — an unknown person means this is
 * not one of the known internal pairings.
 */
function matchesExcludedCombo(ids: (string | null)[]): boolean {
  if (ids.some((id) => id === null)) return false;
  const set = new Set(ids as string[]);
  return EXCLUDED_COMBOS.some(
    (combo) => combo.length === set.size && combo.every((id) => set.has(id))
  );
}

// Fathom often stores the email in the `name` field when a calendar entry has
// no display name, which would otherwise print raw addresses into Slack.
const NAME_OVERRIDES: Record<string, string> = {
  "matthew@clientconversion.io": "Matthew",
  "alex@clientconversion.io": "Alex",
  "alexwalsh520@gmail.com": "Alex",
  "will@start2finishcoaching.com": "Will",
  "will@clientconversion.io": "Will",
  "brozee2019@gmail.com": "Jacob",
  "jacob@clientconversion.io": "Jacob",
  "austinrichard6@gmail.com": "Austin",
  "amaraedwin9@gmail.com": "Amara",
  "umunnakelechi89@gmail.com": "Kelechi",
  "nwosudebbie@gmail.com": "Debbie",
  "gideonadebowale11@gmail.com": "Gideon",
  "saeed16765@gmail.com": "Ahmad",
};

/**
 * Team roster, lowercased. Extend without a deploy via TEAM_CALL_ROSTER
 * (comma-separated emails) — needed for anyone whose address isn't in the repo
 * yet (Austin and the setters).
 */
export function getRoster(): Set<string> {
  const extra = (process.env.TEAM_CALL_ROSTER || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ROSTER, ...extra]);
}

/**
 * Domains where every address is a teammate. Optional; the roster is the
 * primary signal. start2finishcoaching.com must NOT go here — it's the client's
 * domain, so it would let client calls through.
 */
function getRosterDomains(): Set<string> {
  const raw = process.env.TEAM_CALL_ROSTER_DOMAINS || "clientconversion.io";
  return new Set(
    raw
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
  );
}

function isTeamMember(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  if (getRoster().has(e)) return true;
  const domain = e.split("@")[1];
  return !!domain && getRosterDomains().has(domain);
}

// Belt-and-braces: if a title looks like a sales call, stay quiet even when the
// roster says otherwise (e.g. a closer dialing a prospect from a team calendar).
const SALES_TITLE_PATTERNS = [
  /strategy\s*session/i,
  /\bsales\s*call\b/i,
  /discovery/i,
  /\bconsult(ation)?\b/i,
  /\bintro\s*call\b/i,
  /\bclose?\s*call\b/i,
  /\bqualif/i,
];

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------

interface Invitee {
  name?: string | null;
  email?: string | null;
  is_external?: boolean | null;
}

export interface FathomWebhookMeeting {
  title?: string | null;
  meeting_title?: string | null;
  share_url?: string | null;
  url?: string | null;
  recording_id?: number | string | null;
  meeting_type?: string | null;
  recorded_by?: { name?: string | null; email?: string | null } | null;
  calendar_invitees?: Invitee[] | null;
  default_summary?: string | null;
  action_items?: unknown;
  transcript?: unknown;
}

export type CallKind = "one_on_one" | "team_call";

export type Classification =
  | { action: "post"; kind: CallKind; participants: string[] }
  | { action: "skip"; reason: string }
  // No calendar invitees to judge on (impromptu Google Meets started without an
  // invite). The roster can't help, so the transcript gets read instead.
  | { action: "review"; reason: string };

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function displayName(i: Invitee): string {
  const email = (i.email || "").trim().toLowerCase();
  if (email && NAME_OVERRIDES[email]) return NAME_OVERRIDES[email];

  const name = (i.name || "").trim();
  // Fathom puts the address in `name` when the invite has no display name, so
  // a name containing "@" is not a name.
  if (name && !name.includes("@")) return name;

  if (!email) return "Unknown";
  const local = email.split("@")[0].replace(/[0-9]+$/, "");
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function classifyMeeting(m: FathomWebhookMeeting): Classification {
  const title = (m.title || m.meeting_title || "").trim();

  if (SALES_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { action: "skip", reason: `sales-call title: ${title || "(untitled)"}` };
  }

  const invitees = (m.calendar_invitees || []).filter(
    (i) => (i.email || "").includes("@")
  );

  // (Calls with too few invitees to judge are routed to the content reviewer
  // further down, after outsiders have been ruled out.)

  // Dedupe by email — Fathom sometimes lists the same person twice when they
  // join from two devices, which would otherwise turn a 1:1 into a "team call".
  const seen = new Map<string, Invitee>();
  for (const i of invitees) {
    const key = (i.email || "").trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, i);
  }
  const unique = [...seen.values()];

  const outsiders = unique.filter((i) => !isTeamMember(i.email || ""));
  if (outsiders.length > 0) {
    const who = outsiders.map((i) => i.email).join(", ");
    return { action: "skip", reason: `non-roster attendee(s): ${who}` };
  }

  // Fewer than two invitees means the calendar data can't describe the call.
  // In practice this is the "Impromptu Google Meet Meeting" case: the meeting
  // was started ad-hoc so only the host is listed, even though several people
  // spoke. Read the transcript instead of guessing.
  if (unique.length < 2) {
    return {
      action: "review",
      reason: `only ${unique.length} invitee(s) on the calendar — reading transcript`,
    };
  }

  const emails = unique.map((i) => i.email || "");
  if (matchesExcludedCombo(emails.map(personId))) {
    const who = emails.map((e) => personId(e)).join(" + ");
    return { action: "skip", reason: `excluded leadership combo: ${who}` };
  }

  return {
    action: "post",
    kind: unique.length === 2 ? "one_on_one" : "team_call",
    participants: unique.map(displayName),
  };
}

// ---------------------------------------------------------------------------
// Claude extraction
// ---------------------------------------------------------------------------

// Fathom returns `default_summary` but has no notion of "feedback given" — that
// only exists in the transcript, which is why this step is here at all.
const MAX_TRANSCRIPT_CHARS = 60_000;

function transcriptToText(transcript: unknown): string {
  if (typeof transcript === "string") return transcript;
  if (!Array.isArray(transcript)) return "";
  return transcript
    .map((seg) => {
      if (!seg || typeof seg !== "object") return "";
      const s = seg as Record<string, unknown>;
      const speaker =
        typeof s.speaker === "object" && s.speaker !== null
          ? String((s.speaker as Record<string, unknown>).display_name ?? "")
          : String(s.speaker ?? "");
      const text = String(s.text ?? "");
      return text ? `${speaker}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export interface CallDigest {
  covered: string[];
  feedback: string;
}

/**
 * One Claude call with a retry.
 *
 * The API intermittently returns a 500 carrying `x-should-retry: false`, which
 * stops the SDK's own retry logic. Testing confirmed these are transient and
 * unrelated to payload size or content — the identical request succeeds moments
 * later — but a bad window dropped 2 of 10 calls, and a dropped notification is
 * invisible to the user. Hence explicit attempts with backoff on top of the
 * SDK's own retries.
 */
const CLAUDE_ATTEMPTS = 3;

async function askClaude(prompt: string): Promise<string | null> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 3,
  });

  for (let attempt = 1; attempt <= CLAUDE_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } catch (err) {
      const last = attempt === CLAUDE_ATTEMPTS;
      console.error(
        `[team-calls] Claude call failed (attempt ${attempt}/${CLAUDE_ATTEMPTS})${
          last ? " — giving up" : " — retrying"
        }:`,
        err instanceof Error ? err.message : err
      );
      if (last) return null;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  return null;
}

/** Pull the first JSON object out of a model response, tolerating fences. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function extractDigest(
  m: FathomWebhookMeeting,
  kind: CallKind
): Promise<CallDigest> {
  const summary = (m.default_summary || "").trim();
  const transcript = transcriptToText(m.transcript).slice(0, MAX_TRANSCRIPT_CHARS);

  if (!summary && !transcript) {
    return { covered: [], feedback: "" };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Degrade rather than drop the notification — the "call finished / who /
    // link" part is still worth posting.
    console.warn("[team-calls] ANTHROPIC_API_KEY not set — posting without digest");
    return { covered: [], feedback: "" };
  }

  const label = kind === "one_on_one" ? "a one-on-one" : "a team call";
  const prompt = `You are summarizing ${label} on an internal sales team, for the CEO.

Return ONLY a JSON object, no prose and no code fences, shaped exactly:
{"covered": ["...", "..."], "feedback": "..."}

- "covered": 2-4 bullets on what the call actually covered. Each bullet MUST be
  a single short line, 15 words maximum — a scannable headline, not a sentence
  with clauses. Concrete topics and decisions, never filler like "team
  discussed various topics".
- "feedback": the coaching or corrective feedback the manager gave. Two short
  sentences maximum. If genuinely no feedback was given, return an empty
  string — never invent feedback that was not said.

This is a glanceable Slack notification, not a report. Be ruthless: the reader
should get the whole thing in about ten seconds and open the recording if they
want detail.

${summary ? `FATHOM SUMMARY:\n${summary}\n\n` : ""}${transcript ? `TRANSCRIPT:\n${transcript}` : ""}`;

  const text = await askClaude(prompt);
  const parsed = text ? parseJsonObject(text) : null;
  if (!parsed) {
    // Still post — "call finished / who / link" is worth having on its own.
    console.warn("[team-calls] No digest available; posting without it");
    return { covered: [], feedback: "" };
  }

  return {
    covered: Array.isArray(parsed.covered)
      ? parsed.covered.map((c) => String(c)).filter(Boolean)
      : [],
    feedback: typeof parsed.feedback === "string" ? parsed.feedback.trim() : "",
  };
}

// ---------------------------------------------------------------------------
// Content review (calls with no calendar invitees)
// ---------------------------------------------------------------------------

export type ReviewOutcome =
  | { action: "post"; kind: CallKind; participants: string[] }
  | { action: "skip"; reason: string };

/**
 * Decide from the transcript alone whether an impromptu call is internal.
 *
 * Deliberately biased toward silence: anything that isn't clearly an internal
 * team/training/1:1 conversation is dropped. Posting a sales call into the
 * manager channel is a worse failure than missing an ad-hoc huddle.
 */
export async function reviewUntitledCall(
  m: FathomWebhookMeeting
): Promise<ReviewOutcome> {
  const summary = (m.default_summary || "").trim();
  const transcript = transcriptToText(m.transcript).slice(0, MAX_TRANSCRIPT_CHARS);

  if (!transcript && !summary) {
    return { action: "skip", reason: "no transcript or summary to review" };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { action: "skip", reason: "ANTHROPIC_API_KEY not set — cannot review" };
  }

  const prompt = `Classify this recorded call. It has no calendar invite, so the
attendees are only knowable from the conversation itself.

Return ONLY a JSON object, no prose and no code fences:
{"category": "...", "participants": ["...", "..."]}

"category" must be exactly one of:
- "internal"  — a team call, a training/coaching session, or a one-on-one
                between colleagues at the same company
- "sales"     — a call with a prospect: pitching, pricing, closing, discovery,
                or anything where one side is being sold to
- "client"    — a call with an existing paying client about their account
- "unclear"   — you cannot confidently tell

"participants": the speakers' first names as used in the call.

Judge by substance. Internal calls discuss their own pipeline, their own reps,
process and tooling. Sales calls have someone being asked about their goals,
budget, or readiness to buy. When genuinely torn between "internal" and either
"sales" or "client", answer "unclear".

${summary ? `SUMMARY:\n${summary}\n\n` : ""}${transcript ? `TRANSCRIPT:\n${transcript}` : ""}`;

  const text = await askClaude(prompt);
  const parsed = text ? parseJsonObject(text) : null;
  if (!parsed) {
    return { action: "skip", reason: "content review unavailable" };
  }

  const category = String(parsed.category ?? "unclear");
  if (category !== "internal") {
    return { action: "skip", reason: `content review says: ${category}` };
  }

  const participants = Array.isArray(parsed.participants)
    ? parsed.participants.map((p) => String(p).trim()).filter(Boolean)
    : [];

  if (participants.length < 2) {
    return { action: "skip", reason: "content review found fewer than 2 speakers" };
  }

  // The leadership-combo rules apply here too — an impromptu Matt/Will call is
  // still a Matt/Will call.
  if (matchesExcludedCombo(participants.map(personIdFromName))) {
    const who = participants.map(personIdFromName).join(" + ");
    return { action: "skip", reason: `excluded leadership combo: ${who}` };
  }

  return {
    action: "post",
    kind: participants.length === 2 ? "one_on_one" : "team_call",
    participants,
  };
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

/**
 * Target channel — #a-sales-manager (private, C0AHBBZN947). Env overrides come
 * first so the channel can move without a deploy.
 */
export function getTeamCallsChannel(): string {
  return (
    process.env.SLACK_CHANNEL_TEAM_CALLS ||
    process.env.SLACK_CHANNEL_SALES_MANAGER ||
    "C0AHBBZN947"
  );
}

export function formatSlackMessage(
  m: FathomWebhookMeeting,
  kind: CallKind,
  participants: string[],
  digest: CallDigest
): string {
  const kindLabel = kind === "one_on_one" ? "One-on-one" : "Team call";
  const title = (m.title || m.meeting_title || "").trim();
  const link = (m.share_url || m.url || "").trim();

  const lines = [
    `*Call finished* — ${kindLabel}${title ? `: ${title}` : ""}`,
    `*Between:* ${participants.join(", ")}`,
  ];

  if (digest.covered.length > 0) {
    lines.push("*Covered:*");
    for (const c of digest.covered) lines.push(`• ${c}`);
  } else {
    lines.push("*Covered:* _not available_");
  }

  lines.push(`*Feedback given:* ${digest.feedback || "_none recorded_"}`);

  if (link) lines.push(`<${link}|Watch in Fathom>`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface HandleResult {
  posted: boolean;
  reason?: string;
}

export async function handleTeamCall(
  m: FathomWebhookMeeting
): Promise<HandleResult> {
  let decision = classifyMeeting(m) as
    | { action: "post"; kind: CallKind; participants: string[] }
    | { action: "skip"; reason: string }
    | { action: "review"; reason: string };

  // Impromptu calls: fall back to reading the transcript.
  if (decision.action === "review") {
    console.log(`[team-calls] ${decision.reason}`);
    decision = await reviewUntitledCall(m);
  }

  if (decision.action !== "post") {
    console.log(`[team-calls] Skipped: ${decision.reason}`);
    return { posted: false, reason: decision.reason };
  }

  const channel = getTeamCallsChannel();
  if (!channel) {
    console.error("[team-calls] No Slack channel resolved");
    return { posted: false, reason: "channel not configured" };
  }

  const digest = await extractDigest(m, decision.kind);
  const text = formatSlackMessage(
    m,
    decision.kind,
    decision.participants,
    digest
  );

  const ok = await postToSlack(channel, text);
  if (!ok) {
    // Most likely cause: the bot isn't a member of the private channel.
    console.error("[team-calls] Slack post failed (is the bot in the channel?)");
    return { posted: false, reason: "slack post failed" };
  }

  return { posted: true };
}
