// Daily Coacher: persistent client summary generator.
//
// Mirrors the Claude-call pattern from src/lib/nutrition/plan-generator.ts.
// The summary is the primary context for every topic generation, so its
// quality is upstream of the entire feature's quality.
//
// Prompt design:
//   - System prompt is static and cached (cache_control: ephemeral). It pays
//     off most when Phase 6's topic generation reuses the summary as context
//     across multiple back-to-back topic drafts for the same client.
//   - User prompt is a structured block of XML-tagged sections. XML tags
//     give Claude clear input boundaries and let us keep prompt cost low
//     by skipping any section that's empty.
//
// Hard constraint baked into the prompt:
//   - No specific macros, calorie counts, or measurements. The nutrition
//     intake form may contain them but the summary must stay general.
//   - No fabricated facts. If a section is empty, the summary acknowledges
//     "no data" rather than inventing.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import {
  gatherSummaryInputs,
  type SummaryInputs,
  type NutritionIntake,
  type MeetingNote,
  type ClientNoteRow,
  type LiveMessage,
  type ProgramProgress,
  type CheckInRow,
} from "./summary-inputs";
import { stripDashes } from "./text-cleanup";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1500;

// ---------------------------------------------------------------------------
// System prompt (cached)
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are an internal-tooling assistant for an online fitness coaching company (CCOS). Your job is to write a tight, scannable client snapshot that a coach can read in under 30 seconds before sending the client a message.

OUTPUT FORMAT (non-negotiable):
Return ONLY plain markdown with the exact section headings below. No preamble, no closing remarks, no meta-commentary. The coach is opening this 50+ times a day; every wasted line costs them.

\`\`\`
**WHO**
[1-2 sentences: name, current program + day position (e.g. "Day 28 of 183"), coach, headline goal in their own framing]

**KEY CONTEXT**
- Goal and journey type: [from intake or onboarding call]
- Restrictions/allergies: [or "none reported"]
- Lifestyle signals: [sleep, work, family, hobbies, time-availability, only if mentioned]
- History: [training history, prior attempts, what hasn't worked, only if mentioned]
- Notable from onboarding call: [1-2 specific things the coach should remember; "none on file" if no transcript]

**RECENT STATE**
- Last meeting takeaway: [most recent meeting note's key point; "no meetings logged" if none]
- Coach notes summary: [common threads across recent client_notes; "no notes yet" if none]
- Recent message tone: [reading the last 20 client/coach exchanges, what's the client's current sentiment (engaged, slipping, frustrated, energized, quiet)? "no recent exchanges" if none]

**HEADS UP**
- [Any flags worth surfacing: medical supervision, retention risk, missed check-ins, upcoming milestones, conflicting signals between sources. If nothing notable, write "Nothing flagged."]
\`\`\`

WRITING RULES (strict):
1. NEVER include specific numeric macros, calorie counts, or weight measurements (no "175g protein", no "2,400 cal", no "down 12 lbs"). Talk in qualitative terms only ("eating more protein," "trending toward goal," "lost some weight"). The intake form may contain these numbers; do NOT pass them through.
2. NEVER fabricate. If a source is empty, write the explicit "no data" phrasing in the template above.
3. NEVER reference Everfit, training program details, or anything the coach didn't feed you. Coach is the sole source of truth for this client.
4. NEVER use em-dashes (U+2014, the long dash) or en-dashes (U+2013) anywhere in your output. Use commas, periods, parentheses, or restructure the sentence. This is a hard formatting rule because the coach pastes drafts into Everfit and em-dashes signal AI-generated text.
5. Each bullet should be one sentence. Two max if the second sentence adds genuinely new context. The coach is skimming.
6. Quote specific phrases sparingly, only when the client's own words capture something you can't paraphrase well (e.g., client said "I feel like I'm wasting your time"). Otherwise paraphrase.
7. If sources contradict each other (intake says vegetarian, recent message mentions chicken), surface the contradiction in HEADS UP rather than picking one.
8. The total snapshot should fit in roughly 200-300 words. Cut, don't pad.

You are summarizing for the coach, not the client. Write in third person about the client. Use coaching-internal language ("client," not "you").`;
}

// ---------------------------------------------------------------------------
// User prompt builder — XML-tagged sections, skip empties
// ---------------------------------------------------------------------------

function fmtIntake(intake: NutritionIntake | null): string {
  if (!intake) return "<intake>none on file</intake>";
  const fields: [string, string | number | null | undefined][] = [
    ["age", intake.age],
    ["height", intake.height],
    ["current_weight", intake.current_weight],
    ["goal_weight", intake.goal_weight],
    ["fitness_goal", intake.fitness_goal],
    ["foods_enjoy", intake.foods_enjoy],
    ["foods_avoid", intake.foods_avoid],
    ["allergies", intake.allergies],
    ["protein_preferences", intake.protein_preferences],
    ["can_cook", intake.can_cook],
    ["meal_count", intake.meal_count],
    ["medications", intake.medications],
    ["supplements", intake.supplements],
    ["sleep_hours", intake.sleep_hours],
    ["water_intake", intake.water_intake],
    ["daily_meals_description", intake.daily_meals_description],
    ["daily_meals_description_2", intake.daily_meals_description_2],
    ["medical_supervision", intake.medical_supervision_yn],
    ["medical_supervision_detail", intake.medical_supervision_detail],
  ];
  const lines = fields
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `  ${k}: ${String(v).trim()}`);
  if (lines.length === 0) return "<intake>none on file</intake>";
  return `<intake>\n${lines.join("\n")}\n</intake>`;
}

