// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — rep adherence grading.
//
// Grades how well each closer runs the PRE-CALL CONFIRMATION SOP ("How To
// Confirm Calls") on every sales booking, straight from the SendBlue group
// chat the booking automation opens (closer + ghost influencer number +
// prospect). One row lands in warehouse.metrics_adherence_scores per
// (kind='pre_call', appointment) — see supabase/migrations/115.
//
// The rubric (wording is always paraphrasable — we grade intent):
//   confirm     1. Prospect verbally confirms the call time.
//   agenda      2. After confirmation, the closer asks the agenda question
//                  ("what's the main thing you want help with when we chat?").
//   acknowledge 3. Closer acknowledges the prospect's answer.
//   excitement  4. Closer sends a time-excitement confirmation ("super stoked
//                  to speak with you tomorrow at 3").
//   ready_ping  5. T-5-minutes ready ping shortly before the call.
//   follow_up   6. If the prospect never confirmed within 24h of booking: at
//                  least one follow-up attempt in the thread. (The SOP's
//                  Slack/RipDrip escalation is not visible in SendBlue and is
//                  deliberately not graded.)
//
// Applicability per call: check 1 always applies. Confirmed → 2–5 apply and
// 6 is n/a. Never confirmed → 2–5 are n/a and 6 applies (unless the call
// started under 24h after booking, when the follow-up window never opened).
// score = passed ÷ applicable.
//
// Mechanics: a deterministic pre-pass decides the TIMING facts (is there any
// outbound message inside the 30-minute ready-ping window; are there outbound
// messages 24h+ after booking) and ONE Claude call per appointment decides
// the SEMANTIC facts (checks 1–4, whether the timed message really is a
// ready ping, whether the late messages really are follow-up attempts).
// Claude runs with structured outputs so no JSON parsing can fail; a missing
// ANTHROPIC_API_KEY (local dev — the key only exists in prod) makes the run
// return a clear skipped result instead of grading.
//
// kind='closing' (the closing-script rubric) is reserved: the table and the
// dashboard slot already support it, the script arrives later.
// ─────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { etDay, shiftDay, todayEt, ET_ZONE } from "@/lib/ads-v2/time";
import { getThreadMessages, isSendBlueConfigured } from "@/lib/sendblue";
import { REPS_BY_KEY, repKeyFromGhlUserId } from "./team";
import { chunk, isMissingRelation, safeFetchAllRows } from "./db";
import type { CallType } from "./types";

// ── The rubric ────────────────────────────────────────────────────────────

// Rubric per the owner's SOP (2026-09-17): the closer opens with the INTRO
// ("good to meet you — looks like I got you in for <time>"), the prospect
// replies, and the closer asks the DISCOVERY line. There is NO commitment
// line in the SOP ("I made that up") — it was removed. Two checks, plus the
// timing between them: how long the closer took to answer the prospect's
// reply to the intro (ideally with the discovery line itself).
export type AdherenceCheckId = "intro" | "discovery";

export const ADHERENCE_CHECKS: ReadonlyArray<{ id: AdherenceCheckId; label: string }> = [
  { id: "intro", label: 'Intro ("good to meet you — got you in for <time>")' },
  { id: "discovery", label: 'Discovery line ("what do you want out of the call")' },
];

export interface CheckVerdict {
  id: AdherenceCheckId;
  label: string;
  applicable: boolean;
  passed: boolean;
  /** Short quote from the thread backing the verdict (may be empty). */
  evidence: string;
  /** ISO time of the closer-side message that delivered the line (null when not sent). */
  at?: string | null;
  /** intro only: the prospect's first reply after the intro. */
  leadReplyAt?: string | null;
  /** intro only: the closer side's first message after that reply, and the gap. */
  closerReplyAt?: string | null;
  responseSeconds?: number | null;
  /** discovery only: was the discovery line the closer's DIRECT reply to the prospect's intro response? */
  directReply?: boolean | null;
}

// ── Tunables ──────────────────────────────────────────────────────────────

