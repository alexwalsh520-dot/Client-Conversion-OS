// Tracker Autofill — SHADOW MODE.
//
// For every sales-tracker row it works out what the system would write in the
// closer's admin cells (Call Taken, Recorded, Call Length, Recording Link,
// Outcome, Cash Collected, Method, Program Length, Objection, Call Notes),
// with the SOURCE and CERTAINTY of each cell, and compares it with what the
// closer actually typed. Results go to tracker_autofill_shadow and a daily
// side-by-side report goes to #a-sales-manager. The Google Sheet is never
// touched unless TRACKER_AUTOFILL_WRITE=1 (see applyToSheet).
//
// Certainty rule (Matthew, 2026-09-19): a cell is written only from a hard
// key; everything else is an "ask" for a human. Hard keys:
//   tracker row  -> GHL appointment   by normalized name + date (+-1 day), must be unique
//   appointment  -> Fathom recording  by invitee EMAIL (never name)
//   appointment  -> Stripe charge     by billing EMAIL on The Forge LLP account
//   appointment  -> GHL status        cancelled / rescheduled (later booking, same contact)
import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { postAsCso } from "@/lib/slack";
import { addDays, etDate, etDateFromIso, normalizeName, closerDisplayName } from "@/lib/call-review-context";
import { clip, money, pct } from "@/lib/call-review-format";
import { getThreadMessages } from "@/lib/sendblue";

type Sb = SupabaseClient;

export type Certainty = "hard" | "ask" | "none";
export interface Cell { value: string | number | null; source: string; certainty: Certainty; evidence?: string }
export type Column =
  | "call_taken" | "recorded" | "call_length" | "recording_link" | "outcome"
  | "cash_collected" | "payment_method" | "program_length" | "objection" | "call_notes";
export const COLUMNS: Column[] = [
  "call_taken", "recorded", "call_length", "recording_link", "outcome",
  "cash_collected", "payment_method", "program_length", "objection", "call_notes",
];
export type Compare = "agree" | "disagree" | "system_blank" | "closer_blank" | "both_blank" | "ask";

export interface Proposal {
  sheet_row_key: string;
  row_date: string;
  prospect: string | null;
  closer: string | null;
  identity: { method: "name+date" | "ambiguous" | "none"; appointment_id?: string; email?: string; phone?: string; candidates?: number };
  cells: Record<Column, Cell>;
  current: Record<Column, string | number | null>;
  compare: Record<Column, Compare>;
  asks: string[];
}

/* --------------------------------- inputs --------------------------------- */

interface TrackerRow {
  sheet_row_key: string; date: string; call_number: string | null; prospect_name: string | null; prospect_name_normalized: string | null;
  call_taken_status: string | null; call_length: string | null; recorded: boolean | null; outcome: string | null; closer: string | null;
  objection: string | null; program_length: string | null; collected_revenue_cents: number | null; payment_method: string | null;
  call_notes: string | null; recording_link: string | null;
}
interface Appointment {
  appointment_id: string; contact_id: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  start_time: string; status: string | null; calendar_name: string | null; created_at: string;
}
interface FathomRow { fathom_id: string; title: string | null; recorded_at: string | null; duration_sec: number | null; prospect_name: string | null; attendees: unknown; raw: unknown }
interface Charge {
  id: string; amount: number; created: number; paid: boolean; refunded: boolean; invoice: string | null; description: string | null;
  billing_details?: { email?: string | null; phone?: string | null; name?: string | null };
  receipt_email?: string | null;
  payment_method_details?: { type?: string };
  metadata?: Record<string, string>;
}
interface ReviewRow { fathom_id: string; outcome: string | null; fields: Record<string, unknown> | null }

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Charges on The Forge LLP account (where coaching is paid). Never synced
 *  into stripe_payments — that table only mirrors the Subscriptions account. */