function fmtMeetings(meetings: MeetingNote[]): string {
  if (meetings.length === 0) return "<meeting_notes>none logged</meeting_notes>";
  const blocks = meetings.map((m) => {
    const date = m.meeting_date || m.created_at?.slice(0, 10) || "(unknown date)";
    const dur = m.duration_minutes ? ` (${m.duration_minutes}min)` : "";
    return `  [${date}${dur}]\n  ${m.notes?.trim()}`;
  });
  return `<meeting_notes>\n${blocks.join("\n\n")}\n</meeting_notes>`;
}

function fmtClientNotes(notes: ClientNoteRow[]): string {
  if (notes.length === 0) return "<coach_notes>none yet</coach_notes>";
  const blocks = notes.map((n) => {
    const date = n.created_at?.slice(0, 10) || "(unknown)";
    const author = n.coach_name ? `, ${n.coach_name}` : "";
    return `  [${date}${author}] ${n.note?.trim()}`;
  });
  return `<coach_notes>\n${blocks.join("\n")}\n</coach_notes>`;
}

function fmtLiveMessages(msgs: LiveMessage[]): string {
  if (msgs.length === 0) return "<recent_exchanges>none</recent_exchanges>";
  const lines = msgs.map((m) => {
    const date = m.created_at?.slice(0, 10) || "";
    return `  [${date}] ${m.role}: ${m.message.trim()}`;
  });
  return `<recent_exchanges>\n${lines.join("\n")}\n</recent_exchanges>`;
}

function fmtCheckIns(checkIns: CheckInRow[]): string {
  if (checkIns.length === 0) {
    return "<client_check_ins>none submitted</client_check_ins>";
  }
  // Newest 5 — beyond that the summary already has enough signal and
  // token cost outweighs marginal context value.
  const blocks = checkIns.slice(0, 5).map((ci) => {
    const date = ci.submitted_at.slice(0, 10);
    const para = ci.q5_open_response?.trim()
      ? `\n    note: ${ci.q5_open_response.trim().replace(/\n/g, " ")}`
      : "";
    return `  [${date}] score ${ci.score_0_100}/100 (coaching=${ci.q1_overall}, strength=${ci.q2_strength}, nutrition+sleep=${ci.q3_lifestyle}, progress=${ci.q4_progress})${para}`;
  });
  return `<client_check_ins>\n${blocks.join("\n")}\n</client_check_ins>`;
}

function fmtTranscript(transcript: string | null): string {
  if (!transcript) return "<onboarding_call_transcript>not available</onboarding_call_transcript>";
  // Keep the transcript intact — Claude can handle the whole thing within
  // our token budget for this call, and details matter (specific phrases,
  // self-reported fears, etc. that get lost in aggressive truncation).
  return `<onboarding_call_transcript>\n${transcript.trim()}\n</onboarding_call_transcript>`;
}

function fmtProgress(p: ProgramProgress): string {
  if (p.daysElapsed === null || p.programDays === null) {
    return "<program_position>dates not on file</program_position>";
  }
  return `<program_position>Day ${p.daysElapsed} of ${p.programDays} (${p.percentThrough}% through, ${p.daysRemaining} days remaining). Phase: ${p.phase.replace(/_/g, " ")}.</program_position>`;
}

function buildUserPrompt(inputs: SummaryInputs): string {
  const c = inputs.client;
  const header = `<client>
  name: ${c.name}
  coach: ${c.coach_name || "(unassigned)"}
  program: ${c.program || "(not specified)"}${c.offer ? ` (offer: ${c.offer})` : ""}
  start_date: ${c.start_date || "(unknown)"}
  end_date: ${c.end_date || "(unknown)"}
  onboarding_date: ${c.onboarding_date || "(unknown)"}
</client>`;

  return [
    header,
    fmtProgress(inputs.progress),
    fmtIntake(inputs.intake),
    fmtTranscript(inputs.transcript),
    fmtMeetings(inputs.meetings),
    fmtClientNotes(inputs.clientNotes),
    fmtLiveMessages(inputs.liveMessages),
    fmtCheckIns(inputs.checkIns),
    `\nGenerate the snapshot now. Follow the format exactly.`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return key;
}

export interface GenerateSummaryResult {
  summary: string;
  /** Tokens reported by the API. Useful for cost monitoring. */
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Generates a summary from already-gathered inputs. Does NOT persist —
 * caller is responsible for writing to clients.daily_coacher_summary.
 */
export async function generateSummaryFromInputs(
  inputs: SummaryInputs
): Promise<GenerateSummaryResult> {
  const anthropic = new Anthropic({ apiKey: getApiKey() });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(inputs) }],
  });

  logAiUsage({ feature: "daily-coacher-summary", model: MODEL, usage: response.usage });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block for summary generation");
  }

  return {
    summary: stripDashes(textBlock.text),
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Top-level helper: gather inputs, generate summary, persist to the client
 * row (`daily_coacher_summary` + `daily_coacher_summary_updated_at`).
 *
 * Returns the new summary text + token usage. Returns null only if the
 * client doesn't exist; otherwise generation errors propagate so the
 * caller can surface them.
 */
export async function regenerateAndPersistSummary(
  clientId: number
): Promise<GenerateSummaryResult | null> {
  const inputs = await gatherSummaryInputs(clientId);
  if (!inputs) return null;

  const result = await generateSummaryFromInputs(inputs);

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("clients")
    .update({
      daily_coacher_summary: result.summary,
      daily_coacher_summary_updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (error) {
    // Generation succeeded; persistence failed. Surface to caller — they
    // probably want to retry the write rather than silently lose the summary.
    throw new Error(
      `Summary generated but failed to persist: ${error.message}`
    );
  }

  return result;
}
