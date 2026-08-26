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
import { getMessages, isSendBlueConfigured } from "@/lib/sendblue";
import { REPS_BY_KEY, repKeyFromGhlUserId } from "./team";
import { chunk, isMissingRelation, safeFetchAllRows } from "./db";
import type { CallType } from "./types";

// ── The rubric ────────────────────────────────────────────────────────────

// Rubric narrowed by the owner (2026-08-26): exactly TWO lines are graded —
// the discovery line and the commitment line. Nothing else counts.
export type AdherenceCheckId = "discovery" | "commitment";

export const ADHERENCE_CHECKS: ReadonlyArray<{ id: AdherenceCheckId; label: string }> = [
  { id: "discovery", label: 'Discovery line ("make it worth your while")' },
  { id: "commitment", label: 'Commitment line ("any reason you wouldn\'t make it")' },
];

export interface CheckVerdict {
  id: AdherenceCheckId;
  label: string;
  applicable: boolean;
  passed: boolean;
  /** Short quote from the thread backing the verdict (may be empty). */
  evidence: string;
}

// ── Tunables ──────────────────────────────────────────────────────────────

/** Max appointments graded per run (one Claude call each — cost guard). */
const MAX_GRADES_PER_RUN = 40;
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
  discovery_asked: boolean;
  discovery_evidence: string;
  commitment_asked: boolean;
  commitment_evidence: string;
}

const VERDICT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    discovery_asked: {
      type: "boolean",
      description:
        "Did the closer's side ask the DISCOVERY line — a question in the spirit of 'so I can make it worth your while/time… what's the main thing you want help with?' Paraphrases fully count; the intent is asking what the prospect wants out of the call.",
    },
    discovery_evidence: { type: "string", description: "Short verbatim quote, or empty string." },
    commitment_asked: {
      type: "boolean",
      description:
        "Did the closer's side ask the COMMITMENT line — in the spirit of 'other than something crazy happening, is there any reason you wouldn't make it?' Paraphrases fully count; the intent is locking a commitment that they will show up.",
    },
    commitment_evidence: { type: "string", description: "Short verbatim quote, or empty string." },
  },
  required: ["discovery_asked", "discovery_evidence", "commitment_asked", "commitment_evidence"],
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
    "You grade whether a sales closer delivered TWO specific pre-call lines in an iMessage group chat with a prospect. The chat has the closer's side (closer + a ghost influencer number — both count as CLOSER SIDE) and the prospect.",
    "",
    "Only these two things are graded (exact wording is NEVER required — grade intent, paraphrases fully count):",
    "1. THE DISCOVERY LINE — canonical form: \"Quick question so I can make it worth your while… what's the main thing you want help with when we chat?\" Any question asking what the prospect wants to get out of the call, framed around making it worth their while/time, counts.",
    "2. THE COMMITMENT LINE — canonical form: \"And other than something crazy happening, is there any reason you wouldn't make it?\" Any question locking in a commitment that they will show up (barring emergencies) counts.",
    "",
    "Nothing else in the thread is graded. Ignore confirmations, reminders, pings, and small talk except as context.",
    "",
    `Call context: closer = ${args.repName}; prospect = ${args.contactName || "unknown"}.`,
    `The call was booked at ${etStamp(args.bookedAtIso)} and scheduled to start at ${etStamp(args.startIso)}.`,
    "",
    "The thread (chronological, timestamps in Eastern Time):",
    lines.length ? lines.join("\n") : "(no messages)",
    "",
    "Answer every field of the schema. Evidence fields: a SHORT verbatim quote (under 120 characters) from the closer-side message that best supports a true verdict, or an empty string when the answer is false.",
  ].join("\n");
}

// ── Assemble the verdict rows ─────────────────────────────────────────────

function buildChecks(semantic: SemanticVerdict): CheckVerdict[] {
  const label = (id: AdherenceCheckId) => ADHERENCE_CHECKS.find((c) => c.id === id)!.label;
  return [
    {
      id: "discovery",
      label: label("discovery"),
      applicable: true,
      passed: semantic.discovery_asked,
      evidence: semantic.discovery_evidence,
    },
    {
      id: "commitment",
      label: label("commitment"),
      applicable: true,
      passed: semantic.commitment_asked,
      evidence: semantic.commitment_evidence,
    },
  ];
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

  for (const [apptId, event] of queue) {
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

    // The SendBlue thread, windowed booking → start + 1h.
    const { messages: rawMessages } = await getMessages(phone, { limit: SENDBLUE_FETCH_LIMIT });
    const startMs = new Date(startIso).getTime();
    const bookedMs = new Date(bookedAtIso).getTime();
    const windowFrom = Math.min(bookedMs, startMs);
    const windowTo = startMs + THREAD_TAIL_MS;
    const messages: ThreadMessage[] = rawMessages
      .filter((m) => {
        const t = m.sentAt ? new Date(m.sentAt).getTime() : NaN;
        return Number.isFinite(t) && t >= windowFrom && t <= windowTo;
      })
      .sort((a, b) => new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime())
      .map((m) => ({ content: m.content, direction: m.direction, sentAt: m.sentAt }));

    if (messages.length === 0) {
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

    // The one semantic Claude call.
    const semantic = await askClaudeForVerdict(
      buildPrompt({
        repName: (repKey && REPS_BY_KEY[repKey]?.name) || "the closer",
        contactName: appt?.contact_name ?? null,
        bookedAtIso,
        startIso,
        messages,
      }),
    );
    if (!semantic) {
      base.claude_failed += 1;
      continue; // no row — a later run retries this appointment
    }

    const checks = buildChecks(semantic);
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

  return base;
}