export async function fetchLlpCharges(createdFromSec: number): Promise<Charge[]> {
  const key = process.env.STRIPE_KEY_TYSON_LLP;
  if (!key) return [];
  const out: Charge[] = [];
  let starting: string | null = null;
  for (let page = 0; page < 10; page++) {
    const u = new URL("https://api.stripe.com/v1/charges");
    u.searchParams.set("limit", "100");
    u.searchParams.set("created[gte]", String(createdFromSec));
    if (starting) u.searchParams.set("starting_after", starting);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`stripe llp http ${res.status}`);
    const json = (await res.json()) as { data: Charge[]; has_more: boolean };
    out.push(...json.data);
    if (!json.has_more || json.data.length === 0) break;
    starting = json.data[json.data.length - 1].id;
  }
  return out;
}

/** #call-updates messages in a window (bot must be a member; it is). */
async function fetchCallUpdates(fromIso: string, toIso: string): Promise<{ ts: string; text: string }[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_CALL_UPDATES || "C09KKCU3S65";
  if (!token) return [];
  const out: { ts: string; text: string }[] = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const u = new URL("https://slack.com/api/conversations.history");
    u.searchParams.set("channel", channel);
    u.searchParams.set("oldest", String(Date.parse(fromIso) / 1000));
    u.searchParams.set("latest", String(Date.parse(toIso) / 1000));
    u.searchParams.set("limit", "200");
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = (await res.json()) as { ok: boolean; messages?: { ts: string; text?: string }[]; response_metadata?: { next_cursor?: string } };
    if (!json.ok) break;
    out.push(...(json.messages || []).map((m) => ({ ts: m.ts, text: m.text || "" })));
    cursor = json.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  return out;
}

/* --------------------------------- rules ---------------------------------- */

const SALES_CALENDAR_RE = /strategy session|onboarding/i;
const MIN_COACHING_CENTS = 10000; // below this it is the $50 app, not a call sale

function emailsOf(attendees: unknown): string[] {
  return Array.isArray(attendees)
    ? (attendees as { email?: string }[]).map((a) => String(a?.email || "").trim().toLowerCase()).filter(Boolean)
    : [];
}

function methodFromCharge(c: Charge): { value: string | null; certainty: Certainty; evidence: string } {
  const t = c.payment_method_details?.type || "";
  if (t === "affirm") return { value: "AFFIRM", certainty: "hard", evidence: "Stripe payment method affirm" };
  if (t === "klarna") return { value: "KLARNA", certainty: "hard", evidence: "Stripe payment method klarna" };
  if (c.invoice) return { value: "MONTHLY", certainty: "hard", evidence: `Stripe ${t} on a subscription invoice` };
  if (t === "card" || t === "link" || t === "cashapp") return { value: "PIF", certainty: "ask", evidence: `Stripe one-off ${t} charge — PIF or in-house plan (I.H.P.P.)?` };
  return { value: null, certainty: "ask", evidence: `Stripe payment method ${t || "unknown"}` };
}

function programFromCharge(c: Charge): { value: string | null; certainty: Certainty; evidence: string } {
  const text = `${c.description || ""} ${Object.values(c.metadata || {}).join(" ")}`;
  const m = text.match(/(\d{1,2})\s*-?\s*(week|wk|month|mo)/i);
  if (m) {
    const n = Number(m[1]);
    const months = /month|mo/i.test(m[2]) ? n : Math.round(n / 4);
    return { value: String(months), certainty: "hard", evidence: `Stripe description "${clip(text, 60)}"` };
  }
  if (c.invoice) return { value: "Subscription", certainty: "hard", evidence: "Stripe subscription invoice" };
  return { value: null, certainty: "ask", evidence: "program length not on the Stripe charge" };
}

const OBJECTION_MAP: Record<string, string> = {
  price: "Money", timing: "Think about it", spouse: "Partner", skepticism: "Think about it", competitor: "Competitor",
  identity: "Other", authority: "Partner", fit: "Not a fit", other: "Other",
};
const OUTCOME_FROM_REVIEW: Record<string, string> = { lost: "LOST", "follow-up": "PCFU", "no-show": "NS/RS" };

function blank(): Cell { return { value: null, source: "—", certainty: "none" }; }