/** Max appointments graded per run (one Claude call each — cost guard). */
const MAX_GRADES_PER_RUN = 40;
/** Legacy re-grades per run — kept small so a run stays inside the 300s cap. */
const MAX_REGRADES_PER_RUN = 8;
/** Stop starting new Claude calls past this; the route's maxDuration is 300s. */
const RUN_TIME_BUDGET_MS = 220_000;
/** Thread window: booking creation → call start + 1h. */
const THREAD_TAIL_MS = 60 * 60_000;
/** How many recent SendBlue messages to pull per phone number. */
// SendBlue rejects limit > 100 ("limit must be a number between 1 and 100").
const SENDBLUE_FETCH_LIMIT = 100;

const CLAUDE_MODEL = "claude-opus-5";

// ── ET timestamp rendering for the prompt ─────────────────────────────────

const ET_TS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function etStamp(iso: string | null): string {
  if (!iso) return "unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return `${ET_TS_FMT.format(d)} ET`;
}

// ── Claude: one structured call per appointment ───────────────────────────

interface SemanticVerdict {
  intro_index: number; // 1-based message number, 0 = never sent
  intro_evidence: string;
  discovery_index: number;
  discovery_evidence: string;
}

const VERDICT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    // NOTE: no numeric constraints (minimum/maximum) — Claude's structured
    // outputs accept only a JSON-schema subset and reject them with a 400.
    intro_index: {
      type: "integer",
      description:
        "The message NUMBER (as numbered in the thread) of the closer-side INTRO — the first message greeting the prospect and stating/confirming the booked call time (canonical: 'good to meet you — looks like I got you in for <time>'). Paraphrases fully count. 0 if it was never sent.",
    },
    intro_evidence: { type: "string", description: "Short verbatim quote from that message, or empty string." },
    discovery_index: {
      type: "integer",
      description:
        "The message NUMBER of the closer-side DISCOVERY line — a question asking what the prospect wants to get out of the call (canonical: 'so I can make it worth your while… what's the main thing you want help with when we chat?'). Paraphrases fully count. First occurrence if repeated. 0 if never asked.",
    },
    discovery_evidence: { type: "string", description: "Short verbatim quote from that message, or empty string." },
  },
  required: ["intro_index", "intro_evidence", "discovery_index", "discovery_evidence"],
  additionalProperties: false,
};

const CLAUDE_ATTEMPTS = 3;

/**
 * One structured Claude call. Returns null when the call ultimately failed
 * (network/refusal/truncation) — the caller then skips the appointment so a
 * later run retries it.
 */
async function askClaudeForVerdict(prompt: string): Promise<SemanticVerdict | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });

  for (let attempt = 1; attempt <= CLAUDE_ATTEMPTS; attempt++) {
    try {
      // NOTE: plain messages.create (not the beta surface). The installed
      // SDK (0.78.0) types structured outputs on the standard surface but
      // has no `fallbacks` / server-side-fallback beta support yet, so the
      // refusal-fallback beta is intentionally not sent. `thinking` is
      // omitted on purpose (adaptive by default on this model); sampling
      // params are omitted (removed on this model).
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      });
      if (response.stop_reason !== "end_turn") {
        console.error(`[adherence] Claude stopped with ${response.stop_reason} — not grading`);
        return null;
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (!text) return null;
      return JSON.parse(text) as SemanticVerdict;
    } catch (err) {
      const last = attempt === CLAUDE_ATTEMPTS;
      console.error(
        `[adherence] Claude call failed (attempt ${attempt}/${CLAUDE_ATTEMPTS})${last ? " — giving up" : " — retrying"}:`,
        err instanceof Error ? err.message : err,
      );
      if (last) return null;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  return null;
}

// ── Prompt assembly ───────────────────────────────────────────────────────

interface ThreadMessage {
  content: string;
  direction: "inbound" | "outbound";
  sentAt: string | null;
}

