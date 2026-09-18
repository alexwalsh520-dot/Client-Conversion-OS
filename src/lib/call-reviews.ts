// Call Review Autopilot — the engine behind /api/cron/call-reviews,
// /api/cron/call-reviews-digest and /api/cron/call-reviews-weekly.
//
// Layer 1 (every 30 min): pull fresh calls from EVERY Fathom key we hold (one
// per closer — a Fathom key only sees its own user's recordings), collect
// finished reviews from Jeremy, dispatch new sales calls with full context
// (tracker row, setter DM thread, closer grade history).
// Layer 2 (nightly): DAILY SALES BRIEF for Matt + DAILY MARKETING BRIEF for
// Alex, both written by Jeremy from the day's structured reviews, plus the
// dead-feed / dead-key / not-recording watchdog.
// Layer 3 (Monday): WEEKLY PATTERN REPORT.
//
// Hard rules learned from the content-pipeline outage: every external call has
// its own timeout and its own try/catch; one bad call can never block the
// queue; the tick reports what it did instead of failing silently.
//
// v2 (2026-09-19): multi-key Fathom sync, closer attribution from the key that
// fetched the call, tracker + DM + history context, Jeremy's structured JSON
// footer (mm_call_reviews.fields), per-call Slack post, marketer digest,
// weekly report. Design notes: docs/call-review-autopilot.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SALES_MANAGER_PROMPT, mmSubmitCallReview } from "@/lib/micromanager";
import { jeremySend, jeremyPoll } from "@/lib/jeremy";
import { postAsCso } from "@/lib/slack";
import { markRun, runLabel, runReport, sendAndMaybeCollect, upsertRun, type RunRow } from "@/lib/call-review-runs";
import { finalizeSetterRun } from "@/lib/dm-reviews";
import { deliverReport } from "@/lib/report-delivery";
import { getRoster } from "@/lib/fathom-team-calls";
import {
  addDays, callTypeFromTitle, closerCodeFromName, closerDisplayName, etDate, etDateFromIso,
  fathomKeys, findTrackerRow, loadCloserHistory, loadDmThread, loadTrackerRows, outcomeFromTracker,
  trackerDayStats, type CloserHistory, type DmThread, type FathomKey, type TrackerRow,
} from "@/lib/call-review-context";
import {
  APP_URL, CALL_FIELDS_SPEC, DIGEST_BODY_TEMPLATE, MARKETING_TEMPLATE, REVIEW_FLAG_RULES, WEEKLY_TEMPLATE,
  clip, money, pct, renderCallPost, renderDigestHeader,
} from "@/lib/call-review-format";

type Sb = SupabaseClient;

const MAX_IN_FLIGHT = 2; // concurrent Jeremy call reviews (digests ride on top)
const MAX_ATTEMPTS = 3;
const STALE_RUN_MS = 24 * 3600e3;
const MIN_DURATION_SEC = 8 * 60; // shorter than this = no-show / scheduling call
const TRANSCRIPT_CAP = 60000;
const SYNC_WINDOW_DAYS = 7;
const FRESH_CALL_MS = 7 * 86400e3; // only calls this recent ping Slack (backfills stay quiet)

// Internal-meeting title patterns (shared with the Sales Hub and Deal Analysis).
// "onboarding" is only an exclusion for calls NOT recorded by a closer: Tyson's
// "Onboarding Call" is the $50-app upsell call and IS a sales call when a
// closer runs it; Nicole's client-onboarding calls are not.
const INTERNAL_TITLE_PATTERNS = [
  "sales team huddle", "c suite", "management", "setter connect", "team connect", "closer huddle",
  "training", "interview", "1:1", "huddle", "fathom demo",
];
const NON_CLOSER_EXTRA_PATTERNS = ["onboarding"];
// A call from a non-closer account (Matthew's shared key) only counts when the
// title is unmistakably a booked sales call. Everything else Matthew records is
// a 1:1, a setter interview or a client call.
const SALES_TITLE_RE = /strategy session|onboarding call|\((ts|ar)\)/i;
// Team domains: a call where every attendee is on one of these is internal.
const TEAM_DOMAINS = ["@clientconversion.io", "@thefitnessprotocol.com"];

// Our creator clients: a call with them is coaching, not a prospect sales call.
// Entries are exact emails or @domains; extend via CALL_REVIEW_CLIENT_EMAILS
// (comma-separated) without a deploy.
const CLIENT_IDENTITIES = [
  "recruitreadyfitness@gmail.com", // Jake Divljak
  "@recruitreadyfitness.com", // Jake's company
  "@start2finishcoaching.com", // Tyson's company (Will the closer is on the roster separately)
  "tysonnek29@gmail.com", // Tyson's personal address on calendar invites
  "keithholland35@gmail.com", // Keith
  "lucyeliza8@gmail.com", // Lucy
  "antwanrarcusfit@gmail.com", // Antwan
  "zoandemfit@gmail.com", // Zoe & Emily
  "averyjfisk@gmail.com", // Avery
  "naomidem122@gmail.com", // Naomi
  "@sendblue.com", // vendor
  "@fathom.video", // Fathom's own demo call on every new account
];
function isClientIdentity(email: string): boolean {
  const extra = (process.env.CALL_REVIEW_CLIENT_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return [...CLIENT_IDENTITIES, ...extra].some((c) =>
    c.startsWith("@") ? email.endsWith(c) : email === c
  );
}

// Used when no guardrails row is saved in mm_scripts (role = "guardrails").
export const DEFAULT_GUARDRAILS = `You are coaching a rep inside an established company. The offer, the prices, the booking process, and the overall script structure are fixed and are not yours to change. Never advise the rep to change the offer, discount, restructure pricing, rewrite the script, skip the company's process, or move the sale to another channel. All coaching must be about running the existing play better: discovery depth, tonality, objection handling, pacing, closing within the current script and offer. If the call's problems genuinely come from something outside the rep's control, say so in one line at the end under "Flag for management" instead of coaching around it.`;

// Matt's rule: closers own every outcome. Lead quality, setter mistakes and ad
// mismatch are real, but they are the MANAGER's information, never the rep's excuse.
const CLOSER_FACING_RULE = `CLOSER-FACING RULE (hard): sections 1-12 are read by the rep. Never blame lead quality, the setter, the ads or the offer there — frame everything as what the closer could have done to close THIS person. Anything upstream of the closer (lead quality, setter misrepresentation, expectation gaps, ad-to-call mismatch, process breaks) goes ONLY into the JSON fields systemic_flags, setter_handoff and ad_to_call_mismatch, which the manager reads.`;

/* ------------------------------ Fathom sync ------------------------------ */

export interface FathomItem {
  recording_id?: number | string;
  title?: string; meeting_title?: string;
  created_at?: string; recording_start_time?: string; recording_end_time?: string; scheduled_start_time?: string;
  calendar_invitees?: { name?: string; email?: string; is_external?: boolean }[];
  recorded_by?: { name?: string; email?: string };
  share_url?: string; url?: string;
  transcript?: unknown;
  default_summary?: unknown;
  [k: string]: unknown;
}

// Fathom transcript = [{speaker:{display_name}, text, timestamp}]. Flatten to readable text.
export function flattenTranscript(t: unknown): string {
  if (!Array.isArray(t)) return "";
  const out: string[] = [];
  for (const seg of t) {
    if (typeof seg === "string") { out.push(seg); continue; }
    const s = seg as { speaker?: { display_name?: string }; text?: string; timestamp?: string };
    if (!s.text) continue;
    const ts = s.timestamp ? `[${String(s.timestamp).slice(0, 8)}] ` : "";
    out.push(`${ts}${s.speaker?.display_name ? s.speaker.display_name + ": " : ""}${s.text}`);
  }
  return out.join("\n").slice(0, 90000);
}

function prospectFromTitle(title: string): string | null {
  // "Strategy Session - Irbin Benitez <> Will (TS)" -> "Irbin Benitez"
  const m = title.split(/<>|—|-\s/)[1] || title.split("-")[1];
  const cleaned = (m || "").replace(/\(.*?\)/g, "").trim();
  return cleaned || null;
}

function prospectFromItem(it: FathomItem): string | null {
  const recorder = String(it.recorded_by?.email || "").toLowerCase();
  const roster = getRoster();
  const ext = (it.calendar_invitees || []).find((a) => {
    const e = String(a?.email || "").toLowerCase();
    if (!e || e === recorder || roster.has(e)) return false;
    if (TEAM_DOMAINS.some((d) => e.endsWith(d))) return false;
    if (isClientIdentity(e)) return false;
    return true;
  });
  const name = ext?.name && !ext.name.includes("@") ? ext.name.trim() : null;
  return name || prospectFromTitle(String(it.title || it.meeting_title || ""));
}

function durationSec(start: unknown, end: unknown): number | null {
  const a = typeof start === "string" ? Date.parse(start) : NaN;
  const b = typeof end === "string" ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 1000);
}

