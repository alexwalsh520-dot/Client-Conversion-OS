// Call Review Autopilot — context assembly.
//
// Everything the reviewer (Jeremy) needs beyond the transcript lives here:
// which Fathom keys we hold (one per closer), the sales-tracker row for the
// call (outcome / cash / setter / objection tag), the setter's Instagram DM
// thread with the prospect, the closer's recent grade history, and the
// tracker day stats that head the nightly digest.
//
// Every function here is either pure (unit-tested) or a thin Supabase read
// with its own try/catch at the call site. Nothing here posts to Slack.
import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient;

/* ------------------------------ closers & keys ------------------------------ */

// Tracker codes (the sheet's Closer column) -> display name used in reviews.
// Aliases cover the Fathom account names and how reps introduce themselves.
const CLOSER_ALIASES: Record<string, string[]> = {
  WILL: ["will", "rincan", "william"],
  BROZ: ["broz", "broze", "jacob"],
  CHRIS: ["chris", "jolivette", "christopher"],
  WOBBE: ["wobbe", "wobby", "andrew"],
  AUSTIN: ["austin", "richard"],
  ERIN: ["erin", "ireland"],
};
const CLOSER_DISPLAY: Record<string, string> = {
  WILL: "Will", BROZ: "Broz", CHRIS: "Chris", WOBBE: "Wobbe", AUSTIN: "Austin", ERIN: "Erin",
};

/** "WILL" -> "Will". Unknown codes are title-cased so a new rep still reads well. */
export function closerDisplayName(code: string | null | undefined): string | null {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  if (CLOSER_DISPLAY[c]) return CLOSER_DISPLAY[c];
  return c.charAt(0) + c.slice(1).toLowerCase();
}