function buildPrompt(args: {
  repName: string;
  contactName: string | null;
  bookedAtIso: string;
  startIso: string;
  messages: ThreadMessage[];
}): string {
  const lines = args.messages.map((m, i) => {
    const who = m.direction === "outbound" ? "CLOSER SIDE" : "PROSPECT";
    return `${i + 1}. [${etStamp(m.sentAt)}] ${who}: ${m.content || "(no text — attachment/reaction)"}`;
  });

  return [
    "You grade a sales closer's PRE-CALL SOP in an iMessage group chat with a prospect. The chat has the closer's side (closer + a ghost influencer number — both count as CLOSER SIDE) and the prospect.",
    "",
    "The SOP has exactly TWO closer-side messages (exact wording is NEVER required — grade intent, paraphrases fully count):",
    "1. THE INTRO — right after booking, the closer greets the prospect and states/confirms the booked call time. Canonical form: \"Hey <name>, good to meet you — looks like I got you in for <time>.\" Any first message that greets the prospect and confirms the call time counts.",
    "2. THE DISCOVERY LINE — after the prospect replies, the closer asks what they want to get out of the call. Canonical form: \"Quick question so I can make it worth your while… what's the main thing you want help with when we chat?\" Any question asking what the prospect wants out of the call counts.",
    "",
    "Nothing else in the thread is graded — there is no commitment line in this SOP. Ignore reminders, pings, and small talk except as context.",
    "",
    `Call context: closer = ${args.repName}; prospect = ${args.contactName || "unknown"}.`,
    `The call was booked at ${etStamp(args.bookedAtIso)} and scheduled to start at ${etStamp(args.startIso)}.`,
    "",
    "The thread (chronological, timestamps in Eastern Time):",
    lines.length ? lines.join("\n") : "(no messages)",
    "",
    "For each of the two lines return the NUMBER of the closer-side message that delivers it (use the numbering shown), or 0 if it was never sent; if a line appears more than once, return the FIRST occurrence. Evidence: a SHORT verbatim quote (under 120 characters) from that message, or an empty string when the line was never sent.",
  ].join("\n");
}

// ── Assemble the verdict rows ─────────────────────────────────────────────

function buildChecks(semantic: SemanticVerdict, messages: ThreadMessage[]): CheckVerdict[] {
  const label = (id: AdherenceCheckId) => ADHERENCE_CHECKS.find((c) => c.id === id)!.label;
  // A line only counts when Claude's index points at a real closer-side
  // message — a stray index at a prospect message never scores.
  const outboundAt = (index: number): string | null => {
    const m = Number.isInteger(index) && index >= 1 && index <= messages.length ? messages[index - 1] : null;
    return m && m.direction === "outbound" ? m.sentAt : null;
  };
  const introIdx = semantic.intro_index;
  const discoveryIdx = semantic.discovery_index;
  const introAt = outboundAt(introIdx);
  const discoveryAt = outboundAt(discoveryIdx);

  // Timing is deterministic once the intro is located: the prospect's first
  // reply after it, then the closer side's first message after that reply.
  let leadReplyAt: string | null = null;
  let closerReplyAt: string | null = null;
  let closerReplyIdx = 0;
  if (introAt) {
    for (let i = introIdx; i < messages.length; i++) {
      const m = messages[i];
      if (!m.sentAt) continue;
      if (!leadReplyAt) {
        if (m.direction === "inbound") leadReplyAt = m.sentAt;
        continue;
      }
      if (m.direction === "outbound") {
        closerReplyAt = m.sentAt;
        closerReplyIdx = i + 1;
        break;
      }
    }
  }
  const responseSeconds =
    leadReplyAt && closerReplyAt
      ? Math.max(0, (new Date(closerReplyAt).getTime() - new Date(leadReplyAt).getTime()) / 1000)
      : null;

  return [
    {
      id: "intro",
      label: label("intro"),
      applicable: true,
      passed: Boolean(introAt),
      evidence: introAt ? semantic.intro_evidence : "",
      at: introAt,
      leadReplyAt,
      closerReplyAt,
      responseSeconds,
    },
    {
      id: "discovery",
      label: label("discovery"),
      applicable: true,
      passed: Boolean(discoveryAt),
      evidence: discoveryAt ? semantic.discovery_evidence : "",
      at: discoveryAt,
      directReply: discoveryAt ? closerReplyIdx === discoveryIdx : null,
    },
  ];
}