function normOutcome(o: string | null | undefined): string {
  const s = String(o || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (s === "NO SHOW" || s === "NS-RS" || s === "NS / RS") return "NS/RS";
  return s;
}

function compareCell(col: Column, cell: Cell, current: string | number | null): Compare {
  if (cell.certainty === "ask") return "ask";
  const curBlank = current === null || current === "" || (typeof current === "number" && current === 0 && col === "cash_collected" && cell.value === null);
  const sysBlank = cell.value === null || cell.value === "";
  if (curBlank && sysBlank) return "both_blank";
  if (curBlank) return "closer_blank";
  if (sysBlank) return "system_blank";
  const a = String(cell.value).trim().toUpperCase();
  const b = String(current).trim().toUpperCase();
  if (col === "cash_collected") return Math.abs(Number(a) - Number(b)) <= 1 ? "agree" : "disagree";
  if (col === "call_length") return Math.abs(Number(a) - Number(b)) <= 3 ? "agree" : "disagree";
  if (col === "recording_link") return a.includes("FATHOM.VIDEO") && b.includes("FATHOM.VIDEO") ? "agree" : (a === b ? "agree" : "disagree");
  if (col === "call_notes") return "agree"; // free text: the closer's notes stand; ours are additive
  if (col === "outcome") return normOutcome(a) === normOutcome(b) ? "agree" : "disagree";
  if (col === "program_length") return a.replace(/[^0-9A-Z]/g, "") === b.replace(/[^0-9A-Z]/g, "") ? "agree" : "disagree";
  return a === b ? "agree" : "disagree";
}

/* --------------------------------- engine --------------------------------- */

export async function buildProposals(sb: Sb, from: string, to: string): Promise<Proposal[]> {
  const rows = await pageAll<TrackerRow>((a, b) =>
    sb.from("sales_tracker_rows")
      .select("sheet_row_key,date,call_number,prospect_name,prospect_name_normalized,call_taken_status,call_length,recorded,outcome,closer,objection,program_length,collected_revenue_cents,payment_method,call_notes,recording_link")
      .gte("date", from).lte("date", to).range(a, b)
  );
  const callRows = rows.filter((r) => !/^sub/i.test(String(r.call_number || "")));
  const appts = await pageAll<Appointment>((a, b) =>
    sb.from("ghl_appointments")
      .select("appointment_id,contact_id,contact_name,contact_email,contact_phone,start_time,status,calendar_name,created_at")
      .gte("start_time", `${addDays(from, -1)}T00:00:00Z`).lte("start_time", `${addDays(to, 2)}T23:59:59Z`).range(a, b)
  );
  const allApptsByContact = await pageAll<Appointment>((a, b) =>
    sb.from("ghl_appointments")
      .select("appointment_id,contact_id,contact_name,contact_email,contact_phone,start_time,status,calendar_name,created_at")
      .gte("start_time", `${from}T00:00:00Z`).range(a, b)
  );
  const fathom = await pageAll<FathomRow>((a, b) =>
    sb.from("fathom_calls").select("fathom_id,title,recorded_at,duration_sec,prospect_name,attendees,raw")
      .gte("recorded_at", `${addDays(from, -1)}T00:00:00Z`).lte("recorded_at", `${addDays(to, 1)}T23:59:59Z`).range(a, b)
  );
  const fathomIds = fathom.map((f) => f.fathom_id);
  const { data: reviewsData } = fathomIds.length
    ? await sb.from("mm_call_reviews").select("fathom_id,outcome,fields").in("fathom_id", fathomIds)
    : { data: [] as ReviewRow[] };
  const reviews: Record<string, ReviewRow> = {};
  for (const r of (reviewsData || []) as ReviewRow[]) reviews[r.fathom_id] = r;

  let charges: Charge[] = [];
  try { charges = await fetchLlpCharges(Math.floor(Date.parse(`${addDays(from, -1)}T00:00:00Z`) / 1000)); } catch { /* cash cells become asks */ }
  const chargesByEmail: Record<string, Charge[]> = {};
  for (const c of charges) {
    if (!c.paid || c.refunded) continue;
    const e = String(c.billing_details?.email || c.receipt_email || "").toLowerCase();
    if (e) (chargesByEmail[e] = chargesByEmail[e] || []).push(c);
  }
  let updates: { ts: string; text: string }[] = [];
  try { updates = await fetchCallUpdates(`${from}T00:00:00Z`, `${addDays(to, 1)}T23:59:59Z`); } catch { /* evidence only */ }

  const apptsByName: Record<string, Appointment[]> = {};
  for (const a of appts) {
    if (!SALES_CALENDAR_RE.test(String(a.calendar_name || ""))) continue;
    (apptsByName[normalizeName(a.contact_name)] = apptsByName[normalizeName(a.contact_name)] || []).push(a);
  }
  const fathomByEmail: Record<string, FathomRow[]> = {};
  for (const f of fathom) for (const e of emailsOf(f.attendees)) (fathomByEmail[e] = fathomByEmail[e] || []).push(f);

  const out: Proposal[] = [];
  let sendblueBudget = 12;
  for (const r of callRows) {
    const cells = Object.fromEntries(COLUMNS.map((c) => [c, blank()])) as Record<Column, Cell>;
    const asks: string[] = [];
    const current: Record<Column, string | number | null> = {
      call_taken: r.call_taken_status === "yes" ? "yes" : r.call_taken_status === "no" ? "no" : null,
      recorded: r.recorded === true ? "yes" : r.recorded === false ? null : null,
      call_length: r.call_length ? Number(String(r.call_length).replace(/[^0-9.]/g, "")) || null : null,
      recording_link: r.recording_link || null,
      outcome: r.outcome || null,
      cash_collected: r.collected_revenue_cents ? Math.round(Number(r.collected_revenue_cents) / 100) : null,
      payment_method: r.payment_method || null,
      program_length: r.program_length || null,
      objection: r.objection || null,
      call_notes: r.call_notes || null,
    };

    // 1. Identity: tracker row -> unique appointment by name + date (+-1 day).
    const cands = (apptsByName[normalizeName(r.prospect_name_normalized || r.prospect_name)] || []).filter((a) => {
      const d = etDateFromIso(a.start_time);
      return d === r.date || d === addDays(r.date, -1) || d === addDays(r.date, 1);
    });
    const sameDay = cands.filter((a) => etDateFromIso(a.start_time) === r.date);
    const appt = sameDay.length === 1 ? sameDay[0] : cands.length === 1 ? cands[0] : null;
    const identity: Proposal["identity"] = appt
      ? { method: "name+date", appointment_id: appt.appointment_id, email: appt.contact_email || undefined, phone: appt.contact_phone || undefined }
      : cands.length > 1 ? { method: "ambiguous", candidates: cands.length } : { method: "none" };

    if (!appt) {
      asks.push(identity.method === "ambiguous"
        ? `${r.prospect_name}: ${cands.length} GHL bookings match this name and date — which one is this row?`
        : `${r.prospect_name}: no GHL booking found by name on ${r.date} — cannot key this row to a recording or a payment`);
      for (const c of COLUMNS) cells[c] = { value: null, source: "no identity", certainty: "ask" };
    } else {
      const email = String(appt.contact_email || "").toLowerCase();
      const apptMs = Date.parse(appt.start_time);

      // 2. Recording by invitee email, within 6h of the booking.
      const rec = (email ? fathomByEmail[email] || [] : [])
        .filter((f) => f.recorded_at && Math.abs(Date.parse(f.recorded_at) - apptMs) <= 6 * 3600e3)
        .sort((a, b) => Math.abs(Date.parse(a.recorded_at!) - apptMs) - Math.abs(Date.parse(b.recorded_at!) - apptMs))[0] || null;
      const shareUrl = rec ? ((rec.raw as { share_url?: string } | null)?.share_url || null) : null;
      if (rec) {
        cells.call_taken = { value: "yes", source: "Fathom recording (invitee email match)", certainty: "hard", evidence: rec.fathom_id };
        cells.recorded = { value: "yes", source: "Fathom", certainty: "hard" };
        // Reps often hit record before the prospect joins (still on the team
        // huddle), so the length is measured from the LATER of recording start
        // and booking start to recording end.
        // When the recording started more than 3 minutes before the booking we
        // cannot tell huddle minutes from call minutes, so the length is an ask.
        const recStart = Date.parse(rec.recorded_at!);
        const early = recStart < apptMs - 3 * 60000;
        const lengthMin = rec.duration_sec ? Math.round(rec.duration_sec / 60) : null;
        cells.call_length = { value: lengthMin, source: early ? "Fathom duration (recording started early)" : "Fathom duration", certainty: !lengthMin ? "none" : early ? "ask" : "hard" };
        if (early && lengthMin) asks.push(`${r.prospect_name}: recording started ${Math.round((apptMs - recStart) / 60000)} min before the booking — is ${lengthMin} min the real call length?`);
        cells.recording_link = { value: shareUrl, source: "Fathom share URL", certainty: shareUrl ? "hard" : "none" };
      } else {
        const byName = fathom.find((f) => normalizeName(f.prospect_name) === normalizeName(r.prospect_name) && etDateFromIso(f.recorded_at) === r.date);
        if (byName) {
          cells.call_taken = { value: "yes", source: "Fathom recording (name match only)", certainty: "ask", evidence: `recording ${byName.fathom_id} matches the name but not the booking email` };
          asks.push(`${r.prospect_name}: a recording matches by name only (booking email ${email || "missing"}) — confirm it is this call`);
        }
      }

      // 3. Payment by billing email on the LLP account, from a day before to 3 days after the call.
      const paid = (email ? chargesByEmail[email] || [] : []).filter((c) =>
        c.amount >= MIN_COACHING_CENTS && c.created * 1000 >= apptMs - 86400e3 && c.created * 1000 <= apptMs + 3 * 86400e3);
      if (!paid.length) {
        // Same person, different email on the card: never written, always asked.
        const byName = charges.filter((c) => c.paid && !c.refunded && c.amount >= MIN_COACHING_CENTS &&
          normalizeName(c.billing_details?.name) === normalizeName(r.prospect_name) &&
          c.created * 1000 >= apptMs - 86400e3 && c.created * 1000 <= apptMs + 3 * 86400e3);
        if (byName.length) {
          const total = byName.reduce((s, c) => s + c.amount, 0);
          cells.outcome = { value: "WIN", source: "Stripe charge by NAME only (different email)", certainty: "ask", evidence: byName.map((c) => c.id).join(",") };
          cells.cash_collected = { value: Math.round(total / 100), source: "Stripe charge by NAME only", certainty: "ask" };
          asks.push(`${r.prospect_name}: a Stripe charge of ${money(total)} matches the name but the card email (${byName[0].billing_details?.email || "?"}) differs from the booking email (${email || "missing"}) — same person?`);
        }
      }
      if (paid.length) {
        const total = paid.reduce((s, c) => s + c.amount, 0);
        cells.outcome = { value: "WIN", source: "Stripe LLP charge (billing email match)", certainty: "hard", evidence: paid.map((c) => c.id).join(",") };
        cells.cash_collected = { value: Math.round(total / 100), source: "Stripe LLP amount", certainty: "hard", evidence: `${paid.length} charge(s), $${(total / 100).toFixed(2)}` };
        const m = methodFromCharge(paid[0]);
        cells.payment_method = { value: m.value, source: "Stripe payment method", certainty: m.certainty, evidence: m.evidence };
        if (m.certainty === "ask") asks.push(`${r.prospect_name}: paid ${money(total)} by ${paid[0].payment_method_details?.type || "?"} — PIF or in-house payment plan?`);
        const p = programFromCharge(paid[0]);
        cells.program_length = { value: p.value, source: "Stripe", certainty: p.certainty, evidence: p.evidence };
        if (p.certainty === "ask") asks.push(`${r.prospect_name}: program length not on the Stripe charge — how many months?`);
        if (!rec) {
          cells.call_taken = { value: "yes", source: "paid after the booking", certainty: "hard", evidence: "Stripe charge within 3 days" };
        }
      }

      // 4. Cancelled / rescheduled from GHL; otherwise no-show is an ask.
      // A reschedule is a LATER booking on the SAME calendar. A later booking on
      // the Onboarding calendar after a Strategy Session is the opposite: a win.
      const laterSameContact = allApptsByContact.filter((a) =>
        a.contact_id === appt.contact_id && a.appointment_id !== appt.appointment_id &&
        Date.parse(a.created_at) > Date.parse(appt.created_at) && Date.parse(a.start_time) > apptMs &&
        String(a.calendar_name || "").toLowerCase() === String(appt.calendar_name || "").toLowerCase());
      const laterOnboarding = /strategy/i.test(String(appt.calendar_name || "")) && allApptsByContact.some((a) =>
        a.contact_id === appt.contact_id && Date.parse(a.created_at) > Date.parse(appt.created_at) && /onboarding/i.test(String(a.calendar_name || "")));
      if (!rec && !paid.length) {
        if (String(appt.status || "").toLowerCase() === "cancelled") {
          cells.outcome = { value: "CANCELLED", source: "GHL appointment status", certainty: "hard" };
          cells.call_taken = { value: "no", source: "GHL cancelled", certainty: "hard" };
        } else if (laterSameContact.length) {
          cells.outcome = { value: "NS/RS", source: "GHL: later booking on the same calendar", certainty: "hard", evidence: laterSameContact[0].appointment_id };
          cells.call_taken = { value: "no", source: "rescheduled", certainty: "hard" };
        } else if (laterOnboarding && cells.outcome.certainty === "none") {
          cells.call_taken = { value: "yes", source: "onboarding call booked afterwards", certainty: "ask" };
          cells.outcome = { value: "WIN", source: "onboarding call booked afterwards, no Stripe match", certainty: "ask" };
          asks.push(`${r.prospect_name}: an Onboarding Call was booked after this Strategy Session but no recording and no Stripe charge matched — did they buy, and through what?`);
        } else if (Date.now() > apptMs + 2 * 3600e3) {
          const first = normalizeName(r.prospect_name).split(" ")[0];
          const mentions = updates.filter((u) => first && u.text.toLowerCase().includes(first)).slice(0, 3).map((u) => clip(u.text, 100));
          let sms = "";
          if (appt.contact_phone && sendblueBudget > 0) {
            sendblueBudget -= 1;
            try {
              const t = await getThreadMessages(appt.contact_phone, { limit: 8 });
              sms = (t.messages || []).slice(-4).map((m: { content?: string; text?: string }) => clip(m.content || m.text || "", 80)).filter(Boolean).join(" | ");
            } catch { /* evidence only */ }
          }
          const ev = [mentions.length ? `#call-updates: ${mentions.join(" / ")}` : "", sms ? `SendBlue: ${sms}` : ""].filter(Boolean).join(" ; ");
          cells.call_taken = { value: "no", source: "no recording, no payment, no reschedule", certainty: "ask", evidence: ev || "no evidence found" };
          cells.outcome = { value: "NS/RS", source: "inferred", certainty: "ask", evidence: ev || undefined };
          asks.push(`${r.prospect_name} (${closerDisplayName(r.closer) || r.closer}): no recording, no payment, no reschedule — no-show?${ev ? ` Evidence: ${clip(ev, 160)}` : ""}`);
        }
      }

      // 5. Call happened, nobody paid: outcome + objection are the closer's call, prefilled from Jeremy.
      const rev = rec ? reviews[rec.fathom_id] : undefined;
      if (rec && !paid.length) {
        const guess = OUTCOME_FROM_REVIEW[String(rev?.outcome || "")] || null;
        cells.outcome = { value: guess, source: "Jeremy's read of the call", certainty: "ask", evidence: rev ? `review outcome ${rev.outcome}` : "no review yet" };
        asks.push(`${r.prospect_name} (${closerDisplayName(r.closer) || r.closer}): call happened, no payment in 3 days — LOST / PCFU / NOT A FIT?${guess ? ` Jeremy read it as ${guess}.` : ""}`);
      }
      if (rev) {
        const objs = Array.isArray(rev.fields?.objections_raised) ? (rev.fields!.objections_raised as { category?: string }[]) : [];
        const cat = objs[0]?.category ? OBJECTION_MAP[String(objs[0].category)] || "Other" : null;
        cells.objection = { value: cat, source: "Jeremy's top objection", certainty: cat ? "ask" : "none", evidence: objs[0]?.category };
        const summary = typeof rev.fields?.call_summary === "string" ? rev.fields.call_summary : null;
        if (summary) cells.call_notes = { value: `[AI] ${clip(summary, 600)}`, source: "Jeremy call summary", certainty: "hard" };
      }
    }

    const compare = Object.fromEntries(COLUMNS.map((c) => [c, compareCell(c, cells[c], current[c])])) as Record<Column, Compare>;
    out.push({ sheet_row_key: r.sheet_row_key, row_date: r.date, prospect: r.prospect_name, closer: r.closer, identity, cells, current, compare, asks });
  }
  return out;
}

export async function storeProposals(sb: Sb, proposals: Proposal[]): Promise<string | null> {
  if (!proposals.length) return null;
  const { error } = await sb.from("tracker_autofill_shadow").upsert(
    proposals.map((p) => ({ sheet_row_key: p.sheet_row_key, row_date: p.row_date, prospect: p.prospect, closer: p.closer, proposal: p, updated_at: new Date().toISOString() })),
    { onConflict: "sheet_row_key" }
  );
  return error ? error.message : null;
}

/* --------------------------------- report --------------------------------- */

const COL_LABEL: Record<Column, string> = {
  call_taken: "Call Taken", recorded: "Recorded", call_length: "Call Length", recording_link: "Recording Link", outcome: "Outcome",
  cash_collected: "Cash Collected", payment_method: "Method", program_length: "Program Length", objection: "Objection", call_notes: "Call Notes",
};

/** Side-by-side: what the system would have written vs what the closers typed. */
export function renderShadowReport(from: string, to: string, proposals: Proposal[]): string {
  const rows = proposals.filter((p) => p.identity.method !== "none" || p.current.call_taken !== null);
  const tally: Record<Column, Record<Compare, number>> = Object.fromEntries(COLUMNS.map((c) => [c, { agree: 0, disagree: 0, system_blank: 0, closer_blank: 0, both_blank: 0, ask: 0 }])) as Record<Column, Record<Compare, number>>;
  for (const p of proposals) for (const c of COLUMNS) tally[c][p.compare[c]] += 1;
  const identity = { hard: proposals.filter((p) => p.identity.method === "name+date").length, ambiguous: proposals.filter((p) => p.identity.method === "ambiguous").length, none: proposals.filter((p) => p.identity.method === "none").length };
  const lines = [
    `*TRACKER AUTOFILL — SHADOW* | ${from} to ${to} | sheet untouched`,
    `${proposals.length} tracker rows | keyed to a GHL booking: ${identity.hard} | ambiguous: ${identity.ambiguous} | no booking found: ${identity.none}`,
    `_agree = system value matches the closer's; ask = the system would have asked a human instead of writing_`,
    "",
    "*PER COLUMN* (agree / disagree / closer blank & system has it / system blank & closer has it / asks)",
  ];
  for (const c of COLUMNS) {
    const t = tally[c];
    const decided = t.agree + t.disagree;
    lines.push(`*${COL_LABEL[c]}* ${t.agree}/${t.disagree}/${t.closer_blank}/${t.system_blank}/${t.ask}${decided ? ` — ${pct(Math.round((t.agree / decided) * 100))} agree` : ""}`);
  }
  const disagreements = proposals.flatMap((p) => COLUMNS.filter((c) => p.compare[c] === "disagree").map((c) =>
    `${p.prospect} (${closerDisplayName(p.closer) || p.closer}) ${COL_LABEL[c]}: closer "${clip(p.current[c], 30)}" vs system "${clip(p.cells[c].value, 30)}" — ${p.cells[c].source}`));
  lines.push("", `*DISAGREEMENTS* (${disagreements.length})`, ...(disagreements.length ? disagreements.slice(0, 15) : ["None"]));
  const asks = proposals.flatMap((p) => p.asks);
  lines.push("", `*WOULD HAVE ASKED* (${asks.length})`, ...(asks.length ? asks.slice(0, 12).map((a) => clip(a, 220)) : ["None"]));
  void rows;
  return lines.join("\n");
}

export async function runShadow(sb: Sb, opts: { from?: string; to?: string; report?: boolean } = {}) {
  const to = opts.to || etDate();
  const from = opts.from || addDays(to, opts.report ? -7 : -3);
  const out: Record<string, unknown> = { from, to };
  try {
    const proposals = await buildProposals(sb, from, to);
    out.rows = proposals.length;
    out.stored = (await storeProposals(sb, proposals)) || "ok";
    if (opts.report) {
      const text = renderShadowReport(from, to, proposals);
      out.posted = await postAsCso(text.length > 3900 ? text.slice(0, 3900) + "\n(Trimmed for Slack.)" : text).catch(() => false);
    }
  } catch (e) {
    out.error = String(e).slice(0, 300);
  }
  return out;
}

/* --------------------------- write path (DORMANT) -------------------------- */

const TRACKER_SPREADSHEET_ID = "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o";
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const HEADER_FOR: Record<Column, string[]> = {
  call_taken: ["Call Taken"], recorded: ["Recorded"], call_length: ["Call Length"], recording_link: ["Call Recording Link", "Recording Link"],
  outcome: ["Outcome"], cash_collected: ["Cash Collected"], payment_method: ["Method"], program_length: ["Program Length", "Program Length Months"],
  objection: ["Objection"], call_notes: ["Call Notes"],
};

function colLetter(i: number): string {
  let s = ""; let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Writes HARD cells that are currently BLANK on the sheet. Never overwrites a
 * closer's value, never writes an "ask". Refuses to run unless
 * TRACKER_AUTOFILL_WRITE=1 — the switch Matthew flips when the shadow report
 * has proven itself. Requires the service account to be an editor on the sheet.
 */
export async function applyToSheet(proposals: Proposal[]): Promise<{ written: number; skipped: string[] }> {
  if (process.env.TRACKER_AUTOFILL_WRITE !== "1") return { written: 0, skipped: ["TRACKER_AUTOFILL_WRITE is not 1 — shadow mode"] };
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) return { written: 0, skipped: ["service account env missing"] };
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const skipped: string[] = [];
  let written = 0;
  const byTab: Record<string, Proposal[]> = {};
  for (const p of proposals) (byTab[MONTHS[Number(p.row_date.slice(5, 7)) - 1]] = byTab[MONTHS[Number(p.row_date.slice(5, 7)) - 1]] || []).push(p);
  for (const [tab, ps] of Object.entries(byTab)) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKER_SPREADSHEET_ID, range: `${tab}!A1:AZ2000` });
    const values = (res.data.values || []) as string[][];
    // The tracker's header row is not row 1 (row 1 holds the month summary);
    // find the first row that carries both "Name" and "Outcome".
    const headerRow = values.findIndex((row) => {
      const cells = row.map((h) => String(h || "").trim().toLowerCase());
      return cells.includes("name") && cells.includes("outcome");
    });
    if (headerRow < 0) { skipped.push(`${tab}: header row not found`); continue; }
    const headers = values[headerRow].map((h) => String(h || "").trim().toLowerCase());
    const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h === n.toLowerCase()));
    const dateI = idx(["Date"]); const nameI = idx(["Name"]); const numI = idx(["Call #", "Call Number", "Call"]);
    const updates: { range: string; values: string[][] }[] = [];
    for (const p of ps) {
      const rowI = values.findIndex((row, i) => i > headerRow &&
        normalizeName(row[nameI]) === normalizeName(p.prospect) &&
        (numI < 0 || !p.sheet_row_key.includes(":call-") || String(row[numI] || "").toLowerCase().replace(/\s+/g, "-") === p.sheet_row_key.split(":")[1]) &&
        String(row[dateI] || "").includes(p.row_date.slice(8, 10).replace(/^0/, "")));
      if (rowI < 0) { skipped.push(`${p.prospect}: row not found in ${tab}`); continue; }
      for (const c of COLUMNS) {
        const cell = p.cells[c];
        if (cell.certainty !== "hard" || cell.value === null || cell.value === "") continue;
        const ci = idx(HEADER_FOR[c]);
        if (ci < 0) continue;
        if (String(values[rowI][ci] || "").trim()) continue; // never overwrite a human
        updates.push({ range: `${tab}!${colLetter(ci)}${rowI + 1}`, values: [[String(cell.value)]] });
      }
    }
    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: TRACKER_SPREADSHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: updates } });
      written += updates.length;
    }
  }
  return { written, skipped };
}