/** "Will Rincan" / "will@thefitnessprotocol.com" / "Jacob Broz" -> tracker code. */
export function closerCodeFromName(name: string | null | undefined): string | null {
  const tokens = String(name || "").toLowerCase().replace(/@.*$/, "").split(/[^a-z]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  for (const [code, aliases] of Object.entries(CLOSER_ALIASES)) {
    if (tokens.some((t) => aliases.includes(t))) return code;
  }
  return null;
}

export interface FathomKey {
  label: string; // "TEAM" for the shared key, else the closer code (WILL, BROZ, ...)
  key: string;
  closerCode: string | null;
}

/**
 * Every Fathom API key we hold. Fathom keys are per USER — a key only lists the
 * meetings that user recorded — so one key per closer is the only way to see
 * the whole team's calls. Closer keys are FATHOM_API_KEY_<CODE>; the legacy
 * shared FATHOM_API_KEY (Matthew's account) is labelled TEAM and carries no
 * closer attribution.
 */
export function fathomKeys(env: NodeJS.ProcessEnv = process.env): FathomKey[] {
  const out: FathomKey[] = [];
  for (const [name, value] of Object.entries(env)) {
    const m = name.match(/^FATHOM_API_KEY_([A-Z0-9]+)$/);
    if (!m || !value?.trim()) continue;
    if (m[1] === "ONBOARDING") continue; // Nicole's client-onboarding account, not sales
    out.push({ label: m[1], key: value.trim(), closerCode: m[1] });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  if (env.FATHOM_API_KEY?.trim()) out.push({ label: "TEAM", key: env.FATHOM_API_KEY.trim(), closerCode: null });
  return out;
}

/* --------------------------------- dates ---------------------------------- */

export function etDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function etDateFromIso(iso: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? etDate(new Date(ms)) : null;
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------ tracker match ------------------------------ */

export function normalizeName(s: string | null | undefined): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

export interface TrackerRow {
  date: string;
  prospect_name: string | null;
  prospect_name_normalized: string | null;
  call_taken_status: string | null;
  outcome: string | null;
  closer: string | null;
  setter: string | null;
  objection: string | null;
  program_length: string | null;
  payment_method: string | null;
  contracted_revenue_cents: number | null;
  collected_revenue_cents: number | null;
  call_notes: string | null;
  recording_link: string | null;
  manychat_subscriber_id: string | null;
  offer: string | null;
}

export const TRACKER_COLS =
  "date,prospect_name,prospect_name_normalized,call_taken_status,outcome,closer,setter,objection,program_length,payment_method,contracted_revenue_cents,collected_revenue_cents,call_notes,recording_link,manychat_subscriber_id,offer";

/**
 * Pick the tracker row for a call. Pure so it can be tested. Scoring:
 * exact normalized name = 3, first+last tokens both present = 2, last name
 * only = 1; +1 same day, +1 same closer. Needs >= 2 to count as a match so a
 * shared first name on a different day never binds.
 */
export function pickTrackerRow(
  rows: TrackerRow[],
  prospect: string | null,
  callDateEt: string | null,
  closerCode: string | null
): TrackerRow | null {
  const p = normalizeName(prospect);
  if (!p) return null;
  const tokens = p.split(" ");
  const first = tokens[0];
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  let best: { row: TrackerRow; score: number } | null = null;
  for (const row of rows) {
    const n = row.prospect_name_normalized || normalizeName(row.prospect_name);
    if (!n) continue;
    let score = 0;
    if (n === p) score = 3;
    else {
      const rt = n.split(" ");
      const hasFirst = rt.includes(first);
      const hasLast = last ? rt.includes(last) : false;
      if (hasFirst && hasLast) score = 2;
      else if (hasLast && last && last.length >= 4) score = 1;
      else if (hasFirst && rt.length === 1 && tokens.length === 1) score = 2;
    }
    if (score === 0) continue;
    if (callDateEt && row.date === callDateEt) score += 1;
    if (closerCode && String(row.closer || "").toUpperCase() === closerCode) score += 1;
    if (!best || score > best.score) best = { row, score };
  }
  return best && best.score >= 2 ? best.row : null;
}

export async function loadTrackerRows(sb: Sb, from: string, to: string): Promise<TrackerRow[]> {
  const { data, error } = await sb
    .from("sales_tracker_rows")
    .select(TRACKER_COLS)
    .gte("date", from)
    .lte("date", to)
    .limit(1000);
  if (error) throw new Error(`sales_tracker_rows: ${error.message}`);
  return (data || []) as unknown as TrackerRow[];
}

export async function findTrackerRow(
  sb: Sb,
  a: { prospect: string | null; callDateEt: string | null; closerCode: string | null }
): Promise<TrackerRow | null> {
  if (!a.prospect || !a.callDateEt) return null;
  const rows = await loadTrackerRows(sb, addDays(a.callDateEt, -1), addDays(a.callDateEt, 1));
  return pickTrackerRow(rows, a.prospect, a.callDateEt, a.closerCode);
}

/** Tracker outcome -> the review outcome vocabulary the app already uses. */
export function outcomeFromTracker(outcome: string | null | undefined): string | null {
  const o = String(outcome || "").trim().toUpperCase();
  if (!o) return null;
  if (o === "WIN") return "won";
  if (o === "LOST" || o.startsWith("NOT A FIT")) return "lost";
  if (o === "PCFU") return "follow-up";
  if (o.startsWith("NS") || o.includes("NO SHOW")) return "no-show";
  if (o === "CANCELLED") return "cancelled";
  return null;
}

export function callTypeFromTitle(title: string | null | undefined): "Strategy Session" | "Onboarding Call" | "Sales Call" {
  const t = String(title || "").toLowerCase();
  if (t.includes("onboarding")) return "Onboarding Call";
  if (t.includes("strategy")) return "Strategy Session";
  return "Sales Call";
}

/* --------------------------------- DM thread -------------------------------- */

export interface DmMessage {
  sent_at: string | null;
  direction: string | null;
  message_type: string | null;
  setter_name: string | null;
  body: string | null;
}

/** Render a DM thread as compact lines. Pure. Keeps the LAST `max` messages. */
export function flattenDmThread(msgs: DmMessage[], max = 80, cap = 7000): string {
  const kept = msgs.slice(-max);
  const lines = kept.map((m) => {
    const when = m.sent_at ? m.sent_at.slice(5, 16).replace("T", " ") : "";
    const who = m.direction === "inbound" ? "Prospect" : `Setter${m.setter_name ? ` (${m.setter_name})` : ""}`;
    const body = m.message_type && m.message_type !== "text" && !m.body ? `[${m.message_type}]` : String(m.body || "").replace(/\s+/g, " ").trim();
    return `[${when}] ${who}: ${body}`;
  });
  let text = lines.join("\n");
  if (text.length > cap) text = "…" + text.slice(text.length - cap);
  return text;
}

export interface DmThread { text: string; messageCount: number; via: string; igId: string }

/**
 * The setter's Instagram conversation with this prospect, before the call.
 * Resolution chain (measured 2026-09-19 on September's calls): tracker
 * manychat_subscriber_id -> instagram_lead_links.instagram_user_id (88/112
 * rows link, and every linked IG id has messages) -> dm_conversation_messages.
 * Fallbacks: metrics_leads, then instagram_lead_links by lead name.
 */
export async function loadDmThread(
  sb: Sb,
  a: { manychatSubscriberId: string | null; prospect: string | null; before: string | null }
): Promise<DmThread | null> {
  let igId: string | null = null;
  let via = "";
  if (a.manychatSubscriberId) {
    const { data } = await sb.from("instagram_lead_links")
      .select("instagram_user_id").eq("manychat_subscriber_id", a.manychatSubscriberId).limit(1);
    igId = (data?.[0]?.instagram_user_id as string | undefined) || null;
    via = "instagram_lead_links";
    if (!igId) {
      const { data: ml } = await sb.from("metrics_leads")
        .select("ig_scoped_id").eq("manychat_subscriber_id", a.manychatSubscriberId).limit(1);
      igId = (ml?.[0]?.ig_scoped_id as string | undefined) || null;
      via = "metrics_leads";
    }
  }
  if (!igId && a.prospect) {
    const { data } = await sb.from("instagram_lead_links")
      .select("instagram_user_id,lead_name").ilike("lead_name", a.prospect.trim()).limit(3);
    const exact = (data || []).find((r) => normalizeName(r.lead_name as string) === normalizeName(a.prospect));
    igId = (exact?.instagram_user_id as string | undefined) || null;
    via = "lead_name";
  }
  if (!igId) return null;
  let q = sb.from("dm_conversation_messages")
    .select("sent_at,direction,message_type,setter_name,body")
    .eq("subscriber_id", igId)
    .order("sent_at", { ascending: true })
    .limit(400);
  if (a.before) q = q.lte("sent_at", a.before);
  const { data: msgs } = await q;
  if (!msgs || msgs.length === 0) return null;
  return { text: flattenDmThread(msgs as DmMessage[]), messageCount: msgs.length, via, igId };
}

/* ------------------------------ closer history ------------------------------ */

export function gradeTrend(grades: number[]): "improving" | "declining" | "stable" | "insufficient" {
  if (grades.length < 4) return "insufficient";
  const half = Math.floor(grades.length / 2);
  const older = grades.slice(0, half);
  const newer = grades.slice(-half);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const delta = avg(newer) - avg(older);
  if (delta >= 5) return "improving";
  if (delta <= -5) return "declining";
  return "stable";
}

export interface CloserHistory {
  count: number;
  avg: number | null;
  last5: number[];
  trend: ReturnType<typeof gradeTrend>;
  flags: string[]; // prior review_flag reasons, newest first
}

export async function loadCloserHistory(sb: Sb, closerDisplay: string | null, days = 14): Promise<CloserHistory> {
  const empty: CloserHistory = { count: 0, avg: null, last5: [], trend: "insufficient", flags: [] };
  if (!closerDisplay) return empty;
  const since = addDays(etDate(), -days);
  const { data } = await sb.from("mm_call_reviews")
    .select("grade,call_date,created_at,fields")
    .ilike("closer", closerDisplay)
    .gte("call_date", since)
    .order("call_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(60);
  const rows = (data || []) as { grade: number | null; fields?: Record<string, unknown> | null }[];
  const grades = rows.map((r) => r.grade).filter((g): g is number => typeof g === "number");
  const flags = rows
    .map((r) => (r.fields as { review_flag?: { flag?: boolean; reason?: string } } | null)?.review_flag)
    .filter((f) => f?.flag && f.reason)
    .map((f) => String(f!.reason))
    .reverse()
    .slice(0, 5);
  return {
    count: grades.length,
    avg: grades.length ? Math.round(grades.reduce((s, g) => s + g, 0) / grades.length) : null,
    last5: grades.slice(-5),
    trend: gradeTrend(grades),
    flags,
  };
}

/* ------------------------------- tracker stats ------------------------------ */

export interface GroupStats {
  booked: number; taken: number; noShows: number; pending: number; cancelled: number;
  closed: number; cashCents: number;
  closeRate: number | null; showRate: number | null;
}
export interface DayStats extends GroupStats {
  byCloser: Record<string, GroupStats>;
  bySetter: Record<string, GroupStats>;
  objections: Record<string, number>;
}

function emptyGroup(): GroupStats {
  return { booked: 0, taken: 0, noShows: 0, pending: 0, cancelled: 0, closed: 0, cashCents: 0, closeRate: null, showRate: null };
}
function finish(g: GroupStats): GroupStats {
  g.closeRate = g.taken > 0 ? Math.round((g.closed / g.taken) * 100) : null;
  const shown = g.taken + g.noShows;
  g.showRate = shown > 0 ? Math.round((g.taken / shown) * 100) : null;
  return g;
}

/**
 * Day (or range) stats straight from the tracker. Definitions, stated in the
 * digest so nobody argues with the number:
 *   taken     = Call Taken == yes
 *   no-show   = outcome NS/RS or NO SHOW
 *   cancelled = outcome CANCELLED
 *   pending   = not taken, not a no-show, not cancelled (hasn't happened / not marked yet)
 *   closed    = outcome WIN
 *   show %  = taken / (taken + no-shows)   (pending + cancelled excluded)
 *   close % = closed / taken
 */
export function trackerDayStats(rows: TrackerRow[]): DayStats {
  const total: DayStats = { ...emptyGroup(), byCloser: {}, bySetter: {}, objections: {} };
  const bump = (g: GroupStats, r: TrackerRow) => {
    const outcome = String(r.outcome || "").toUpperCase();
    const taken = r.call_taken_status === "yes";
    const noShow = outcome.startsWith("NS") || outcome.includes("NO SHOW");
    const cancelled = outcome === "CANCELLED";
    g.booked += 1;
    if (taken) g.taken += 1;
    else if (noShow) g.noShows += 1;
    else if (cancelled) g.cancelled += 1;
    else g.pending += 1;
    if (outcome === "WIN") g.closed += 1;
    g.cashCents += Number(r.collected_revenue_cents) || 0;
  };
  for (const r of rows) {
    bump(total, r);
    const closer = String(r.closer || "").trim().toUpperCase();
    if (closer) bump((total.byCloser[closer] = total.byCloser[closer] || emptyGroup()), r);
    const setter = String(r.setter || "").trim();
    if (setter) bump((total.bySetter[setter] = total.bySetter[setter] || emptyGroup()), r);
    const obj = String(r.objection || "").trim().toUpperCase();
    if (obj && obj !== "NONE") total.objections[obj] = (total.objections[obj] || 0) + 1;
  }
  finish(total);
  for (const g of Object.values(total.byCloser)) finish(g);
  for (const g of Object.values(total.bySetter)) finish(g);
  return total;
}
