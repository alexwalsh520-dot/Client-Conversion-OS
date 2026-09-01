/**
 * Lead Score pilot (Tyson only).
 *
 * Nightly, for each new keyword lead, an AI reads the FIRST stretch of the
 * DM conversation and scores how much the person talks like our historical
 * buyers did (specific goal, real replies, personal detail, urgency) versus
 * our historical ghosts (one-word answers, freebie-only, no engagement).
 *
 * Silent pilot: rows go to public.lead_scores and nothing else. The weekly
 * grade (view public.lead_score_grades) checks bands against real outcomes.
 * The score never touches ad spend and never pauses anything.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-haiku-4-5-20251001";
const RUBRIC_VERSION = "v1";
const MESSAGES_PER_LEAD = 15;

// dm_conversation_messages uses long client names; keyword events use short.
const DM_CLIENT: Record<string, string> = { tyson: "tyson_sonnek" };

interface Candidate {
  subscriber_id: string;
  keyword_normalized: string | null;
  first_keyword_at: string;
}

interface ScoreResult {
  score: number;
  band: "high" | "medium" | "low";
  reasons: string[];
}

const SYSTEM_PROMPT = `You score Instagram DM leads for a fitness coaching business that sells a paid 1-on-1 program ($1,200 to $2,400). You read the opening stretch of a conversation and judge how much this person resembles a real buyer.

Signals that historically mean a GOOD lead (raise the score):
- Specific personal goal or pain ("I want to lose 20 lbs before my wedding", "my knees hurt on runs")
- Real sentences and real replies to questions, not one-word answers
- Shares personal details unprompted (age, job, schedule, past attempts)
- Urgency or a timeline ("starting the academy in January")
- Asks about the program, the process, or the price
- Replies keep coming; the person carries the conversation

Signals that historically mean a BAD lead (lower the score):
- One-word or emoji-only replies, or silence after the free thing arrives
- Only wants the freebie; ignores every question
- Vague wishes with no specifics ("wanna get fit")
- Obvious spam, fan messages, or people outside the audience

Return STRICT JSON only, no prose:
{"score": <0-100>, "band": "high"|"medium"|"low", "reasons": ["<short reason>", ...]}
Bands: high = 70+, medium = 40-69, low = under 40. 2 to 4 short reasons, each under 12 words.`;

function getAnthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey: key });
}

/** Leads with a keyword DM in the window that have no score row yet. */
async function findCandidates(
  db: SupabaseClient,
  clientKey: string,
  days: number,
  limit: number,
): Promise<Candidate[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: events, error } = await db
    .from("ads_keyword_events")
    .select("subscriber_id, keyword_normalized, event_at")
    .eq("client_key", clientKey)
    .eq("event_type", "dm_keyword")
    .gte("event_at", since)
    .not("subscriber_id", "is", null)
    .order("event_at", { ascending: true });
  if (error) throw new Error(`ads_keyword_events read failed: ${error.message}`);

  // First keyword event per subscriber.
  const firstBySub = new Map<string, Candidate>();
  for (const e of events ?? []) {
    if (!firstBySub.has(e.subscriber_id)) {
      firstBySub.set(e.subscriber_id, {
        subscriber_id: e.subscriber_id,
        keyword_normalized: e.keyword_normalized,
        first_keyword_at: e.event_at,
      });
    }
  }
  const subs = [...firstBySub.keys()];
  if (subs.length === 0) return [];

  // Drop already-scored subscribers (chunked: .in() caps around 200 ids).
  const scored = new Set<string>();
  for (let i = 0; i < subs.length; i += 200) {
    const { data: rows, error: sErr } = await db
      .from("lead_scores")
      .select("subscriber_id")
      .eq("client_key", clientKey)
      .eq("rubric_version", RUBRIC_VERSION)
      .in("subscriber_id", subs.slice(i, i + 200));
    if (sErr) throw new Error(`lead_scores read failed: ${sErr.message}`);
    for (const r of rows ?? []) scored.add(r.subscriber_id);
  }

  return subs
    .filter((s) => !scored.has(s))
    .slice(0, limit)
    .map((s) => firstBySub.get(s)!);
}

async function fetchOpeningMessages(
  db: SupabaseClient,
  dmClient: string,
  subscriberId: string,
): Promise<{ transcript: string; count: number }> {
  const { data: msgs, error } = await db
    .from("dm_conversation_messages")
    .select("direction, body, sent_at")
    .eq("client", dmClient)
    .eq("subscriber_id", subscriberId)
    .order("sent_at", { ascending: true })
    .limit(MESSAGES_PER_LEAD);
  if (error) throw new Error(`dm messages read failed: ${error.message}`);
  const lines = (msgs ?? [])
    .filter((m) => (m.body ?? "").trim().length > 0)
    .map((m) => `${m.direction === "inbound" ? "LEAD" : "COACH"}: ${String(m.body).slice(0, 500)}`);
  return { transcript: lines.join("\n"), count: lines.length };
}

function parseScore(raw: string): ScoreResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const score = Math.round(Number(obj.score));
    const band = obj.band;
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    if (band !== "high" && band !== "medium" && band !== "low") return null;
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.slice(0, 4).map(String) : [];
    return { score, band, reasons };
  } catch {
    return null;
  }
}

export interface LeadScoreTickReport {
  candidates: number;
  scored: number;
  skippedNoMessages: number;
  failed: number;
}

export async function runLeadScoreTick(
  db: SupabaseClient,
  opts: { clientKey?: string; days?: number; limit?: number } = {},
): Promise<LeadScoreTickReport> {
  const clientKey = opts.clientKey ?? "tyson";
  const dmClient = DM_CLIENT[clientKey];
  if (!dmClient) throw new Error(`lead-score: no DM client mapping for ${clientKey}`);
  const days = Math.min(Math.max(opts.days ?? 3, 1), 60);
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 80);

  const candidates = await findCandidates(db, clientKey, days, limit);
  const anthropic = getAnthropic();
  const report: LeadScoreTickReport = {
    candidates: candidates.length,
    scored: 0,
    skippedNoMessages: 0,
    failed: 0,
  };

  for (const cand of candidates) {
    try {
      const { transcript, count } = await fetchOpeningMessages(db, dmClient, cand.subscriber_id);
      if (count < 2) {
        report.skippedNoMessages++;
        continue;
      }
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Keyword the lead sent: ${cand.keyword_normalized ?? "unknown"}\n\nOpening of the conversation (oldest first):\n${transcript}`,
          },
        ],
      });
      logAiUsage({ feature: "lead-score", model: MODEL, usage: response.usage });
      const text = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      const parsed = parseScore(text);
      if (!parsed) {
        report.failed++;
        continue;
      }
      const { error } = await db.from("lead_scores").upsert(
        {
          client_key: clientKey,
          subscriber_id: cand.subscriber_id,
          keyword_normalized: cand.keyword_normalized,
          first_keyword_at: cand.first_keyword_at,
          score: parsed.score,
          band: parsed.band,
          reasons: parsed.reasons,
          messages_read: count,
          model: MODEL,
          rubric_version: RUBRIC_VERSION,
        },
        { onConflict: "client_key,subscriber_id,rubric_version" },
      );
      if (error) throw new Error(`lead_scores write failed: ${error.message}`);
      report.scored++;
    } catch (err) {
      console.error(`lead-score: ${cand.subscriber_id} failed`, err);
      report.failed++;
    }
  }
  return report;
}