// ── One appointment's thread → verdict ────────────────────────────────────

type GradeOutcome =
  | { status: "no_thread" }
  | { status: "failed" }
  | { status: "graded"; checks: CheckVerdict[] };

/**
 * Fetch the SendBlue thread for one appointment, window it to booking → call
 * start + 1h, and run the one semantic Claude call. Shared by fresh grading
 * and the legacy re-grade so both paths score identically.
 */
async function gradeThread(args: {
  phone: string;
  startIso: string;
  bookedAtIso: string;
  repKey: string | null;
  contactName: string | null;
}): Promise<GradeOutcome> {
  // The SendBlue thread — group chats expanded so the closer-side outbound
  // messages are present (number= alone returns only the prospect's side).
  const { messages: rawMessages } = await getThreadMessages(args.phone, { limit: SENDBLUE_FETCH_LIMIT });
  const startMs = new Date(args.startIso).getTime();
  const bookedMs = new Date(args.bookedAtIso).getTime();
  const windowFrom = Math.min(bookedMs, startMs);
  const windowTo = startMs + THREAD_TAIL_MS;
  const messages: ThreadMessage[] = rawMessages
    .filter((m) => {
      const t = m.sentAt ? new Date(m.sentAt).getTime() : NaN;
      return Number.isFinite(t) && t >= windowFrom && t <= windowTo;
    })
    .sort((a, b) => new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime())
    .map((m) => ({ content: m.content, direction: m.direction, sentAt: m.sentAt }));

  if (messages.length === 0) return { status: "no_thread" };

  const semantic = await askClaudeForVerdict(
    buildPrompt({
      repName: (args.repKey && REPS_BY_KEY[args.repKey]?.name) || "the closer",
      contactName: args.contactName,
      bookedAtIso: args.bookedAtIso,
      startIso: args.startIso,
      messages,
    }),
  );
  if (!semantic) return { status: "failed" };
  return { status: "graded", checks: buildChecks(semantic, messages) };
}

// ── The run ───────────────────────────────────────────────────────────────

interface BookingEventRow {
  id: string;
  client_key: string;
  lead_key: string | null;
  channel: string | null;
  rep_key: string | null;
  occurred_at: string;
  metadata: {
    appointment_id?: string;
    call_type?: string;
    side?: string;
    start_time?: string | null;
    start_et_day?: string | null;
    contact_name?: string | null;
  } | null;
  source_row_key: string;
}

interface AppointmentRow {
  appointment_id: string;
  contact_phone: string | null;
  contact_name: string | null;
  assigned_user_id: string | null;
  start_time: string | null;
}

export interface AdherenceRunResult {
  ok: boolean;
  skipped?: string;
  migration_pending: boolean;
  window: { from: string; to: string };
  candidates: number;
  already_graded: number;
  graded: number;
  thread_missing: number;
  claude_failed: number;
  /** Old-rubric rows re-scored this run (budget left after fresh grading). */
  regraded: number;
  notes: string[];
}

function callTypeOf(e: BookingEventRow): CallType {
  const m = e.metadata?.call_type;
  if (m === "dm" || m === "onboarding" || m === "lm_outbound" || m === "outbound") return m;
  if (e.metadata?.side === "onboarding") return "onboarding";
  if (e.channel === "dm") return "dm";
  if (String(e.channel || "").startsWith("lm_outbound")) return "lm_outbound";
  return "outbound";
}

/**
 * Grade every ungraded sales call that started in the past `days` ET days.
 * Idempotent: one row per (kind='pre_call', appointment); calls without a
 * SendBlue thread still get a row (score NULL) so they are never re-tried
 * forever, while calls whose Claude call failed get NO row so a later run
 * retries them.
 */
