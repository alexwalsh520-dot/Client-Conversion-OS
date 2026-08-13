// Micromanager: Alex's private sales-manager visibility layer.
// Storage + MCP surface for the daily call reviews. The ANALYSIS runs outside
// CCOS (Utari / Jeremy AI cron, unlimited Opus on their platform) — Utari pulls
// pending transcripts + the review prompt through the MCP tools below, runs the
// prompt, and writes the finished review back. CCOS never spends API money here.
import type { SupabaseClient } from "@supabase/supabase-js";

// Hormozi ACQ prompt #6 ("Sales Manager" - Sales Call Feedback Analyzer), verbatim
// from Alex's "14 Prompts from ACQ AI Onboarding" doc.
export const SALES_MANAGER_PROMPT = `Your job is to evaluate any sales call I upload and provide clear, actionable coaching structured around Stop / Start / Keep, plus deeper analysis of:

- Prospect psychology
- Missed opportunities
- Question quality
- Objection handling
- Framing and positioning
- Control of the call
- Emotional pacing
- Next-step setting

You must output precise, practical, tactically useful feedback -- no fluff, no corporate-speak.

TASKS

1. Summarize the Call (Briefly)
In 3-5 sentences, summarize:
- What happened
- Who controlled the call
- The prospect's core issue
- The overall outcome or failure point
This sets the stage for coaching.

2. STOP / START / KEEP Framework
Provide coaching using this structure:

STOP Doing
List specific behaviors the rep must eliminate.
Examples: leading questions, pitching too early, over-talking the prospect, weak reframes, missing emotional pain, getting lost in weeds.
Every bullet must be context-specific to their call.

START Doing
List clear new behaviors they should adopt.
Examples: ask deeper clarifying questions, slow down the pace, build tension effectively, redirect objections, anchor value before price, use labeling, looping, or reflective statements.
Each "START" must include examples of exact phrasing they could have used.

KEEP Doing
Call out their strengths.
Examples: great tone, solid rapport, asking about impact, clear next-step setting.
Reinforce what's already working.

3. Deep Tactical Feedback
Break down the performance across the following categories:

A. Discovery Quality
- Did they extract emotional pain?
- Did they uncover root causes, not just surface problems?
- Were questions deep enough to create insight?
- Did they avoid interrogating the prospect?

B. Framing & Positioning
- Did they position the offer as superior?
- Did they create contrast between the prospect's current state and desired state?
- Did they clearly communicate the mechanism?

C. Objection Handling
For each objection:
- Identify what the objection really was (fear, risk, money, timing).
- Explain how the rep handled it.
- Provide 2-3 specific lines they should have used instead.

D. Emotional Control & Pacing
Break down: tonality, silence usage, interruptions, call control, momentum, stress / pressure moments, where they lost leadership.

E. Trust & Authority Signals
Evaluate: competence framing, credibility, expertise, relatability, certainty transfer.

F. Closing Phase
- Was the close too early / too late?
- Did they future pace properly?
- Did they remove uncertainty?
- Did they present the offer clearly?
- Did they create a clean yes/no, or did they leave ambiguity?

4. Red Flags / Deal Breakers
Identify ANY behaviors that would consistently kill deals.
Examples: talking over the prospect, not validating emotions, giving too many options, pitching without discovery, not addressing hidden objections, sounding needy.
Each should include what to fix AND how.

5. Suggested Drills for Improvement
List practice exercises that directly address the weaknesses observed.
Examples: the 5 Why's drill, silence tolerance drill, reframes practice, objection loop training, roleplay scenarios, slow speech pacing exercise, root-cause probing practice.
Make them short, practical, and immediately implementable.

6. "If I Ran the Call..." Rewrite (Optional)
Rewrite key parts of the call (2-5 segments) showing:
- How you would have asked the question
- How you would have reframed
- How you would have handled the objection
- How you would have landed the close
This gives the rep a model to follow.

OUTPUT FORMAT
Your response should follow exactly this structure:
1. Call Summary
2. STOP Doing
3. START Doing (with example phrasing)
4. KEEP Doing
5. Discovery Feedback
6. Positioning & Framing Feedback
7. Objection Handling Feedback
8. Emotional Control & Pacing
9. Closing Feedback
10. Red Flags / Deal Breakers
11. Drills for Improvement
12. "If I Ran the Call" Rewrite

RULES
- No generic advice -- everything must be directly tied to the uploaded call.
- Be blunt, honest, and specific like a real sales leader.
- Use simple, direct language.
- Give actual example lines the rep should use next time.
- Always explain why behavior is good or bad from a sales psychology perspective.
- If the transcript is incomplete, state what you need more context on.`;

const SUBMIT_CONTRACT = `After writing the review, ALSO produce these fields and submit everything via mm_submit_call_review:
- fathom_id (from the pending call)
- review_md: the full review in markdown, following the OUTPUT FORMAT exactly
- grade: 0-100 overall rep performance on this call
- closer: the rep's first name as spoken on the call
- prospect_name, outcome (won / lost / follow-up / no-show / unclear)
- adherence_score (0-100) + adherence_notes: ONLY if a closer script is provided below. Grade how closely the rep followed the script -- allow reasonable variation in discovery/rapport sections, be strict on any lines the script marks as word-for-word (e.g. lines wrapped in **double asterisks** or marked VERBATIM). If no script is provided, omit both fields.`;

