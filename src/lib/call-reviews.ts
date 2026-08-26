// Call Review Autopilot — the engine behind /api/cron/call-reviews and
// /api/cron/call-reviews-digest.
//
// Layer 1 (every 30 min): pull fresh calls from the Fathom API (self-healing,
// webhook-independent), collect finished reviews from Jeremy, dispatch new
// transcripts to Jeremy. Layer 2 (daily): roll the day's reviews into a
// head-of-sales digest with per-closer strengths/weaknesses and the top
// low-hanging fruit, plus a watchdog for a silently dead call feed.
//
// Hard rules learned from the content-pipeline outage: every external call has
// its own timeout and its own try/catch; one bad call can never block the
// queue; the tick reports what it did instead of failing silently.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SALES_MANAGER_PROMPT, mmSubmitCallReview } from "@/lib/micromanager";
import { jeremySend, jeremyPoll } from "@/lib/jeremy";
import { postAsCso } from "@/lib/slack";

type Sb = SupabaseClient;

const MAX_IN_FLIGHT = 2; // concurrent Jeremy runs (calls only; the digest rides on top)
const MAX_ATTEMPTS = 3;
const STALE_RUN_MS = 24 * 3600e3;
const MIN_DURATION_SEC = 8 * 60; // shorter than this = no-show / scheduling call
const TRANSCRIPT_CAP = 60000;
const APP_URL = "https://client-conversion-os.vercel.app";

// Same internal-meeting patterns the Sales Hub and Micromanager overview use.
const INTERNAL_TITLE_PATTERNS = [
  "sales team huddle", "c suite", "management", "setter connect", "training", "interview", "1:1", "huddle",
];

// Used when no guardrails row is saved in mm_scripts (role = "guardrails").
export const DEFAULT_GUARDRAILS = `You are coaching a rep inside an established company. The offer, the prices, the booking process, and the overall script structure are fixed and are not yours to change. Never advise the rep to change the offer, discount, restructure pricing, rewrite the script, skip the company's process, or move the sale to another channel. All coaching must be about running the existing play better: discovery depth, tonality, objection handling, pacing, closing within the current script and offer. If the call's problems genuinely come from something outside the rep's control, say so in one line at the end under "Flag for management" instead of coaching around it.`;

function etDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/* ------------------------------ Fathom sync ------------------------------ */

// Fathom transcript = [{speaker:{display_name}, text}]. Flatten to readable text.
function flattenTranscript(t: unknown): string {
  if (!Array.isArray(t)) return "";
  const out: string[] = [];
  for (const seg of t) {
    if (typeof seg === "string") { out.push(seg); continue; }
    const s = seg as { speaker?: { display_name?: string }; text?: string };
    if (s.text) out.push(`${s.speaker?.display_name ? s.speaker.display_name + ": " : ""}${s.text}`);
  }
  return out.join("\n").slice(0, 80000);
}

function prospectFromTitle(title: string): string | null {
  const m = title.split(/<>|—|-\s/)[1] || title.split("-")[1];
  const cleaned = (m || "").replace(/\(.*?\)/g, "").trim();
  return cleaned || null;
}

function durationSec(start: unknown, end: unknown): number | null {
  const a = typeof start === "string" ? Date.parse(start) : NaN;
  const b = typeof end === "string" ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 1000);
}

/** Pull recent meetings straight from the Fathom API so the pipeline works even
 *  if the webhook is dead. Covers everyone visible to the team's API key. */