async function fathomList(
  key: string,
  params: Record<string, string>,
  timeoutMs = 40000
): Promise<{ items: FathomItem[]; next_cursor: string | null; status: number }> {
  const u = new URL("https://api.fathom.ai/external/v1/meetings");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), { headers: { "X-Api-Key": key }, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return { items: [], next_cursor: null, status: res.status };
    const json = (await res.json()) as { items?: FathomItem[]; next_cursor?: string | null };
    return { items: json.items || [], next_cursor: json.next_cursor || null, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export function rowFromFathomItem(it: FathomItem, k: FathomKey) {
  const title = String(it.title || it.meeting_title || "");
  const summary = it.default_summary;
  return {
    fathom_id: String(it.recording_id || ""),
    title,
    recorded_at: (it.recording_start_time || it.scheduled_start_time || it.created_at || null) as string | null,
    duration_sec: durationSec(it.recording_start_time, it.recording_end_time),
    attendees: (it.calendar_invitees as unknown) ?? null,
    prospect_name: prospectFromItem(it),
    transcript: flattenTranscript(it.transcript) || null,
    summary: typeof summary === "string"
      ? summary
      : (summary && typeof summary === "object" && typeof (summary as { markdown_formatted?: unknown }).markdown_formatted === "string")
        ? (summary as { markdown_formatted: string }).markdown_formatted
        : null,
    raw: {
      ...it,
      transcript: undefined,
      ccos_closer: k.closerCode,
      ccos_key_label: k.label,
      ccos_synced_at: new Date().toISOString(),
    },
  };
}

/**
 * Pull recent meetings from every Fathom key. Two-phase per key so the 30-min
 * tick stays cheap: an index list without transcripts, then transcripts only
 * for recordings we do not have yet (or have without a transcript — Fathom
 * sometimes lists a meeting before its transcript is ready).
 * Closer keys run first so a call visible from both a closer key and the
 * shared TEAM key keeps its closer attribution.
 */
export async function fathomPullSync(sb: Sb): Promise<Record<string, unknown>> {
  const keys = fathomKeys();
  if (keys.length === 0) return { note: "no FATHOM_API_KEY* set" };
  const report: Record<string, unknown> = {};
  const since = new Date(Date.now() - SYNC_WINDOW_DAYS * 86400e3).toISOString();

  for (const k of keys) {
    try {
      // Phase 1: index.
      const index: FathomItem[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        const params: Record<string, string> = { created_after: since, limit: "50" };
        if (cursor) params.cursor = cursor;
        const res = await fathomList(k.key, params, 25000);
        if (res.status !== 200) { report[k.label] = `http ${res.status}`; break; }
        index.push(...res.items);
        cursor = res.next_cursor;
        if (!cursor) break;
      }
      if (typeof report[k.label] === "string") continue;
      const ids = index.map((it) => String(it.recording_id || "")).filter(Boolean);
      if (ids.length === 0) { report[k.label] = { indexed: 0, stored: 0 }; continue; }

      const { data: have } = await sb.from("fathom_calls")
        .select("fathom_id").in("fathom_id", ids).not("transcript", "is", null);
      const haveSet = new Set((have || []).map((r) => String(r.fathom_id)));
      const need = index.filter((it) => {
        const id = String(it.recording_id || "");
        if (!id || haveSet.has(id)) return false;
        const t = String(it.title || it.meeting_title || "").toLowerCase();
        return !t.includes("fathom demo");
      });
      if (need.length === 0) { report[k.label] = { indexed: ids.length, stored: 0 }; continue; }

      // Phase 2: transcripts for the missing ones only, walking newest-first
      // from just before the oldest missing meeting.
      const needIds = new Set(need.map((it) => String(it.recording_id)));
      const oldest = need.reduce((m, it) => Math.min(m, Date.parse(String(it.created_at || "")) || m), Date.now());
      const rows: ReturnType<typeof rowFromFathomItem>[] = [];
      cursor = null;
      for (let page = 0; page < 6 && needIds.size > 0; page++) {
        const params: Record<string, string> = {
          created_after: new Date(oldest - 1000).toISOString(), include_transcript: "true", limit: "10",
        };
        if (cursor) params.cursor = cursor;
        const res = await fathomList(k.key, params, 45000);
        if (res.status !== 200) { report[k.label] = `http ${res.status} on transcript fetch`; break; }
        for (const it of res.items) {
          const id = String(it.recording_id || "");
          if (!needIds.has(id)) continue;
          rows.push(rowFromFathomItem(it, k));
          needIds.delete(id);
        }
        cursor = res.next_cursor;
        if (!cursor) break;
      }
      if (rows.length) {
        const { error } = await sb.from("fathom_calls").upsert(rows, { onConflict: "fathom_id" });
        if (error) { report[k.label] = `upsert failed: ${error.message}`; continue; }
      }
      report[k.label] = { indexed: ids.length, stored: rows.length, missing: needIds.size };
    } catch (e) {
      report[k.label] = `error: ${String(e).slice(0, 160)}`;
    }
  }
  return report;
}

/* --------------------------- classification -------------------------------- */

export interface CallLike {
  title?: string | null;
  duration_sec?: number | null;
  attendees?: unknown;
  transcript?: string | null;
  closer_key?: string | null; // raw.ccos_closer — which closer's Fathom key fetched it
  recorded_by_email?: string | null;
}

/** The one shared answer to "is this a prospect sales call worth reviewing?"
 *  Used by the review dispatcher and the Deal Analysis page so the two can
 *  never drift. Internal 1:1s, creator-client coaching calls, Fathom's demo
 *  call, too-short/too-thin calls, and anything a non-closer recorded that is
 *  not titled as a booked sales call are all out. */
export function looksLikeSalesCall(c: CallLike): boolean {
  const t = String(c.title || "").toLowerCase();
  const closerRecorded = !!c.closer_key;
  const patterns = closerRecorded ? INTERNAL_TITLE_PATTERNS : [...INTERNAL_TITLE_PATTERNS, ...NON_CLOSER_EXTRA_PATTERNS];
  if (patterns.some((p) => t.includes(p))) return false;
  if (!closerRecorded && !SALES_TITLE_RE.test(t)) return false;
  if (typeof c.duration_sec === "number" && c.duration_sec < MIN_DURATION_SEC) return false;
  if (!c.transcript || c.transcript.length < 1500) return false; // too thin to coach on
  const roster = getRoster();
  const emails = Array.isArray(c.attendees)
    ? (c.attendees as { email?: string }[])
        .map((a) => String(a?.email || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (emails.some((e) => e.endsWith("@fathom.video"))) return false;
  const externals = emails.filter((e) => !roster.has(e) && !TEAM_DOMAINS.some((d) => e.endsWith(d)));
  if (emails.length > 0 && externals.length === 0) return false; // internal call
  // Creator-client coaching calls: every non-team attendee is a known client.
  if (externals.length > 0 && externals.every(isClientIdentity)) return false;
  return true;
}

function rawCloserKey(raw: unknown): string | null {
  const r = raw as { ccos_closer?: string | null } | null;
  return r?.ccos_closer ? String(r.ccos_closer).toUpperCase() : null;
}
function rawRecorder(raw: unknown): { name: string | null; email: string | null } {
  const r = raw as { recorded_by?: { name?: string; email?: string } } | null;
  return { name: r?.recorded_by?.name || null, email: r?.recorded_by?.email || null };
}
function rawShareUrl(raw: unknown): string | null {
  const r = raw as { share_url?: string; url?: string } | null;
  return r?.share_url || r?.url || null;
}

/* --------------------------- prompt construction -------------------------- */

interface Scripts { closerScript: string | null; guardrails: string | null }

export async function loadScripts(sb: Sb): Promise<Scripts> {
  const { data } = await sb.from("mm_scripts").select("role,content");
  const find = (role: string) => data?.find((s) => s.role === role)?.content?.trim() || null;
  return { closerScript: find("closer"), guardrails: find("guardrails") };
}

export interface PendingCall {
  fathom_id: string; title: string | null; recorded_at: string | null;
  duration_sec: number | null; prospect_name: string | null;
  attendees: unknown; transcript: string; raw: unknown;
}

export interface CallContext {
  closerCode: string | null;
  closerDisplay: string | null;
  callType: string;
  callDateEt: string | null;
  prospect: string | null;
  tracker: TrackerRow | null;
  dm: DmThread | null;
  history: CloserHistory;
  shareUrl: string | null;
}

/** Everything we know about a call besides the transcript. Each lookup is
 *  isolated: a dead join never blocks the review. */
export async function buildCallContext(sb: Sb, call: PendingCall): Promise<CallContext> {
  const recorder = rawRecorder(call.raw);
  const closerCode = rawCloserKey(call.raw) || closerCodeFromName(recorder.name) || closerCodeFromName(recorder.email);
  const closerDisplay = closerDisplayName(closerCode);
  const callDateEt = etDateFromIso(call.recorded_at);
  const prospect = call.prospect_name || prospectFromTitle(String(call.title || ""));
  let tracker: TrackerRow | null = null;
  try { tracker = await findTrackerRow(sb, { prospect, callDateEt, closerCode }); } catch { /* keep null */ }
  let dm: DmThread | null = null;
  try {
    dm = await loadDmThread(sb, {
      manychatSubscriberId: tracker?.manychat_subscriber_id || null,
      prospect,
      before: call.recorded_at ? new Date(Date.parse(call.recorded_at) + 3600e3).toISOString() : null,
    });
  } catch { /* keep null */ }
  let history: CloserHistory = { count: 0, avg: null, last5: [], trend: "insufficient", flags: [] };
  try { history = await loadCloserHistory(sb, closerDisplay); } catch { /* keep empty */ }
  return {
    closerCode, closerDisplay, callType: callTypeFromTitle(call.title), callDateEt, prospect,
    tracker, dm, history, shareUrl: rawShareUrl(call.raw),
  };
}

function trackerBlock(t: TrackerRow | null): string {
  if (!t) return "SALES TRACKER ROW: none matched. Infer outcome from the transcript; if cash is discussed, note it as unconfirmed.";
  return [
    "SALES TRACKER ROW (source of truth for outcome, cash and setter):",
    `Outcome: ${t.outcome || "not entered yet"} | Call taken: ${t.call_taken_status || "?"}`,
    `Cash collected: ${money(t.collected_revenue_cents)} | Contracted: ${money(t.contracted_revenue_cents)} | Program: ${t.program_length || "?"} weeks | Payment: ${t.payment_method || "?"}`,
    `Closer's objection tag: ${t.objection || "none"} | Setter: ${t.setter || "?"} | Offer: ${t.offer || "?"}`,
    t.call_notes ? `Closer's notes: ${clip(t.call_notes, 400)}` : "",
  ].filter(Boolean).join("\n");
}

function historyBlock(h: CloserHistory): string {
  if (h.count === 0) return "CLOSER 14-DAY HISTORY: no reviewed calls yet.";
  return [
    `CLOSER 14-DAY HISTORY: ${h.count} reviewed calls, average grade ${h.avg}/100, trend ${h.trend}.`,
    `Last grades (oldest→newest): ${h.last5.join(", ")}`,
    h.flags.length ? `Prior review flags: ${h.flags.map((f) => clip(f, 120)).join(" | ")}` : "",
  ].filter(Boolean).join("\n");
}

export function buildCallMessage(call: PendingCall, ctx: CallContext, scripts: Scripts): string {
  const guardrails = scripts.guardrails || DEFAULT_GUARDRAILS;
  const attendees = Array.isArray(call.attendees)
    ? (call.attendees as { name?: string; email?: string }[])
        .map((a) => a?.name || a?.email || "").filter(Boolean).join(", ")
    : "";
  return [
    "You are acting as our AI Sales Manager (Jeremy). Review the sales call below and write the full coaching review, then the JSON footer.",
    "",
    SALES_MANAGER_PROMPT,
    "",
    "COMPANY COACHING BOUNDARIES (hard rules, these override anything above):",
    guardrails,
    "",
    CLOSER_FACING_RULE,
    "",
    scripts.closerScript
      ? `OUR CLOSER SCRIPT (lines wrapped in **double asterisks** are word-for-word; everything else is a flexible guide). Also grade how closely the rep followed it:\n${scripts.closerScript}`
      : "No closer script is on file, so skip script-adherence scoring (omit adherence_score).",
    "",
    "CALL DETAILS",
    `Closer: ${ctx.closerDisplay || "unknown"}${ctx.closerCode ? ` (tracker code ${ctx.closerCode})` : ""}`,
    `Prospect: ${ctx.prospect || "unknown"}`,
    `Call type: ${ctx.callType} (Strategy Session = first call from Instagram DMs; Onboarding Call = second call after the $50 app purchase where the 1-on-1 upsell happens)`,
    `Title: ${call.title || "untitled"}`,
    `Recorded: ${call.recorded_at || "unknown"} (ET date ${ctx.callDateEt || "?"})`,
    `Duration: ${call.duration_sec ? Math.round(call.duration_sec / 60) + " min" : "unknown"}`,
    attendees ? `Attendees: ${attendees}` : "",
    "",
    trackerBlock(ctx.tracker),
    "",
    historyBlock(ctx.history),
    "",
    ctx.dm
      ? `SETTER DM TRANSCRIPT (Instagram, before the call; ${ctx.dm.messageCount} messages, most recent last). Use it for the setter_handoff fields and to check whether the closer used the prospect's DM-stated motivation:\n${ctx.dm.text}`
      : "SETTER DM TRANSCRIPT: unavailable for this prospect. Set setter_handoff.expectation_gap=false and its notes to null.",
    "",
    "TRANSCRIPT",
    call.transcript.slice(0, TRANSCRIPT_CAP),
    "",
    "FINAL OUTPUT REQUIREMENT",
    "Write the full review in markdown following the OUTPUT FORMAT above (12 numbered sections). Then end your reply with exactly one fenced code block labeled json containing only this object (no comments, valid JSON):",
    "```json",
    CALL_FIELDS_SPEC,
    "```",
    REVIEW_FLAG_RULES,
    "Verbatim quotes must be the prospect's exact words from the transcript. If the tracker row gives an outcome, use it.",
    "Recordings often start before the prospect joins (the rep may still be on a team call): ignore any internal team talk before the prospect appears, and treat speaker labels in that stretch as unreliable.",
  ].join("\n");
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
    try {
      const parsed = JSON.parse(last[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed;
    } catch { /* keep review, drop fields */ }
  }
  const review_md = (last ? reply.replace(last[0], "") : reply).trim();
  return { review_md, fields };
}

/* ------------------------------ run tracking ------------------------------ */

/** Store a report. mm_reports is created by migration 20260919120000; until it
 *  is pasted, the Slack post is still the deliverable, so failures are soft. */
async function saveReport(sb: Sb, kind: string, periodKey: string, md: string, fields?: unknown): Promise<string | null> {
  const { error } = await sb.from("mm_reports").upsert({
    kind, period_key: periodKey, report_md: md, fields: fields ?? null, model: "jeremy",
    created_at: new Date().toISOString(),
  }, { onConflict: "kind,period_key" });
  return error ? error.message : null;
}

async function finalizeCallReview(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const { review_md, fields } = parseReviewReply(reply);
  if (!review_md || review_md.length < 200) throw new Error("reply too short to be a review");
  const { data: call } = await sb.from("fathom_calls")
    .select("fathom_id,title,recorded_at,duration_sec,prospect_name,attendees,transcript,raw")
    .eq("fathom_id", run.fathom_id).maybeSingle();
  if (!call) throw new Error(`no fathom_calls row for ${run.fathom_id}`);
  const ctx = await buildCallContext(sb, { ...(call as PendingCall), transcript: String(call.transcript || "") });

  // Closer: the key that fetched the call beats the model's guess.
  const closer = ctx.closerDisplay || (typeof fields.closer === "string" ? fields.closer : null);
  // Outcome: the tracker beats the model once the sheet is filled in.
  const outcome = outcomeFromTracker(ctx.tracker?.outcome) || (typeof fields.outcome === "string" ? fields.outcome : null);
  const grade = typeof fields.grade === "number" ? fields.grade : null;
  const prospect = (typeof fields.prospect_name === "string" && fields.prospect_name) || ctx.prospect;

  const merged: Record<string, unknown> = {
    ...fields,
    call_id: run.fathom_id,
    closer,
    closer_code: ctx.closerCode,
    prospect_name: prospect,
    call_type: ctx.callType,
    call_date: ctx.callDateEt,
    call_duration_minutes: call.duration_sec ? Math.round(Number(call.duration_sec) / 60) : null,
    outcome,
    setter: ctx.tracker?.setter || null,
    cash_collected: ctx.tracker ? Math.round((Number(ctx.tracker.collected_revenue_cents) || 0) / 100) : null,
    program_length: ctx.tracker?.program_length || null,
    payment_method: ctx.tracker?.payment_method || null,
    objection_tag_tracker: ctx.tracker?.objection || null,
    tracker_matched: !!ctx.tracker,
    dm_available: !!ctx.dm,
    dm_message_count: ctx.dm?.messageCount ?? 0,
    closer_14day_avg_grade: ctx.history.avg,
    grade_trend: ctx.history.trend,
    recent_grades: ctx.history.last5,
    fathom_share_url: ctx.shareUrl,
  };

  await mmSubmitCallReview(sb, {
    fathom_id: run.fathom_id,
    review_md,
    grade,
    closer,
    prospect_name: prospect,
    outcome,
    adherence_score: fields.adherence_score,
    adherence_notes: fields.adherence_notes,
    model: "jeremy",
  });
  // `fields` column arrives with migration 20260919120000; tolerate its absence.
  const { error: fieldsErr } = await sb.from("mm_call_reviews").update({ fields: merged }).eq("fathom_id", run.fathom_id);

  const recMs = call.recorded_at ? Date.parse(String(call.recorded_at)) : 0;
  let posted = false;
  if (recMs > Date.now() - FRESH_CALL_MS) {
    posted = await postAsCso(renderCallPost({
      fathomId: String(run.fathom_id),
      closer, prospect, callType: ctx.callType, outcome,
      cashCents: ctx.tracker ? Number(ctx.tracker.collected_revenue_cents) || 0 : null,
      grade, trend: ctx.history.trend, avg14: ctx.history.avg, history: ctx.history.count,
      fields: merged, dmAvailable: !!ctx.dm, trackerMatched: !!ctx.tracker,
    })).catch(() => false);
  }
  return `review saved${fieldsErr ? " (fields column missing — paste migration)" : ""}${posted ? ", posted" : ""}`;
}

async function finalizeDigest(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const digestDate = run.digest_date || etDate();
  const header = await digestHeaderFor(sb, digestDate);
  const md = `${header}\n\n${reply.trim()}`;
  const { count } = await sb.from("mm_call_reviews")
    .select("fathom_id", { count: "exact", head: true }).eq("call_date", digestDate);
  const { error } = await sb.from("mm_daily_digests").upsert({
    digest_date: digestDate, digest_md: md, model: "jeremy", review_count: count ?? null,
  }, { onConflict: "digest_date" });
  if (error) throw new Error(error.message);
  const how = await deliverReport({
    title: `Daily Sales Brief — ${digestDate}`, filename: `daily-sales-brief-${digestDate}.pdf`,
    summary: `${header}\nFull reviews: ${APP_URL}/micromanager`, body: md,
  });
  return `digest saved, delivered as ${how}`;
}

async function finalizeMarketing(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const date = String(run.fathom_id || "").replace(/^marketing:/, "") || etDate();
  const md = reply.trim();
  const err = await saveReport(sb, "marketing", date, md);
  const how = await deliverReport({
    title: `Daily Marketing Brief — ${date}`, filename: `daily-marketing-brief-${date}.pdf`,
    summary: md.split("\n").slice(0, 2).join("\n"), body: md,
  });
  return `marketing brief delivered as ${how}${err ? ` (not stored: ${clip(err, 80)})` : ""}`;
}

async function finalizeWeekly(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const week = String(run.fathom_id || "").replace(/^weekly:/, "");
  const md = reply.trim();
  const err = await saveReport(sb, "weekly", week, md);
  const how = await deliverReport({
    title: `Weekly Pattern Report — week of ${week}`, filename: `weekly-pattern-report-${week}.pdf`,
    summary: `${md.split("\n").slice(0, 4).join("\n")}\nDeal Analysis: ${APP_URL}/micromanager`, body: md,
  });
  return `weekly report delivered as ${how}${err ? ` (not stored: ${clip(err, 80)})` : ""}`;
}

async function finalizeRun(sb: Sb, run: RunRow, reply: string): Promise<string> {
  switch (runReport(run)) {
    case "digest": return finalizeDigest(sb, run, reply);
    case "marketing": return finalizeMarketing(sb, run, reply);
    case "weekly": return finalizeWeekly(sb, run, reply);
    case "setter": return finalizeSetterRun(sb, run, reply);
    default: return finalizeCallReview(sb, run, reply);
  }
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
        const what = await finalizeRun(sb, run, res.reply);
        await markRun(sb, run.id, { status: "completed", last_error: null });
        notes.push(`${runLabel(run)}: ${what}`);
      } else if (res.status === "running") {
        if (Date.parse(run.created_at) < Date.now() - STALE_RUN_MS) {
          await markRun(sb, run.id, { status: "failed", last_error: "stale: no reply in 24h" });
          notes.push(`${runLabel(run)}: marked stale`);
        }
      } else {
        await markRun(sb, run.id, { status: "failed", last_error: `jeremy status ${res.status}: ${res.detail || ""}`.slice(0, 500) });
        notes.push(`${runLabel(run)}: failed (${res.status})`);
      }
    } catch (e) {
      // A poll/parse/save error fails this run only; the loop moves on.
      await markRun(sb, run.id, { status: "failed", last_error: String(e).slice(0, 500) });
      notes.push(`${runLabel(run)}: error ${String(e).slice(0, 120)}`);
    }
  }
  return notes;
}

const CALL_COLS = "fathom_id,title,recorded_at,duration_sec,prospect_name,attendees,transcript,raw";

function asCallLike(c: PendingCall): CallLike {
  return { ...c, closer_key: rawCloserKey(c.raw), recorded_by_email: rawRecorder(c.raw).email };
}

/** Send the next unreviewed sales calls to Jeremy, up to the in-flight cap. */
async function dispatchCalls(sb: Sb): Promise<string[]> {
  const notes: string[] = [];
  const { count: inFlight } = await sb.from("mm_review_runs")
    .select("id", { count: "exact", head: true }).eq("status", "running").eq("kind", "call");
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
    .select(CALL_COLS)
    .not("transcript", "is", null)
    .gte("recorded_at", new Date(Date.now() - 30 * 86400e3).toISOString())
    .order("recorded_at", { ascending: false })
    .limit(300);

  const candidates = ((calls || []) as PendingCall[]).filter(
    (c) => !done.has(c.fathom_id) && !blocked.has(c.fathom_id) && looksLikeSalesCall(asCallLike(c))
  );

  if (candidates.length === 0) return ["queue empty"];
  const scripts = await loadScripts(sb);

  for (const call of candidates.slice(0, capacity)) {
    try {
      const ctx = await buildCallContext(sb, call);
      const res = await jeremySend(buildCallMessage(call, ctx, scripts));
      await upsertRun(sb, {
        kind: "call",
        fathom_id: call.fathom_id,
        run_id: res.run_id || null,
        conversation_id: res.conversation_id || null,
        attempts: (attemptsById[call.fathom_id] ?? 0) + 1,
      }, "fathom_id");
      notes.push(`dispatched ${call.fathom_id} (${ctx.closerDisplay || "?"} x ${ctx.prospect || "?"}; tracker ${ctx.tracker ? "yes" : "no"}, dm ${ctx.dm ? ctx.dm.messageCount : 0})`);
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

/** Debug hook (?dry=1&fathomId=…): the exact prompt one call would get, no send. */
export async function previewCallPrompt(sb: Sb, fathomId: string) {
  const { data: call } = await sb.from("fathom_calls").select(CALL_COLS).eq("fathom_id", fathomId).maybeSingle();
  if (!call) throw new Error(`no fathom_calls row for ${fathomId}`);
  const pending = { ...(call as PendingCall), transcript: String(call.transcript || "") };
  const ctx = await buildCallContext(sb, pending);
  const scripts = await loadScripts(sb);
  return {
    sales_call: looksLikeSalesCall(asCallLike(pending)),
    context: { ...ctx, dm: ctx.dm ? { ...ctx.dm, text: clip(ctx.dm.text, 600) } : null },
    prompt: buildCallMessage(pending, ctx, scripts),
  };
}

/* --------------------------- Layer 2: nightly digests ----------------------- */

interface ReviewRow {
  fathom_id: string; closer: string | null; prospect_name: string | null; outcome: string | null;
  grade: number | null; call_date: string | null; review_md: string; fields: Record<string, unknown> | null;
}

async function loadReviews(sb: Sb, from: string, to: string): Promise<ReviewRow[]> {
  const { data, error } = await sb.from("mm_call_reviews")
    .select("fathom_id,closer,prospect_name,outcome,grade,call_date,review_md,fields")
    .gte("call_date", from).lte("call_date", to)
    .order("call_date", { ascending: true }).order("created_at", { ascending: true });
  if (error && /fields/.test(error.message)) {
    // Migration not pasted yet: same query without the column.
    const { data: d2 } = await sb.from("mm_call_reviews")
      .select("fathom_id,closer,prospect_name,outcome,grade,call_date,review_md")
      .gte("call_date", from).lte("call_date", to)
      .order("call_date", { ascending: true });
    return ((d2 || []) as Omit<ReviewRow, "fields">[]).map((r) => ({ ...r, fields: null }));
  }
  return (data || []) as ReviewRow[];
}

async function digestHeaderFor(sb: Sb, date: string): Promise<string> {
  let rows: TrackerRow[] = [];
  try { rows = await loadTrackerRows(sb, date, date); } catch { /* header degrades to zeros */ }
  const s = trackerDayStats(rows);
  const { count } = await sb.from("mm_call_reviews").select("fathom_id", { count: "exact", head: true }).eq("call_date", date);
  return renderDigestHeader({
    date, booked: s.booked, taken: s.taken, closed: s.closed, cashCents: s.cashCents,
    closeRate: s.closeRate, showRate: s.showRate, reviewed: count ?? 0,
  });
}

function reviewLink(r: ReviewRow): string {
  const url = typeof r.fields?.fathom_share_url === "string" ? r.fields.fathom_share_url : null;
  return url ? `Fathom: ${url}` : `Deal Analysis: ${APP_URL}/micromanager?deal=${r.fathom_id}`;
}

function reviewBlock(r: ReviewRow, i: number, mdCap: number): string {
  const f = r.fields || {};
  const structured = Object.keys(f).length
    ? `STRUCTURED FIELDS: ${JSON.stringify({
        sub_scores: f.sub_scores, objections_raised: f.objections_raised, prospect_language: f.prospect_language,
        ad_to_call_mismatch: f.ad_to_call_mismatch, setter_handoff: f.setter_handoff, systemic_flags: f.systemic_flags,
        review_flag: f.review_flag, stop: f.stop, start: f.start, keep: f.keep, drill: f.drill, red_flags: f.red_flags,
        setter: f.setter, cash_collected: f.cash_collected, call_type: f.call_type, tracker_matched: f.tracker_matched,
      })}`
    : "";
  return [
    `--- CALL ${i + 1}: ${r.closer || "unknown closer"} x ${r.prospect_name || "unknown prospect"} (${r.outcome || "outcome unclear"}, grade ${r.grade ?? "n/a"}, ${r.call_date}) — ${reviewLink(r)} ---`,
    structured,
    mdCap > 0 ? r.review_md.slice(0, mdCap) : "",
  ].filter(Boolean).join("\n");
}

/** Closers who took calls per the tracker but whose recordings never reached
 *  Fathom. This is the #1 reason reviews go missing (reps not recording). */
function recordingGaps(stats: ReturnType<typeof trackerDayStats>, fathomByCloser: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [code, g] of Object.entries(stats.byCloser)) {
    if (g.taken === 0) continue;
    const seen = fathomByCloser[code] || 0;
    if (seen < g.taken) out.push(`${closerDisplayName(code)}: tracker says ${g.taken} taken, ${seen} recording${seen === 1 ? "" : "s"} reached Fathom`);
  }
  return out;
}

async function fathomCountsByCloser(sb: Sb, fromIso: string, toIso: string): Promise<Record<string, number>> {
  const { data } = await sb.from("fathom_calls")
    .select("raw->ccos_closer,duration_sec")
    .gte("recorded_at", fromIso).lte("recorded_at", toIso).limit(500);
  const out: Record<string, number> = {};
  for (const r of (data || []) as { ccos_closer?: string | null; duration_sec?: number | null }[]) {
    if (!r.ccos_closer) continue;
    if (typeof r.duration_sec === "number" && r.duration_sec < MIN_DURATION_SEC) continue;
    out[r.ccos_closer] = (out[r.ccos_closer] || 0) + 1;
  }
  return out;
}

function groupLine(g: { booked: number; taken: number; noShows: number; pending: number; cancelled: number; closed: number; cashCents: number; closeRate: number | null; showRate: number | null }): string {
  return `${g.taken} taken, ${g.noShows} no-show, ${g.pending} pending (not happened / not marked yet), ${g.cancelled} cancelled of ${g.booked} booked; ${g.closed} closed, ${money(g.cashCents)} cash, close ${pct(g.closeRate)}, show ${pct(g.showRate)}`;
}

function closerStatLines(stats: ReturnType<typeof trackerDayStats>): string[] {
  return Object.entries(stats.byCloser).map(([code, g]) => `- ${closerDisplayName(code)}: ${groupLine(g)}`);
}

function buildDigestMessage(
  digestDate: string,
  todays: ReviewRow[],
  history: ReviewRow[],
  stats: ReturnType<typeof trackerDayStats>,
  gaps: string[],
  guardrails: string | null
): string {
  // Role-play pool: today's calls first, then the last 7 days, so Matt always
  // gets two calls even on a one-call day.
  const todayIds = new Set(todays.map((r) => r.fathom_id));
  const pool = history
    .filter((r) => !todayIds.has(r.fathom_id) && r.call_date && r.call_date >= addDays(digestDate, -7))
    .slice(-12)
    .map((r) => `- ${r.closer || "?"} x ${r.prospect_name || "?"} (${r.call_date}, ${r.outcome || "?"}, grade ${r.grade ?? "n/a"}) — ${reviewLink(r)}${r.fields?.review_flag && (r.fields.review_flag as { flag?: boolean }).flag ? ` — flagged: ${clip((r.fields.review_flag as { reason?: string }).reason, 120)}` : ""}`);
  const byCloser: Record<string, number[]> = {};
  for (const h of history) {
    const name = (h.closer || "").trim();
    if (!name || typeof h.grade !== "number") continue;
    (byCloser[name] = byCloser[name] || []).push(h.grade);
  }
  const trendLines = Object.entries(byCloser).map(([name, grades]) =>
    `- ${name}: ${grades.length} reviewed calls, average grade ${Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)}/100, last: ${grades.slice(-5).join(", ")}`
  );
  return [
    `You are our head of sales (Jeremy). Below are today's AI call reviews (${digestDate}), the tracker numbers for the day, and each closer's 14-day grade trend. Write the body of the DAILY SALES BRIEF for the sales manager (Matt).`,
    "",
    "COMPANY COACHING BOUNDARIES (hard rules):",
    guardrails || DEFAULT_GUARDRAILS,
    "",
    "WRITE EXACTLY THIS STRUCTURE (Slack mrkdwn: *bold* labels, short lines, no tables, no code blocks, no headings with #). Do NOT repeat the numeric header — it is prepended by the system:",
    DIGEST_BODY_TEMPLATE,
    "",
    "Be blunt, specific, and short enough to read on a phone in 3 minutes: the whole body under 3,000 characters, every section present. Every point ties to a moment from today's calls. Closer coaching never blames leads; lead/setter/ad issues belong under FLAG FOR MANAGEMENT only. Use 'Do this' language, never 'consider'.",
    "Numbers: use ONLY the tracker numbers below. 'pending' calls have not happened or are not marked yet — never call them no-shows.",
    "",
    `TRACKER NUMBERS FOR ${digestDate} (source of truth): ${groupLine(stats)}.`,
    ...closerStatLines(stats),
    gaps.length ? `RECORDING GAPS (put under FLAG FOR MANAGEMENT): ${gaps.join("; ")}` : "",
    "",
    "14-DAY GRADE TREND:",
    ...(trendLines.length ? trendLines : ["- no reviewed calls in the last 14 days"]),
    "",
    "",
    "RECENT CALLS (last 7 days, for the role-play picks when today has fewer than two):",
    ...(pool.length ? pool : ["- none"]),
    "",
    `TODAY'S CALL REVIEWS (${todays.length}):`,
    ...todays.map((r, i) => reviewBlock(r, i, 4500)),
  ].filter((l) => l !== "").join("\n");
}

function buildMarketingMessage(
  date: string,
  todays: ReviewRow[],
  mtdStats: ReturnType<typeof trackerDayStats>,
  mtdReviews: ReviewRow[],
  dayStats: ReturnType<typeof trackerDayStats>
): string {
  const cats: Record<string, number> = {};
  for (const r of mtdReviews) {
    const objs = Array.isArray(r.fields?.objections_raised) ? (r.fields!.objections_raised as { category?: string }[]) : [];
    for (const o of objs) { const c = String(o?.category || "other"); cats[c] = (cats[c] || 0) + 1; }
  }
  const catLines = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n}`);
  const trackerObj = Object.entries(mtdStats.objections).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n}`);
  return [
    `You are our head of sales (Jeremy) writing for Alex, our marketer. From today's call reviews (${date}) write the DAILY MARKETING BRIEF. Alex does not coach closers; he needs what the market said so he can change ads, hooks and pre-call content.`,
    "",
    "WRITE EXACTLY THIS STRUCTURE (Slack mrkdwn: *bold* labels, short lines, no tables, no code blocks, no # headings):",
    MARKETING_TEMPLATE,
    "",
    "Rules: quotes are the prospect's exact words from the reviews' prospect_language and objections_raised fields — never paraphrase. Name the closer only when a mismatch needs tracing. No coaching advice for closers here. Keep it under 3,500 characters.",
    "",
    `DAY NUMBERS: ${todays.length} calls reviewed, show ${pct(dayStats.showRate)}, close ${pct(dayStats.closeRate)}.`,
    `MONTH-TO-DATE OBJECTIONS (from reviews, by category): ${catLines.length ? "" : "none yet"}`,
    ...catLines,
    `MONTH-TO-DATE OBJECTION TAGS (closers' own tags in the tracker): ${trackerObj.length ? "" : "none"}`,
    ...trackerObj,
    `MONTH-TO-DATE: ${mtdStats.taken} taken of ${mtdStats.booked} booked, ${mtdStats.closed} closed, show ${pct(mtdStats.showRate)}, close ${pct(mtdStats.closeRate)}.`,
    "",
    `TODAY'S REVIEWS (${todays.length}):`,
    ...todays.map((r, i) => reviewBlock(r, i, 1500)),
  ].join("\n");
}

/** Watchdog: the feed died silently for 15 days once. Never again. */
async function watchdog(sb: Sb, gaps: string[]): Promise<string[]> {
  const warnings: string[] = [];
  const { data: newest } = await sb.from("fathom_calls")
    .select("recorded_at").order("recorded_at", { ascending: false }).limit(1);
  const newestMs = newest?.[0]?.recorded_at ? Date.parse(String(newest[0].recorded_at)) : 0;
  const daysQuiet = newestMs ? Math.floor((Date.now() - newestMs) / 86400e3) : 999;
  if (daysQuiet >= 3) {
    warnings.push(`No call has reached CCOS in ${daysQuiet} days. Check the Fathom keys and whether anyone is recording.`);
  }
  // Each closer key is probed with a 1-item list; a dead key means that rep's
  // calls silently vanish from the queue.
  for (const k of fathomKeys()) {
    try {
      const res = await fathomList(k.key, { limit: "1" }, 15000);
      if (res.status !== 200) warnings.push(`Fathom key ${k.label} is failing (http ${res.status}).`);
    } catch (e) {
      warnings.push(`Fathom key ${k.label} probe error: ${String(e).slice(0, 80)}`);
    }
  }
  // Active closers (Matthew, 2026-09-19): Erin is off the team; Austin's key is pending.
  const missing = ["WILL", "BROZ", "CHRIS", "WOBBE", "AUSTIN"].filter(
    (c) => !fathomKeys().some((k) => k.closerCode === c)
  );
  if (missing.length) warnings.push(`No Fathom key on file for: ${missing.map(closerDisplayName).join(", ")} — their calls cannot be reviewed.`);
  warnings.push(...gaps.map((g) => `Not recording: ${g}.`));
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

/** The nightly Layer 2 run: sales brief + marketing brief, then the watchdog. */
export async function runDailyDigest(sb: Sb, opts: { date?: string; force?: boolean; only?: "digest" | "marketing" } = {}) {
  const report: Record<string, unknown> = {};
  const digestDate = opts.date || etDate();
  const force = !!opts.force;
  const want = (k: "digest" | "marketing") => !opts.only || opts.only === k;
  let gaps: string[] = [];
  try {
    const [todays, history, scripts, dayRows, mtdRows, mtdReviews] = await Promise.all([
      loadReviews(sb, digestDate, digestDate),
      loadReviews(sb, addDays(digestDate, -14), digestDate),
      loadScripts(sb),
      loadTrackerRows(sb, digestDate, digestDate),
      loadTrackerRows(sb, digestDate.slice(0, 7) + "-01", digestDate),
      loadReviews(sb, digestDate.slice(0, 7) + "-01", digestDate),
    ]);
    const dayStats = trackerDayStats(dayRows);
    const fathomCounts = await fathomCountsByCloser(sb, `${digestDate}T00:00:00-04:00`, `${digestDate}T23:59:59-04:00`);
    gaps = recordingGaps(dayStats, fathomCounts);

    if (todays.length === 0 && dayStats.taken === 0) {
      report.digest = "no reviews and no taken calls today, skipped";
    } else {
      // Each brief is isolated: a failure in one never hides the other.
      if (want("digest")) try {
        report.digest = await sendAndMaybeCollect(
          sb, "digest", digestDate,
          buildDigestMessage(digestDate, todays, history, dayStats, gaps, scripts.guardrails),
          (run, reply) => finalizeRun(sb, run, reply), { force }
        );
      } catch (e) {
        report.digest = `error: ${String(e).slice(0, 300)}`;
      }
      if (want("marketing")) try {
        report.marketing = todays.length === 0
          ? "no reviews today, marketing brief skipped"
          : await sendAndMaybeCollect(
              sb, "marketing", digestDate,
              buildMarketingMessage(digestDate, todays, trackerDayStats(mtdRows), mtdReviews, dayStats),
              (run, reply) => finalizeRun(sb, run, reply), { force }
            );
      } catch (e) {
        report.marketing = `error: ${String(e).slice(0, 300)}`;
      }
    }
  } catch (e) {
    report.digest = `error: ${String(e).slice(0, 300)}`;
  }
  try { report.watchdog = await watchdog(sb, gaps); }
  catch (e) { report.watchdog = `error: ${String(e).slice(0, 200)}`; }
  return report;
}

/* --------------------------- Layer 3: weekly report ------------------------- */

function buildWeeklyMessage(
  weekStart: string, weekEnd: string,
  reviews: ReviewRow[], prevReviews: ReviewRow[],
  stats: ReturnType<typeof trackerDayStats>, prevStats: ReturnType<typeof trackerDayStats>
): string {
  const gradesBy = (rows: ReviewRow[]) => {
    const m: Record<string, number[]> = {};
    for (const r of rows) if (r.closer && typeof r.grade === "number") (m[r.closer] = m[r.closer] || []).push(r.grade);
    return m;
  };
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const cur = gradesBy(reviews);
  const prev = gradesBy(prevReviews);
  const closerLines = Object.entries(cur).map(([c, g]) =>
    `- ${c}: ${g.length} reviewed, avg ${avg(g)} (last week ${prev[c] ? `avg ${avg(prev[c])} over ${prev[c].length}` : "no reviews"})`
  );
  const catCount = (rows: ReviewRow[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) for (const o of (Array.isArray(r.fields?.objections_raised) ? (r.fields!.objections_raised as { category?: string }[]) : []))
      m[String(o?.category || "other")] = (m[String(o?.category || "other")] || 0) + 1;
    return m;
  };
  const curCats = catCount(reviews); const prevCats = catCount(prevReviews);
  const catLines = Object.entries(curCats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n} (last week ${prevCats[c] || 0})`);
  const setterLines = Object.entries(stats.bySetter).map(([s, g]) => `- ${s}: ${g.taken} taken of ${g.booked} booked, show ${pct(g.showRate)}, ${g.closed} closed`);
  const flagged = reviews.filter((r) => (r.fields?.review_flag as { flag?: boolean } | undefined)?.flag)
    .map((r) => `- ${r.closer} x ${r.prospect_name}: ${clip((r.fields?.review_flag as { reason?: string }).reason, 140)}`);
  return [
    `You are our head of sales (Jeremy). Write the WEEKLY PATTERN REPORT for the sales manager (Matt) covering ${weekStart} to ${weekEnd}, compared with the prior week.`,
    "",
    "WRITE EXACTLY THIS STRUCTURE (Slack mrkdwn: *bold* labels, short lines, no tables, no code blocks, no # headings). Fill the WEEK line from the numbers below:",
    WEEKLY_TEMPLATE,
    "",
    "Rules: strategic, not per-call. Name who is improving and who is declining with the numbers. Ad angle data is not available — write 'Insufficient data' there. Under 3,800 characters.",
    "",
    `THIS WEEK (tracker): ${groupLine(stats)}.`,
    `LAST WEEK (tracker): ${groupLine(prevStats)}.`,
    "PER CLOSER (tracker, this week):",
    ...closerStatLines(stats),
    "PER CLOSER (review grades):",
    ...(closerLines.length ? closerLines : ["- no reviewed calls this week"]),
    "OBJECTION CATEGORIES (from reviews):",
    ...(catLines.length ? catLines : ["- none recorded"]),
    "SETTERS (tracker, this week):",
    ...(setterLines.length ? setterLines : ["- no setter data"]),
    "FLAGGED FOR REVIEW THIS WEEK:",
    ...(flagged.length ? flagged : ["- none"]),
    "",
    `THIS WEEK'S REVIEWS (${reviews.length}, structured fields only):`,
    ...reviews.map((r, i) => reviewBlock(r, i, 0)),
  ].join("\n");
}

/** Monday run: the previous Monday–Sunday week. */
export async function runWeeklyReport(sb: Sb, opts: { weekStart?: string; force?: boolean } = {}) {
  const report: Record<string, unknown> = {};
  try {
    const today = etDate();
    // Previous Monday: today's ET weekday -> back to Monday, then one more week.
    const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 = Sunday
    const thisMonday = addDays(today, -((dow + 6) % 7));
    const weekStart = opts.weekStart || addDays(thisMonday, -7);
    const weekEnd = addDays(weekStart, 6);
    const prevStart = addDays(weekStart, -7);
    const prevEnd = addDays(weekStart, -1);
    const [reviews, prevReviews, rows, prevRows] = await Promise.all([
      loadReviews(sb, weekStart, weekEnd),
      loadReviews(sb, prevStart, prevEnd),
      loadTrackerRows(sb, weekStart, weekEnd),
      loadTrackerRows(sb, prevStart, prevEnd),
    ]);
    if (reviews.length === 0 && rows.length === 0) {
      report.weekly = `nothing to report for ${weekStart}`;
    } else {
      report.weekly = await sendAndMaybeCollect(
        sb, "weekly", weekStart,
        buildWeeklyMessage(weekStart, weekEnd, reviews, prevReviews, trackerDayStats(rows), trackerDayStats(prevRows)),
        (run, reply) => finalizeRun(sb, run, reply), { force: !!opts.force }
      );
    }
    report.week = { weekStart, weekEnd, reviews: reviews.length, trackerRows: rows.length };
  } catch (e) {
    report.weekly = `error: ${String(e).slice(0, 300)}`;
  }
  return report;
}