export async function runAdherenceGrading(params?: { days?: number }): Promise<AdherenceRunResult> {
  const days = Math.max(1, Math.min(30, Math.floor(params?.days ?? 3)));
  const today = todayEt();
  const fromDay = shiftDay(today, -(days - 1));
  const nowMs = Date.now();
  const notes: string[] = [];

  const base: AdherenceRunResult = {
    ok: true,
    migration_pending: false,
    window: { from: fromDay, to: today },
    candidates: 0,
    already_graded: 0,
    graded: 0,
    thread_missing: 0,
    claude_failed: 0,
    regraded: 0,
    notes,
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...base, ok: false, skipped: "ANTHROPIC_API_KEY not set — adherence grading only runs where the key exists (prod)." };
  }
  if (!isSendBlueConfigured()) {
    return { ...base, ok: false, skipped: "SendBlue credentials not configured (SENDBLUE_API_KEY_ID / SENDBLUE_API_SECRET_KEY)." };
  }

  const db = getServiceSupabase();

  // 1) Sales bookings whose scheduled start is in the past N ET days.
  const bookingsRes = await safeFetchAllRows<BookingEventRow>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_lead_events")
      .select("id, client_key, lead_key, channel, rep_key, occurred_at, metadata, source_row_key")
      .eq("event_type", "booking")
      .gte("metadata->>start_et_day", fromDay)
      .lte("metadata->>start_et_day", today)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (bookingsRes.missing) {
    return { ...base, migration_pending: true, skipped: "metrics_lead_events missing — paste migration 113 first." };
  }

  // Scope (owner, 2026-08-26): strategy sessions (dm) + onboarding calls —
  // onboarding only when taken by one of OUR reps (Nicole's are dropped at
  // step 3, where the assigned user is known). Outbound / LM-outbound
  // personal-calendar calls are NOT graded.
  const byAppointment = new Map<string, BookingEventRow>();
  for (const e of bookingsRes.rows) {
    const ct = callTypeOf(e);
    if (ct !== "dm" && ct !== "onboarding") continue;
    const start = e.metadata?.start_time;
    if (!start || new Date(start).getTime() > nowMs) continue;
    const apptId =
      e.metadata?.appointment_id ||
      (e.source_row_key.startsWith("booking:") ? e.source_row_key.slice("booking:".length) : null);
    if (!apptId) continue;
    if (!byAppointment.has(apptId)) byAppointment.set(apptId, e);
  }
  base.candidates = byAppointment.size;
  if (byAppointment.size === 0) return base;

  // 2) Drop appointments that already carry a pre_call score.
  const allApptIds = [...byAppointment.keys()];
  for (const ids of chunk(allApptIds, 200)) {
    const { rows, missing } = await safeFetchAllRows<{ appointment_key: string }>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_adherence_scores")
        .select("appointment_key")
        .eq("kind", "pre_call")
        .in("appointment_key", ids)
        .order("appointment_key", { ascending: true })
        .range(from, to),
    );
    if (missing) {
      return { ...base, migration_pending: true, skipped: "metrics_adherence_scores missing — paste migration 115 first." };
    }
    for (const r of rows) {
      if (byAppointment.delete(r.appointment_key)) base.already_graded += 1;
    }
  }
  if (byAppointment.size === 0) return base;

  // 3) Appointment context (contact phone) for the remaining candidates.
  const apptById = new Map<string, AppointmentRow>();
  for (const ids of chunk([...byAppointment.keys()], 200)) {
    const { rows } = await safeFetchAllRows<AppointmentRow>((from, to) =>
      db
        .schema("warehouse")
        .from("ghl_appointments")
        .select("appointment_id, contact_phone, contact_name, assigned_user_id, start_time")
        .in("appointment_id", ids)
        .order("appointment_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) apptById.set(r.appointment_id, r);
  }

  // 3b) Onboarding calls only count when a rep of ours takes them — drop the
  // rest (Nicole's client-onboarding calls, unassigned) without writing rows.
  for (const [apptId, event] of [...byAppointment.entries()]) {
    if (callTypeOf(event) !== "onboarding") continue;
    const assigned = apptById.get(apptId)?.assigned_user_id ?? null;
    const rep = event.rep_key ?? repKeyFromGhlUserId(assigned);
    if (!rep) {
      byAppointment.delete(apptId);
      base.candidates -= 1;
    }
  }
  if (byAppointment.size === 0) return base;

  // 4) Grade, oldest start first, capped per run.
  const queue = [...byAppointment.entries()]
    .sort((a, b) => String(a[1].metadata?.start_time).localeCompare(String(b[1].metadata?.start_time)))
    .slice(0, MAX_GRADES_PER_RUN);
  if (byAppointment.size > queue.length) {
    notes.push(`${byAppointment.size - queue.length} candidates deferred to the next run (cap ${MAX_GRADES_PER_RUN}).`);
  }

  type ScoreInsert = {
    client_key: string;
    appointment_key: string;
    lead_key: string | null;
    rep_key: string | null;
    kind: "pre_call";
    score: number | null;
    applicable_checks: number;
    passed_checks: number;
    checks: CheckVerdict[];
    thread_found: boolean;
    model: string | null;
    notes: string | null;
  };

  const inserts: ScoreInsert[] = [];
  // Rows persist as they are graded (every few rows, and every re-grade) so
  // a run that hits the platform's time cap keeps everything scored so far.
  const persistRows = async (rows: ScoreInsert[], ignoreDuplicates = true) => {
    if (rows.length === 0) return;
    const { error } = await db
      .schema("warehouse")
      .from("metrics_adherence_scores")
      .upsert(rows, { onConflict: "kind,appointment_key", ignoreDuplicates });
    if (error) {
      if (isMissingRelation(error)) throw new Error("metrics_adherence_scores missing — paste migration 115 first.");
      throw new Error(`adherence upsert failed: ${error.message}`);
    }
  };
  const outOfTime = () => Date.now() - nowMs > RUN_TIME_BUDGET_MS;

  for (const [apptId, event] of queue) {
    if (outOfTime()) {
      notes.push("time budget reached — remaining candidates are retried next run");
      break;
    }
    const appt = apptById.get(apptId) ?? null;
    const startIso = appt?.start_time || event.metadata?.start_time || null;
    const bookedAtIso = event.occurred_at;
    const repKey = event.rep_key ?? repKeyFromGhlUserId(appt?.assigned_user_id) ?? null;
    const rowBase = {
      client_key: event.client_key,
      appointment_key: apptId,
      lead_key: event.lead_key,
      rep_key: repKey,
      kind: "pre_call" as const,
    };

    const phone = appt?.contact_phone?.trim() || null;
    if (!phone || !startIso) {
      inserts.push({
        ...rowBase,
        score: null,
        applicable_checks: 0,
        passed_checks: 0,
        checks: [],
        thread_found: false,
        model: null,
        notes: !phone ? "no contact phone on the appointment" : "no scheduled start time",
      });
      base.thread_missing += 1;
      continue;
    }

    const graded = await gradeThread({
      phone,
      startIso,
      bookedAtIso,
      repKey,
      contactName: appt?.contact_name ?? null,
    });
    if (graded.status === "no_thread") {
      inserts.push({
        ...rowBase,
        score: null,
        applicable_checks: 0,
        passed_checks: 0,
        checks: [],
        thread_found: false,
        model: null,
        notes: "no SendBlue thread",
      });
      base.thread_missing += 1;
      continue;
    }
    if (graded.status === "failed") {
      base.claude_failed += 1;
      continue; // no row — a later run retries this appointment
    }

    const checks = graded.checks;
    const applicable = checks.filter((c) => c.applicable).length;
    const passed = checks.filter((c) => c.applicable && c.passed).length;
    inserts.push({
      ...rowBase,
      score: applicable > 0 ? passed / applicable : null,
      applicable_checks: applicable,
      passed_checks: passed,
      checks,
      thread_found: true,
      model: CLAUDE_MODEL,
      notes: null,
    });
    base.graded += 1;
    if (inserts.length >= 5) await persistRows(inserts.splice(0, inserts.length));
  }

  // 5) Persist.
  if (inserts.length > 0) {
    for (const batch of chunk(inserts, 50)) {
      const { error } = await db
        .schema("warehouse")
        .from("metrics_adherence_scores")
        .upsert(batch, { onConflict: "kind,appointment_key", ignoreDuplicates: true });
      if (error) {
        if (isMissingRelation(error)) {
          return { ...base, migration_pending: true, skipped: "metrics_adherence_scores missing — paste migration 115 first." };
        }
        throw new Error(`adherence insert failed: ${error.message}`);
      }
    }
  }

  // 6) Legacy re-grade — rows scored under the pre-2026-09-17 rubric carry no
  //    'intro' check (and no timing). Re-score them with whatever budget the
  //    fresh grading left, newest first, so history fills in over a few runs.
  //    Rows with no thread are left alone (nothing to re-read).
  const regradeBudget = Math.max(0, Math.min(MAX_REGRADES_PER_RUN, MAX_GRADES_PER_RUN - queue.length));
  if (regradeBudget > 0) {
    const { rows: legacy } = await safeFetchAllRows<{
      appointment_key: string;
      client_key: string;
      lead_key: string | null;
      rep_key: string | null;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_adherence_scores")
        .select("appointment_key, client_key, lead_key, rep_key")
        .eq("kind", "pre_call")
        .eq("thread_found", true)
        .not("checks", "cs", JSON.stringify([{ id: "intro" }]))
        .order("graded_at", { ascending: false })
        .range(from, to),
    );
    const targets = legacy.slice(0, regradeBudget);
    if (targets.length > 0) {
      type LegacyAppt = AppointmentRow & { created_at: string | null };
      const legacyAppts = new Map<string, LegacyAppt>();
      for (const ids of chunk(targets.map((t) => t.appointment_key), 200)) {
        const { rows } = await safeFetchAllRows<LegacyAppt>((from, to) =>
          db
            .schema("warehouse")
            .from("ghl_appointments")
            .select("appointment_id, contact_phone, contact_name, assigned_user_id, start_time, created_at")
            .in("appointment_id", ids)
            .order("appointment_id", { ascending: true })
            .range(from, to),
        );
        for (const r of rows) legacyAppts.set(r.appointment_id, r);
      }

      const regrades: ScoreInsert[] = [];
      for (const t of targets) {
        if (outOfTime()) {
          notes.push("time budget reached — remaining legacy rows re-grade next run");
          break;
        }
        const appt = legacyAppts.get(t.appointment_key);
        const phone = appt?.contact_phone?.trim() || null;
        const startIso = appt?.start_time || null;
        const bookedAtIso = appt?.created_at || startIso;
        if (!phone || !startIso || !bookedAtIso) continue;
        const repKey = t.rep_key ?? repKeyFromGhlUserId(appt?.assigned_user_id) ?? null;
        const graded = await gradeThread({
          phone,
          startIso,
          bookedAtIso,
          repKey,
          contactName: appt?.contact_name ?? null,
        });
        if (graded.status !== "graded") continue;
        const applicable = graded.checks.filter((c) => c.applicable).length;
        const passed = graded.checks.filter((c) => c.applicable && c.passed).length;
        regrades.push({
          client_key: t.client_key,
          appointment_key: t.appointment_key,
          lead_key: t.lead_key,
          rep_key: repKey,
          kind: "pre_call",
          score: applicable > 0 ? passed / applicable : null,
          applicable_checks: applicable,
          passed_checks: passed,
          checks: graded.checks,
          thread_found: true,
          model: CLAUDE_MODEL,
          notes: "re-graded under the intro + discovery rubric (2026-09-17)",
        });
        base.regraded += 1;
        await persistRows(regrades.splice(0, regrades.length), false);
      }
    }
  }

  return base;
}