export async function fathomPullSync(sb: Sb): Promise<{ stored: number; note?: string }> {
  const key = process.env.FATHOM_API_KEY?.trim();
  if (!key) return { stored: 0, note: "FATHOM_API_KEY not set" };

  const { data: newestRows } = await sb
    .from("fathom_calls").select("recorded_at")
    .order("recorded_at", { ascending: false }).limit(1);
  const newestMs = newestRows?.[0]?.recorded_at ? Date.parse(String(newestRows[0].recorded_at)) : 0;
  // Re-scan a 2-day overlap behind the newest stored call, never more than 14 days back.
  const since = new Date(Math.max(newestMs - 2 * 86400e3, Date.now() - 14 * 86400e3)).toISOString();

  let cursor: string | null = null;
  let stored = 0;
  for (let page = 0; page < 3; page++) {
    const u = new URL("https://api.fathom.ai/external/v1/meetings");
    u.searchParams.set("created_after", since);
    u.searchParams.set("include_transcript", "true");
    u.searchParams.set("limit", "10");
    if (cursor) u.searchParams.set("cursor", cursor);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let json: { items?: Record<string, unknown>[]; next_cursor?: string };
    try {
      const res = await fetch(u.toString(), {
        headers: { "X-Api-Key": key }, cache: "no-store", signal: ctrl.signal,
      });
      if (!res.ok) return { stored, note: `fathom http ${res.status}` };
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const items = json.items || [];
    if (items.length === 0) break;
    const rows = items
      .map((it) => {
        const title = String(it.title || it.meeting_title || "");
        return {
          fathom_id: String(it.recording_id || ""),
          title,
          recorded_at: (it.recording_start_time || it.scheduled_start_time || it.created_at) as string | null,
          duration_sec: durationSec(it.recording_start_time, it.recording_end_time),
          attendees: (it.calendar_invitees as unknown) ?? null,
          prospect_name: prospectFromTitle(title),
          transcript: flattenTranscript(it.transcript) || null,
          summary: typeof it.default_summary === "string" ? it.default_summary : null,
          raw: { ...it, transcript: undefined },
        };
      })
      .filter((r) => r.fathom_id);
    if (rows.length) {
      const { error } = await sb.from("fathom_calls").upsert(rows, { onConflict: "fathom_id" });
      if (error) return { stored, note: `upsert failed: ${error.message}` };
      stored += rows.length;
    }
    cursor = json.next_cursor || null;
    if (!cursor) break;
  }
  return { stored };
}

/* --------------------------- prompt construction -------------------------- */

interface Scripts { closerScript: string | null; guardrails: string | null }

async function loadScripts(sb: Sb): Promise<Scripts> {
  const { data } = await sb.from("mm_scripts").select("role,content");
  const find = (role: string) => data?.find((s) => s.role === role)?.content?.trim() || null;
  return { closerScript: find("closer"), guardrails: find("guardrails") };
}

interface PendingCall {
  fathom_id: string; title: string | null; recorded_at: string | null;
  duration_sec: number | null; prospect_name: string | null;
  attendees: unknown; transcript: string;
}

function buildCallMessage(call: PendingCall, scripts: Scripts): string {
  const guardrails = scripts.guardrails || DEFAULT_GUARDRAILS;
  const attendees = Array.isArray(call.attendees)
    ? (call.attendees as { name?: string; email?: string }[])
        .map((a) => a?.name || a?.email || "").filter(Boolean).join(", ")
    : "";
  const jsonFields = scripts.closerScript
    ? `{"grade": <0-100>, "closer": "<rep first name>", "prospect_name": "<prospect name>", "outcome": "won|lost|follow-up|no-show|unclear", "adherence_score": <0-100>, "adherence_notes": "<one sentence>"}`
    : `{"grade": <0-100>, "closer": "<rep first name>", "prospect_name": "<prospect name>", "outcome": "won|lost|follow-up|no-show|unclear"}`;
  return [
    "You are acting as our AI Sales Manager. Review the sales call transcript below and write the full coaching review.",
    "",
    SALES_MANAGER_PROMPT,
    "",
    "COMPANY COACHING BOUNDARIES (hard rules, these override anything above):",
    guardrails,
    "",
    scripts.closerScript
      ? `OUR CLOSER SCRIPT (lines wrapped in **double asterisks** are word-for-word; everything else is a flexible guide). Also grade how closely the rep followed it:\n${scripts.closerScript}`
      : "No closer script is on file, so skip script-adherence scoring.",
    "",
    "CALL DETAILS",
    `Title: ${call.title || "untitled"}`,
    `Recorded: ${call.recorded_at || "unknown"}`,
    `Duration: ${call.duration_sec ? Math.round(call.duration_sec / 60) + " min" : "unknown"}`,
    attendees ? `Attendees: ${attendees}` : "",
    "",
    "TRANSCRIPT",
    call.transcript.slice(0, TRANSCRIPT_CAP),
    "",
    "FINAL OUTPUT REQUIREMENT",
    "Write the full review in markdown following the OUTPUT FORMAT above. Then end your reply with exactly one fenced code block labeled json containing only:",
    "```json",
    jsonFields,
    "```",
  ].filter((l) => l !== null).join("\n");
}

/** Split Jeremy's reply into the markdown review and the trailing json fields. */
export function parseReviewReply(reply: string): {
  review_md: string;
  fields: Record<string, unknown>;
} {
  const matches = [...reply.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = matches[matches.length - 1];
  let fields: Record<string, unknown> = {};
  if (last) {
    try { fields = JSON.parse(last[1]); } catch { /* keep review, drop fields */ }
  }
  const review_md = (last ? reply.replace(last[0], "") : reply).trim();
  return { review_md, fields };
}

/* ------------------------------ run tracking ------------------------------ */

interface RunRow {
  id: number; kind: string; fathom_id: string | null; digest_date: string | null;
  run_id: string | null; conversation_id: string | null;
  status: string; attempts: number; created_at: string;
}

async function finalizeCallReview(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const { review_md, fields } = parseReviewReply(reply);
  if (!review_md || review_md.length < 200) throw new Error("reply too short to be a review");
  await mmSubmitCallReview(sb, {
    fathom_id: run.fathom_id,
    review_md,
    grade: fields.grade,
    closer: fields.closer,
    prospect_name: fields.prospect_name,
    outcome: fields.outcome,
    adherence_score: fields.adherence_score,
    adherence_notes: fields.adherence_notes,
    model: "jeremy",
  });
  // Ping Slack only for fresh calls — the 463-call backfill must not flood the channel.
  const { data: call } = await sb.from("fathom_calls")
    .select("recorded_at,title").eq("fathom_id", run.fathom_id).maybeSingle();
  const recMs = call?.recorded_at ? Date.parse(String(call.recorded_at)) : 0;
  if (recMs > Date.now() - 7 * 86400e3) {
    const g = typeof fields.grade === "number" ? `${fields.grade}/100` : "graded";
    await postAsCso(
      `New call review: ${fields.closer || "closer"} x ${fields.prospect_name || call?.title || "prospect"} — ${g} (${fields.outcome || "outcome unclear"}). Read it: ${APP_URL}/micromanager`
    ).catch(() => false);
  }
  return "review saved";
}

async function finalizeDigest(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const digestDate = run.digest_date || etDate();
  const { count } = await sb.from("mm_call_reviews")
    .select("fathom_id", { count: "exact", head: true }).eq("call_date", digestDate);
  const { error } = await sb.from("mm_daily_digests").upsert({
    digest_date: digestDate,
    digest_md: reply.trim(),
    model: "jeremy",
    review_count: count ?? null,
  }, { onConflict: "digest_date" });
  if (error) throw new Error(error.message);
  const head = reply.trim().slice(0, 3500);
  await postAsCso(
    `DAILY SALES DIGEST — ${digestDate}\n\n${head}${reply.length > 3500 ? `\n\n(Full digest: ${APP_URL}/micromanager)` : `\n\n${APP_URL}/micromanager`}`
  ).catch(() => false);
  return "digest saved";
}

async function markRun(sb: Sb, id: number, patch: Record<string, unknown>) {
  await sb.from("mm_review_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Check every running Jeremy turn; save what finished, fail what died. */
async function pollRuns(sb: Sb): Promise<string[]> {
  const notes: string[] = [];
  const { data: runs } = await sb.from("mm_review_runs")
    .select("*").eq("status", "running").order("created_at", { ascending: true }).limit(6);
  for (const run of (runs || []) as RunRow[]) {
    try {
      const res = await jeremyPoll({ runId: run.run_id, conversationId: run.conversation_id });
      if (res.status === "completed" && res.reply) {
        const what = run.kind === "digest"
          ? await finalizeDigest(sb, run, res.reply)
          : await finalizeCallReview(sb, run, res.reply);
        await markRun(sb, run.id, { status: "completed", last_error: null });
        notes.push(`${run.kind}:${run.fathom_id || run.digest_date}: ${what}`);
      } else if (res.status === "running") {
        if (Date.parse(run.created_at) < Date.now() - STALE_RUN_MS) {
          await markRun(sb, run.id, { status: "failed", last_error: "stale: no reply in 24h" });
          notes.push(`${run.kind}:${run.fathom_id || run.digest_date}: marked stale`);
        }
      } else {
        await markRun(sb, run.id, { status: "failed", last_error: `jeremy status ${res.status}: ${res.detail || ""}`.slice(0, 500) });
        notes.push(`${run.kind}:${run.fathom_id || run.digest_date}: failed (${res.status})`);
      }
    } catch (e) {
      // A poll/parse/save error fails this run only; the loop moves on.
      await markRun(sb, run.id, { status: "failed", last_error: String(e).slice(0, 500) });
      notes.push(`${run.kind}:${run.fathom_id || run.digest_date}: error ${String(e).slice(0, 120)}`);
    }
  }
  return notes;
}

/** Send the next unreviewed sales calls to Jeremy, up to the in-flight cap. */
async function dispatchCalls(sb: Sb): Promise<string[]> {
  const notes: string[] = [];
  const { count: inFlight } = await sb.from("mm_review_runs")
    .select("id", { count: "exact", head: true }).eq("status", "running");
  const capacity = MAX_IN_FLIGHT - (inFlight ?? 0);
  if (capacity <= 0) return ["at capacity"];

  const [{ data: reviewed }, { data: runRows }] = await Promise.all([
    sb.from("mm_call_reviews").select("fathom_id"),
    sb.from("mm_review_runs").select("fathom_id,status,attempts").eq("kind", "call"),
  ]);
  const done = new Set((reviewed || []).map((r) => String(r.fathom_id)));
  const blocked = new Set(
    (runRows || [])
      .filter((r) => r.status === "running" || r.status === "completed" ||
        (r.status === "failed" && (r.attempts ?? 0) >= MAX_ATTEMPTS))
      .map((r) => String(r.fathom_id))
  );
  const attemptsById: Record<string, number> = {};
  for (const r of runRows || []) attemptsById[String(r.fathom_id)] = r.attempts ?? 0;

  const { data: calls } = await sb.from("fathom_calls")
    .select("fathom_id,title,recorded_at,duration_sec,prospect_name,attendees,transcript")
    .not("transcript", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(300);

  const candidates = ((calls || []) as PendingCall[]).filter((c) => {
    if (done.has(c.fathom_id) || blocked.has(c.fathom_id)) return false;
    const t = String(c.title || "").toLowerCase();
    if (INTERNAL_TITLE_PATTERNS.some((p) => t.includes(p))) return false;
    if (typeof c.duration_sec === "number" && c.duration_sec < MIN_DURATION_SEC) return false;
    if (!c.transcript || c.transcript.length < 1500) return false; // too thin to coach on
    return true;
  });

  if (candidates.length === 0) return ["queue empty"];
  const scripts = await loadScripts(sb);

  for (const call of candidates.slice(0, capacity)) {
    try {
      const res = await jeremySend(buildCallMessage(call, scripts));
      const { error } = await sb.from("mm_review_runs").upsert({
        kind: "call",
        fathom_id: call.fathom_id,
        run_id: res.run_id || null,
        conversation_id: res.conversation_id || null,
        status: "running",
        attempts: (attemptsById[call.fathom_id] ?? 0) + 1,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "fathom_id" });
      if (error) throw new Error(error.message);
      notes.push(`dispatched ${call.fathom_id} (${String(call.title || "").slice(0, 40)})`);
    } catch (e) {
      notes.push(`dispatch failed ${call.fathom_id}: ${String(e).slice(0, 120)}`);
    }
  }
  return notes;
}

/** One 30-minute tick of Layer 1. Every step is isolated. */
export async function runCallReviewTick(sb: Sb) {
  const report: Record<string, unknown> = {};
  try { report.fathom_sync = await fathomPullSync(sb); }
  catch (e) { report.fathom_sync = `error: ${String(e).slice(0, 200)}`; }
  try { report.polled = await pollRuns(sb); }
  catch (e) { report.polled = `error: ${String(e).slice(0, 200)}`; }
  try { report.dispatched = await dispatchCalls(sb); }
  catch (e) { report.dispatched = `error: ${String(e).slice(0, 200)}`; }
  return report;
}

/* ------------------------------ Layer 2: digest ------------------------------ */

function buildDigestMessage(
  digestDate: string,
  todays: { closer: string | null; prospect_name: string | null; outcome: string | null; grade: number | null; review_md: string }[],
  history: { closer: string | null; grade: number | null; call_date: string | null }[],
  guardrails: string | null
): string {
  const byCloser: Record<string, number[]> = {};
  for (const h of history) {
    const name = (h.closer || "").trim();
    if (!name || typeof h.grade !== "number") continue;
    (byCloser[name] = byCloser[name] || []).push(h.grade);
  }
  const trendLines = Object.entries(byCloser).map(([name, grades]) =>
    `- ${name}: ${grades.length} reviewed calls, average grade ${Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)}/100`
  );
  const reviewBlocks = todays.map((r, i) =>
    `--- CALL ${i + 1}: ${r.closer || "unknown closer"} x ${r.prospect_name || "unknown prospect"} (${r.outcome || "outcome unclear"}, grade ${r.grade ?? "n/a"}) ---\n${r.review_md.slice(0, 5000)}`
  );
  return [
    `You are our head of sales. Below are the AI call reviews for ${digestDate} plus each closer's recent grade trend. Write the DAILY SALES DIGEST for the sales manager (Matt).`,
    "",
    "COMPANY COACHING BOUNDARIES (hard rules):",
    guardrails || DEFAULT_GUARDRAILS,
    "",
    "STRUCTURE YOUR DIGEST EXACTLY LIKE THIS (markdown):",
    "1. THE DAY IN ONE PARAGRAPH — calls, outcomes, the single biggest theme.",
    "2. PER CLOSER — for each closer who took calls today: current strengths (2-3 bullets), current weaknesses (2-3 bullets), and THE one drill to run this week. Tie every point to specific moments from today's calls.",
    "3. TOP 3 LOW-HANGING FRUIT — the three fixes across the whole team with the biggest revenue impact for the least effort, ranked. For each: what it is, which call showed it, the exact behavior change, and why it moves money.",
    "4. WATCH LIST — anything drifting in the 14-day trend that is not yet urgent.",
    "Keep it blunt, specific, and short enough to read in 3 minutes. No generic advice.",
    "",
    "14-DAY GRADE TREND:",
    ...(trendLines.length ? trendLines : ["- no reviewed calls in the last 14 days"]),
    "",
    `TODAY'S CALL REVIEWS (${todays.length}):`,
    ...reviewBlocks,
  ].join("\n");
}

/** Watchdog: the feed died silently for 15 days once. Never again. */
async function watchdog(sb: Sb): Promise<string[]> {
  const warnings: string[] = [];
  const { data: newest } = await sb.from("fathom_calls")
    .select("recorded_at").order("recorded_at", { ascending: false }).limit(1);
  const newestMs = newest?.[0]?.recorded_at ? Date.parse(String(newest[0].recorded_at)) : 0;
  const daysQuiet = newestMs ? Math.floor((Date.now() - newestMs) / 86400e3) : 999;
  if (daysQuiet >= 3) {
    warnings.push(`No new sales call has reached CCOS in ${daysQuiet} days. The Fathom feed is likely broken (or nobody is recording). Check Fathom team settings + the API key.`);
  }
  const { count: failed } = await sb.from("mm_review_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed").gte("updated_at", new Date(Date.now() - 86400e3).toISOString());
  if ((failed ?? 0) > 0) {
    warnings.push(`${failed} review run(s) failed in the last 24h. Check mm_review_runs.last_error.`);
  }
  if (warnings.length) {
    await postAsCso(`CALL REVIEW WATCHDOG\n${warnings.map((w) => `- ${w}`).join("\n")}`).catch(() => false);
  }
  return warnings;
}

/** The daily Layer 2 run: build + send the digest, then run the watchdog. */
export async function runDailyDigest(sb: Sb) {
  const report: Record<string, unknown> = {};
  const digestDate = etDate();
  try {
    const [{ data: todays }, { data: history }, scripts] = await Promise.all([
      sb.from("mm_call_reviews")
        .select("closer,prospect_name,outcome,grade,review_md")
        .eq("call_date", digestDate),
      sb.from("mm_call_reviews")
        .select("closer,grade,call_date")
        .gte("call_date", etDate(new Date(Date.now() - 14 * 86400e3))),
      loadScripts(sb),
    ]);
    if (!todays || todays.length === 0) {
      report.digest = "no reviews today, skipped";
    } else {
      const msg = buildDigestMessage(digestDate, todays, history || [], scripts.guardrails);
      const res = await jeremySend(msg);
      await sb.from("mm_review_runs").upsert({
        kind: "digest",
        digest_date: digestDate,
        run_id: res.run_id || null,
        conversation_id: res.conversation_id || null,
        status: "running",
        attempts: 1,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "digest_date" });
      // Give it one quick chance to finish inside this invocation; otherwise the
      // 30-minute tick collects it.
      let finished = false;
      for (let i = 0; i < 4 && !finished; i++) {
        await new Promise((r) => setTimeout(r, 20000));
        try {
          const poll = await jeremyPoll({ runId: res.run_id, conversationId: res.conversation_id });
          if (poll.status === "completed" && poll.reply) {
            const { data: run } = await sb.from("mm_review_runs")
              .select("*").eq("kind", "digest").eq("digest_date", digestDate).maybeSingle();
            if (run) {
              await finalizeDigest(sb, run as RunRow, poll.reply);
              await markRun(sb, (run as RunRow).id, { status: "completed" });
            }
            finished = true;
          } else if (poll.status !== "running") {
            break; // failed; the tick's poller will record it
          }
        } catch { /* transient poll error; the tick will retry */ }
      }
      report.digest = finished ? "digest completed inline" : `digest running (reviews: ${todays.length}); the 30-min tick will collect it`;
    }
  } catch (e) {
    report.digest = `error: ${String(e).slice(0, 300)}`;
  }
  try { report.watchdog = await watchdog(sb); }
  catch (e) { report.watchdog = `error: ${String(e).slice(0, 200)}`; }
  return report;
}