type Sb = SupabaseClient;

export async function mmPendingCalls(sb: Sb, limit: number) {
  const capped = Math.min(Math.max(limit || 3, 1), 10);
  const { data: reviewed } = await sb.from("mm_call_reviews").select("fathom_id");
  const done = new Set((reviewed || []).map((r) => r.fathom_id as string));
  const { data: calls, error } = await sb
    .from("fathom_calls")
    .select("fathom_id,title,recorded_at,duration_sec,prospect_name,client_key,attendees,transcript")
    .not("transcript", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const pending = (calls || []).filter((c) => !done.has(c.fathom_id as string)).slice(0, capped);
  return {
    note: "Sales calls with transcripts that have no review yet, newest first. For each: run the prompt from mm_get_review_prompt against the transcript, then write the result back with mm_submit_call_review. Pass a higher `limit` (max 10) to batch.",
    pending_count_total: (calls || []).filter((c) => !done.has(c.fathom_id as string)).length,
    calls: pending,
  };
}

export async function mmGetReviewPrompt(sb: Sb) {
  const { data: scripts } = await sb.from("mm_scripts").select("role,content");
  const closerScript = scripts?.find((s) => s.role === "closer")?.content?.trim() || null;
  const setterScript = scripts?.find((s) => s.role === "setter")?.content?.trim() || null;
  return {
    review_prompt: SALES_MANAGER_PROMPT,
    submit_contract: SUBMIT_CONTRACT,
    closer_script: closerScript,
    setter_script: setterScript,
    note: closerScript
      ? "closer_script is set: include adherence_score + adherence_notes in every call review."
      : "No closer script saved yet: omit adherence fields from call reviews.",
  };
}

export async function mmSubmitCallReview(sb: Sb, a: Record<string, unknown>) {
  const fathomId = String(a.fathom_id || "").trim();
  const reviewMd = String(a.review_md || "").trim();
  if (!fathomId) throw new Error("fathom_id is required");
  if (!reviewMd) throw new Error("review_md is required");
  const { data: call } = await sb
    .from("fathom_calls")
    .select("fathom_id,recorded_at,prospect_name")
    .eq("fathom_id", fathomId)
    .maybeSingle();
  if (!call) throw new Error(`no fathom_calls row with fathom_id ${fathomId}`);
  const clamp = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : null;
  const row = {
    fathom_id: fathomId,
    call_date: call.recorded_at ? String(call.recorded_at).slice(0, 10) : null,
    prospect_name: (a.prospect_name as string) || (call.prospect_name as string) || null,
    closer: (a.closer as string) || null,
    outcome: (a.outcome as string) || null,
    grade: clamp(a.grade),
    adherence_score: clamp(a.adherence_score),
    adherence_notes: (a.adherence_notes as string) || null,
    review_md: reviewMd,
    model: (a.model as string) || null,
    source: "utari",
  };
  const { error } = await sb.from("mm_call_reviews").upsert(row, { onConflict: "fathom_id" });
  if (error) throw new Error(error.message);
  return { saved: true, fathom_id: fathomId };
}

export async function mmPendingDms(sb: Sb, limit: number) {
  const capped = Math.min(Math.max(limit || 5, 1), 20);
  const { data: scripts } = await sb.from("mm_scripts").select("role,content").eq("role", "setter");
  const setterScript = scripts?.[0]?.content?.trim() || null;
  if (!setterScript) {
    return { note: "No setter DM script saved yet -- nothing to grade. Alex saves scripts on the Micromanager page.", conversations: [] };
  }
  const { data: reviewed } = await sb.from("mm_dm_reviews").select("dm_transcript_id");
  const done = new Set((reviewed || []).map((r) => String(r.dm_transcript_id)));
  const { data: dms, error } = await sb
    .from("dm_transcripts")
    .select("id,setter_name,client,transcript,submitted_at")
    .order("submitted_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const pending = (dms || []).filter((d) => !done.has(String(d.id))).slice(0, capped);
  return {
    note: "DM conversations with no adherence review yet. Grade each against setter_script (allow reasonable variation, strict on word-for-word lines marked with **double asterisks** or VERBATIM), then submit via mm_submit_dm_review.",
    setter_script: setterScript,
    conversations: pending,
  };
}

export async function mmSubmitDmReview(sb: Sb, a: Record<string, unknown>) {
  const id = String(a.dm_transcript_id || "").trim();
  if (!id) throw new Error("dm_transcript_id is required");
  const score =
    typeof a.adherence_score === "number" && Number.isFinite(a.adherence_score)
      ? Math.min(100, Math.max(0, Math.round(a.adherence_score)))
      : null;
  if (score === null) throw new Error("adherence_score (0-100) is required");
  const row = {
    dm_transcript_id: id,
    setter_name: (a.setter_name as string) || null,
    adherence_score: score,
    review_md: (a.review_md as string) || null,
    model: (a.model as string) || null,
  };
  const { error } = await sb.from("mm_dm_reviews").upsert(row, { onConflict: "dm_transcript_id" });
  if (error) throw new Error(error.message);
  return { saved: true, dm_transcript_id: id };
}
