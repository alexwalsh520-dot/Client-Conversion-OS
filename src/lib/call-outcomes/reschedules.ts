// Reschedules, read out of #call-updates.
//
// There is no structured reschedule signal anywhere. GHL stores every row as
// status "booked" — a moved call just becomes a second booking, and the
// original is never marked. The only place a human records "this call moved"
// is #call-updates, in free text:
//
//   "Kyle McCullough got called back into work, got him rescheduled for
//    tomorrow same time"
//   "Nathalie Phanor had to reschedule. Have her back in today at 5"
//   "Austin Walker has requested a reschedule. Sent him your reschedule link"
//
// Keyword matching on "reschedul" over-fires badly here (setters ASK about
// reschedules constantly, and closers discuss calls from other days in the same
// thread), so the channel is read by an LLM that is handed the day's actual
// prospect list and told to only answer within it. No key or no channel access
// degrades to "no reschedules found" plus a warning — never a failed report.

import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai-usage";
import { etDayBoundsUtc, ET } from "@/lib/daily-report/time";

const SLACK_API_BASE = "https://slack.com/api";
const MODEL = "claude-sonnet-4-5-20250929";

/** #call-updates — private, so the bot must be invited before this returns anything. */
const DEFAULT_CALL_UPDATES_CHANNEL = "C09KKCU3S65";

/**
 * Closers post the day's wrap-up after midnight ET fairly often, so the read
 * window runs to 4am the next morning rather than stopping at the day boundary.
 *
 * The window deliberately does NOT reach back into the previous day. Advance
 * notices ("got him rescheduled for tomorrow same time") are ambiguous when
 * read from the next day's report: that message describes a call moving INTO
 * the reported day, not one moving out of it, and counting it would flip a call
 * that actually ran. Precision wins here — a wrong "rescheduled" contradicts
 * the tracker, while a missed one still shows its real tracker outcome
 * (NS/RS) on the call's own line.
 */
const TRAILING_HOURS = 4;

export interface RescheduleHit {
  prospect: string;
  evidence: string;
}

interface SlackMessage {
  ts?: string;
  text?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
  messages?: SlackMessage[];
}

function channelId(): string {
  return process.env.SLACK_CHANNEL_CALL_UPDATES?.trim() || DEFAULT_CALL_UPDATES_CHANNEL;
}

/** Raw messages posted in the ET day (plus the early-hours tail). */
async function fetchDayMessages(day: string): Promise<SlackMessage[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  const { startMs, endMs } = etDayBoundsUtc(day);
  const oldest = String(Math.floor(startMs / 1000));
  const latest = String(Math.floor((endMs + TRAILING_HOURS * 3600_000) / 1000));

  const out: SlackMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      channel: channelId(),
      oldest,
      latest,
      inclusive: "true",
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${SLACK_API_BASE}/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`slack HTTP ${res.status}`);

    const data = (await res.json()) as SlackHistoryResponse;
    if (!data.ok) {
      // channel_not_found here almost always means "the bot isn't in the private
      // channel yet" — say so, because the fix is a one-line /invite.
      const hint =
        data.error === "channel_not_found" || data.error === "not_in_channel"
          ? ` (invite the bot to #call-updates: /invite @Sales Manager)`
          : "";
      throw new Error(`slack ${data.error}${hint}`);
    }

    for (const m of data.messages || []) {
      if (m.text && !m.subtype) out.push(m);
    }

    cursor = data.response_metadata?.next_cursor || undefined;
    if (!data.has_more || !cursor) break;
  }

  return out;
}

function etTimestamp(ts: string | undefined): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Number(ts) * 1000));
}

const SYSTEM_PROMPT = `You read a sales team's Slack channel and report which of that day's scheduled calls were rescheduled.

The messages are from the same day as the calls (plus the early hours after). The team refers to prospects loosely — first name only, a nickname, a shortened surname, or a misspelling. Map those to the provided list; if you cannot tell which listed prospect a message is about, leave it out.

A call counts as RESCHEDULED when the messages show it did not happen at its scheduled time and is being moved. Examples that count:
- "had to reschedule. Have her back in today at 5"
- "got called back into work, got him rescheduled for tomorrow"
- "has requested a reschedule. Sent him your reschedule link"
- "wants to move his call"
- "no showed then rescheduled"

Do NOT count:
- calls that simply happened — outcomes, wins, "he's on", call notes
- a no-show with no mention of moving the call
- a TEAMMATE asking whether someone rescheduled ("Did he reschedule?", "Has he?") with no confirming answer
- a team member moving their own internal meeting rather than a prospect call
- a prospect who is not on the provided list

Respond with JSON only, no prose, in exactly this shape:
{"rescheduled":[{"prospect":"<name copied EXACTLY from the provided list>","evidence":"<short quote, max 15 words>"}]}
If nothing qualifies, respond {"rescheduled":[]}.`;

export function parseHits(text: string, prospects: string[]): RescheduleHit[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { rescheduled?: unknown })?.rescheduled;
  if (!Array.isArray(list)) return [];

  const allowed = new Set(prospects.map((p) => p.toLowerCase().trim()));
  const hits: RescheduleHit[] = [];
  for (const item of list) {
    const prospect = String((item as { prospect?: unknown })?.prospect ?? "").trim();
    if (!prospect || !allowed.has(prospect.toLowerCase())) continue; // never trust a name off-list
    hits.push({
      prospect,
      evidence: String((item as { evidence?: unknown })?.evidence ?? "").trim().slice(0, 120),
    });
  }
  return hits;
}

/**
 * Which of `prospects` had their call moved, per #call-updates on `day`.
 * Throws on a source failure so the caller can surface it as a warning.
 */
export async function fetchReschedules(
  day: string,
  prospects: string[],
): Promise<RescheduleHit[]> {
  if (prospects.length === 0) return [];

  const messages = await fetchDayMessages(day);
  if (messages.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const transcript = messages
    .slice()
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .map((m) => `[${etTimestamp(m.ts)}] ${m.text}`)
    .join("\n");

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Calls scheduled for ${day} (Eastern):\n${prospects.map((p) => `- ${p}`).join("\n")}\n\n#call-updates messages:\n${transcript}`,
      },
    ],
  });

  logAiUsage({ feature: "call-outcomes-reschedules", model: MODEL, usage: message.usage });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");

  return parseHits(text, prospects);
}
