// Setter DM Review — Jeremy grades every engaged Instagram conversation, per
// setter, once a night, and Matt gets exactly ONE "DM Brief — {date}" PDF in
// #a-sales-manager (owner's rule: never per-setter posts, never part 1/2/3).
//
// Two stages:
//   1. Per-setter-batch grading runs (silent). The day's conversations for one
//      setter are sent to Jeremy raw (one message per setter, split only when
//      a setter's day exceeds the size cap). Jeremy returns review notes plus
//      a JSON footer with a grade per conversation, which lands in
//      mm_dm_conversation_reviews for trends; the notes land in mm_reports
//      (kind "setter") for the combiner. Nothing is posted to Slack.
//   2. The combiner. When the LAST setter run of the date finalizes (inline or
//      via the 30-min call-reviews tick), one final Jeremy run gets the day
//      totals plus every stored setter note and writes THE DM BRIEF; its
//      finalize is the pipeline's only deliverReport call.
//
// Attribution (measured Sep 2026: every two-way conversation links to its
// ManyChat lead, and ~all carry a setter on the ManyChat tag events):
//   dm_conversation_messages.subscriber_id (IGSID)
//     -> instagram_lead_links.manychat_subscriber_id (+ lead name, handle)
//     -> manychat_tag_events.setter_name (latest) / sales_tracker_rows.setter
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, etDate, flattenDmThread, normalizeName, type DmMessage } from "@/lib/call-review-context";
import { clip } from "@/lib/call-review-format";
import { deliverReport } from "@/lib/report-delivery";
import { sendAndMaybeCollect, type RunRow } from "@/lib/call-review-runs";

type Sb = SupabaseClient;

const THREAD_LOOKBACK_DAYS = 14;
const MAX_MSGS_PER_CONV = 40;
const MAX_BATCH_CHARS = 80000;
const MIN_INBOUND = 2; // "engaged": the lead replied at least twice, not just the keyword

/* --------------------------------- time ---------------------------------- */

/** UTC bounds of an ET calendar day, DST-safe. */
export function etDayRangeUtc(date: string): { from: string; to: string } {
  const pick = (offset: string) => new Date(`${date}T00:00:00${offset}`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false });
  const start = ["-04:00", "-05:00"].map(pick).find((d) => etDate(d) === date && fmt.format(d).startsWith("00")) || pick("-04:00");
  const end = new Date(start.getTime() + 24 * 3600e3 - 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/* -------------------------------- collect --------------------------------- */

export interface SetterConversation {
  igId: string;
  manychatId: string | null;
  leadName: string | null;
  handle: string | null;
  setter: string;
  messages: DmMessage[];
  inbound: number;
  outbound: number;
  todayMessages: number;
  callLinkSent: boolean;
  inTracker: boolean;
  medianResponseMin: number | null;
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Everything Jeremy needs for one ET day, grouped by setter. */
export async function collectSetterDay(sb: Sb, date: string): Promise<{
  bySetter: Record<string, SetterConversation[]>;
  totals: { active: number; engaged: number };
}> {
  const day = etDayRangeUtc(date);
  const dayMsgs = await pageAll<{ subscriber_id: string }>((a, b) =>
    sb.from("dm_conversation_messages").select("subscriber_id").gte("sent_at", day.from).lte("sent_at", day.to).range(a, b)
  );
  const igIds = [...new Set(dayMsgs.map((m) => m.subscriber_id))];
  if (igIds.length === 0) return { bySetter: {}, totals: { active: 0, engaged: 0 } };

  const since = new Date(new Date(day.from).getTime() - THREAD_LOOKBACK_DAYS * 86400e3).toISOString();
  const threads: Record<string, DmMessage[]> = {};
  for (const ids of chunks(igIds, 40)) {
    const rows = await pageAll<DmMessage & { subscriber_id: string }>((a, b) =>
      sb.from("dm_conversation_messages")
        .select("subscriber_id,sent_at,direction,message_type,setter_name,body")
        .in("subscriber_id", ids).gte("sent_at", since).lte("sent_at", day.to)
        .order("sent_at", { ascending: true }).range(a, b)
    );
    for (const r of rows) (threads[r.subscriber_id] = threads[r.subscriber_id] || []).push(r);
  }

  const links: Record<string, { manychat_subscriber_id: string | null; lead_name: string | null; instagram_handle: string | null }> = {};
  for (const ids of chunks(igIds, 100)) {
    const { data } = await sb.from("instagram_lead_links")
      .select("instagram_user_id,manychat_subscriber_id,lead_name,instagram_handle").in("instagram_user_id", ids);
    for (const l of data || []) links[String(l.instagram_user_id)] = l as (typeof links)[string];
  }
  const mcIds = [...new Set(Object.values(links).map((l) => l.manychat_subscriber_id).filter((x): x is string => !!x))];

  const tagSetter: Record<string, string> = {};
  const linkSent = new Set<string>();
  for (const ids of chunks(mcIds, 100)) {
    const { data } = await sb.from("manychat_tag_events")
      .select("subscriber_id,setter_name,tag_name,event_at").in("subscriber_id", ids)
      .order("event_at", { ascending: false }).limit(5000);
    for (const e of data || []) {
      const id = String(e.subscriber_id);
      if (e.setter_name && !tagSetter[id]) tagSetter[id] = String(e.setter_name);
      if (e.tag_name === "call_link_sent") linkSent.add(id);
    }
  }
  const trackerSetter: Record<string, string> = {};
  for (const ids of chunks(mcIds, 100)) {
    const { data } = await sb.from("sales_tracker_rows")
      .select("manychat_subscriber_id,setter,date").in("manychat_subscriber_id", ids)
      .gte("date", addDays(date, -45)).order("date", { ascending: false });
    for (const r of data || []) {
      const id = String(r.manychat_subscriber_id);
      if (r.setter && !trackerSetter[id]) trackerSetter[id] = String(r.setter);
    }
  }

  const display = (s: string) => s.trim().charAt(0).toUpperCase() + s.trim().slice(1).toLowerCase();
  const bySetter: Record<string, SetterConversation[]> = {};
  let engaged = 0;
  for (const igId of igIds) {
    const msgs = threads[igId] || [];
    const inbound = msgs.filter((m) => m.direction === "inbound").length;
    const outbound = msgs.length - inbound;
    if (inbound < MIN_INBOUND || outbound === 0) continue;
    engaged += 1;
    const link = links[igId];
    const mc = link?.manychat_subscriber_id || null;
    const setterRaw = (mc && (trackerSetter[mc] || tagSetter[mc])) || "";
    const setter = setterRaw ? display(setterRaw) : "Unassigned";
    const gaps: number[] = [];
    let lastInbound: number | null = null;
    for (const m of msgs) {
      const t = m.sent_at ? Date.parse(m.sent_at) : NaN;
      if (!Number.isFinite(t) || t < Date.parse(day.from)) continue;
      if (m.direction === "inbound") { if (lastInbound === null) lastInbound = t; }
      else if (lastInbound !== null) { gaps.push(Math.round((t - lastInbound) / 60000)); lastInbound = null; }
    }
    (bySetter[setter] = bySetter[setter] || []).push({
      igId, manychatId: mc, leadName: link?.lead_name || null, handle: link?.instagram_handle || null, setter,
      messages: msgs.slice(-MAX_MSGS_PER_CONV), inbound, outbound,
      todayMessages: msgs.filter((m) => m.sent_at && m.sent_at >= day.from).length,
      callLinkSent: !!mc && linkSent.has(mc), inTracker: !!mc && !!trackerSetter[mc],
      medianResponseMin: median(gaps),
    });
  }
  return { bySetter, totals: { active: igIds.length, engaged } };
}

/* --------------------------------- prompt --------------------------------- */

export const SETTER_BRIEF_TEMPLATE = `*GRADE* {0-100 for the setter's day}

*WHAT'S WORKING*
{2-3 bullets, each tied to a named lead and a quoted line}

*WHAT'S LEAKING*
{2-4 bullets: the pattern, the named leads it cost, the quoted moment, and the exact message that should have been sent}

*BEST CONVERSATION*
{lead} — {why, one or two lines}

*WORST CONVERSATION*
{lead} — {what was lost} — Should have sent: "{exact message}"

*DRILL*
{the one thing to practise tomorrow, concrete}

*FLAG FOR MANAGER*
{anything upstream of the setter: lead quality, automation replying badly, flow bugs, response-time problems outside their hours}
{or "None"}`;

export const SETTER_FIELDS_SPEC = `{
  "setter": "<name>",
  "grade": <0-100>,
  "conversations": [
    { "lead": "<lead name exactly as given>", "grade": <0-100>,
      "stage": "cold | engaged | qualified | link_sent | booked | dead",
      "biggest_miss": "<one sentence or null>", "best_line": "<verbatim setter line or null>",
      "next_message": "<the exact message the setter should send next, or null if closed>" }
  ],
  "strengths": ["<string>"], "fixes": ["<string>"], "drill": "<string>",
  "flag_for_manager": ["<string>"]
}`;

function conversationBlock(c: SetterConversation, i: number): string {
  const who = c.leadName || (c.handle ? `@${c.handle}` : `lead ${i + 1}`);
  const meta = [
    `${c.inbound} from lead / ${c.outbound} from setter over the last ${THREAD_LOOKBACK_DAYS} days, ${c.todayMessages} today`,
    c.callLinkSent ? "call link sent" : "no call link yet",
    c.inTracker ? "booked (in tracker)" : "not booked",
    c.medianResponseMin != null ? `median setter response today ${c.medianResponseMin} min` : "",
  ].filter(Boolean).join(" | ");
  return `--- CONVERSATION ${i + 1}: ${who}${c.handle && c.leadName ? ` (@${c.handle})` : ""} — ${meta} ---\n${flattenDmThread(c.messages, MAX_MSGS_PER_CONV, 6000)}`;
}

export function buildSetterMessage(setter: string, date: string, convs: SetterConversation[], part: { n: number; of: number }, scripts: { setterScript: string | null; guardrails: string | null }): string {
  return [
    `You are our head of sales (Jeremy). Review ${setter}'s Instagram DM conversations for ${date}${part.of > 1 ? ` (part ${part.n} of ${part.of})` : ""} and write the body of the SETTER BRIEF for the sales manager (Matt). Our setters' job: turn a keyword reply into a booked Strategy Session (a sales call) by finding the goal, the gap and the stakes, creating urgency and asking for the call. "Setter" lines may include ManyChat automation as well as the human; grade the human, and flag automation that is hurting.`,
    "",
    scripts.guardrails ? `COMPANY BOUNDARIES: ${scripts.guardrails}` : "",
    scripts.setterScript ? `OUR SETTER SCRIPT (grade adherence loosely):\n${scripts.setterScript}` : "No setter script is on file.",
    "",
    "WRITE EXACTLY THIS STRUCTURE (Slack mrkdwn: *bold* labels, short lines, no tables, no code blocks, no # headings). Do NOT repeat the header line — the system prepends it:",
    SETTER_BRIEF_TEMPLATE,
    "",
    "Rules: quote the actual messages. Name leads exactly as they appear in the conversation headers. Be blunt and specific; 'Do this', never 'consider'. Keep the body under 3,000 characters.",
    "Then end your reply with exactly one fenced code block labeled json containing only this object (valid JSON, no comments), with one entry per conversation:",
    "```json",
    SETTER_FIELDS_SPEC,
    "```",
    "",
    `CONVERSATIONS (${convs.length}):`,
    ...convs.map(conversationBlock),
  ].filter((l) => l !== "").join("\n");
}

function splitBatches(convs: SetterConversation[]): SetterConversation[][] {
  const out: SetterConversation[][] = [[]];
  let size = 0;
  for (const c of convs) {
    const len = flattenDmThread(c.messages, MAX_MSGS_PER_CONV, 6000).length + 300;
    if (size + len > MAX_BATCH_CHARS && out[out.length - 1].length > 0) { out.push([]); size = 0; }
    out[out.length - 1].push(c);
    size += len;
  }
  return out;
}

/* -------------------------------- finalize -------------------------------- */

function parseReply(reply: string): { md: string; fields: Record<string, unknown> } {
  const matches = [...reply.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = matches[matches.length - 1];
  let fields: Record<string, unknown> = {};
  if (last) { try { const p = JSON.parse(last[1]); if (p && typeof p === "object") fields = p; } catch { /* keep md */ } }
  return { md: (last ? reply.replace(last[0], "") : reply).trim(), fields };
}

/** Header rendered by code, never by the model. */
export function renderSetterHeader(setter: string, date: string, convs: SetterConversation[], totals: { active: number; engaged: number }, part: { n: number; of: number }): string {
  const links = convs.filter((c) => c.callLinkSent).length;
  const booked = convs.filter((c) => c.inTracker).length;
  const resp = median(convs.map((c) => c.medianResponseMin).filter((x): x is number => x != null));
  return [
    `*SETTER BRIEF* | ${date} | ${setter}${part.of > 1 ? ` (part ${part.n}/${part.of})` : ""}`,
    `${convs.length} engaged conversations reviewed | ${links} call links sent | ${booked} booked | median reply ${resp != null ? `${resp} min` : "—"} | team: ${totals.engaged} engaged of ${totals.active} active today`,
    `_engaged = the lead replied at least twice; source: Instagram DMs + ManyChat tags + tracker_`,
  ].join("\n");
}

export async function finalizeSetterRun(sb: Sb, run: RunRow, reply: string): Promise<string> {
  // fathom_id = "setter:<date>:<setter>[:p<n>]"
  const parts = String(run.fathom_id || "").split(":");
  const date = parts[1] || etDate();
  const setter = parts[2] || "Unassigned";
  const partN = parts[3] ? Number(parts[3].replace("p", "")) : 1;
  const { md, fields } = parseReply(reply);
  if (!md || md.length < 120) throw new Error("reply too short to be a setter brief");

  const { bySetter, totals } = await collectSetterDay(sb, date);
  const batches = splitBatches(bySetter[setter] || []);
  const convs = batches[partN - 1] || [];
  const header = renderSetterHeader(setter, date, convs, totals, { n: partN, of: Math.max(batches.length, 1) });

  // Per-conversation grades -> mm_dm_conversation_reviews, matched back by lead name.
  const byName: Record<string, SetterConversation> = {};
  for (const c of convs) {
    if (c.leadName) byName[normalizeName(c.leadName)] = c;
    if (c.handle) byName[`@${c.handle.toLowerCase()}`] = c;
  }
  const graded = Array.isArray(fields.conversations) ? (fields.conversations as Record<string, unknown>[]) : [];
  const rows = graded.map((g) => {
    const key = String(g.lead || "");
    const c = byName[normalizeName(key)] || byName[key.toLowerCase()] || null;
    if (!c) return null;
    return {
      review_date: date, setter, ig_subscriber_id: c.igId, manychat_subscriber_id: c.manychatId,
      lead_name: c.leadName || c.handle, grade: typeof g.grade === "number" ? Math.round(g.grade) : null,
      stage: typeof g.stage === "string" ? g.stage : null, fields: g, model: "jeremy",
    };
  }).filter(Boolean);
  let stored = 0; let storeErr: string | null = null;
  if (rows.length) {
    const { error } = await sb.from("mm_dm_conversation_reviews").upsert(rows, { onConflict: "review_date,ig_subscriber_id" });
    if (error) storeErr = error.message; else stored = rows.length;
  }
  // The setter notes are stored for the combiner, never posted on their own.
  const full = `${header}\n\n${md}`;
  const { error: repErr } = await sb.from("mm_reports").upsert({
    kind: "setter", period_key: `${date}:${setter}${partN > 1 ? `:p${partN}` : ""}`, report_md: full,
    fields: { ...fields, conversations_matched: stored, conversations_sent: convs.length }, model: "jeremy", created_at: new Date().toISOString(),
  }, { onConflict: "kind,period_key" });
  // Was this the day's last setter run? Then dispatch the one combined brief.
  let combine: string;
  try {
    combine = await maybeDispatchDmCombine(sb, date, { bySetter, totals }, run.id);
  } catch (e) {
    combine = `error: ${String(e).slice(0, 160)}`;
  }
  return `setter notes stored silently (${stored}/${graded.length} grades stored${storeErr ? `; grades not stored: ${clip(storeErr, 60)}` : ""}${repErr ? `; notes not stored: ${clip(repErr.message, 60)}` : ""}); combine: ${combine}`;
}

/* ------------------------------- combiner ---------------------------------- */
// Owner's rule (2026-09-18): the whole pipeline posts exactly ONE Slack
// message per day — "DM Brief — {date}" as a PDF. The per-setter runs above
// only grade and store; when the last of them finishes, one more Jeremy run
// merges everything into the single brief.

/** Every run key the day's dispatch loop creates, as mm_review_runs.fathom_id. */
export function setterRunKeys(date: string, bySetter: Record<string, SetterConversation[]>): string[] {
  const keys: string[] = [];
  for (const setter of Object.keys(bySetter).sort()) {
    const batches = splitBatches(bySetter[setter]);
    for (let i = 0; i < batches.length; i++) keys.push(`setter:${date}:${setter}${i > 0 ? `:p${i + 1}` : ""}`);
  }
  return keys;
}

/** Two-line day header for the combined brief; rendered by code, never by the model. */
export function renderDmBriefHeader(date: string, bySetter: Record<string, SetterConversation[]>, totals: { active: number; engaged: number }): string {
  const all = Object.values(bySetter).flat();
  const links = all.filter((c) => c.callLinkSent).length;
  const booked = all.filter((c) => c.inTracker).length;
  const resp = median(all.map((c) => c.medianResponseMin).filter((x): x is number => x != null));
  const perSetter = Object.keys(bySetter).sort().map((s) => `${s} ${bySetter[s].length}`).join(", ");
  return [
    `*DM BRIEF* | ${date}`,
    `${totals.engaged} engaged of ${totals.active} active conversations | ${links} call links sent | ${booked} booked | median reply ${resp != null ? `${resp} min` : "—"}${perSetter ? ` | ${perSetter}` : ""}`,
  ].join("\n");
}

function setterStatLines(bySetter: Record<string, SetterConversation[]>): string[] {
  return Object.keys(bySetter).sort().map((s) => {
    const convs = bySetter[s];
    const links = convs.filter((c) => c.callLinkSent).length;
    const booked = convs.filter((c) => c.inTracker).length;
    const resp = median(convs.map((c) => c.medianResponseMin).filter((x): x is number => x != null));
    return `- ${s}: ${convs.length} engaged, ${links} call links sent, ${booked} booked, median reply ${resp != null ? `${resp} min` : "—"}`;
  });
}

export function buildDmCombineMessage(date: string, header: string, setterLines: string[], briefs: { key: string; md: string }[]): string {
  return [
    `You are our head of sales (Jeremy). Below are the day's Instagram DM numbers and your own per-setter review notes for ${date}. Write THE DM BRIEF for the sales manager (Matt) — one document for the whole day.`,
    "",
    "WRITE (Slack mrkdwn: *bold* labels, short lines, no tables, no code blocks, no # headings). Do NOT repeat the numeric header — the system prepends it. Structure:",
    "- A headline paragraph on the day's DM performance.",
    "- Team numbers.",
    "- A short section per setter (2-5 sentences each: their number of engaged conversations and bookings, and the ONE thing to fix).",
    "- Standout conversations worth reading (lead name + why).",
    "- 3 action items.",
    "No per-setter sub-briefs, no parts, no JSON footer. Be blunt and specific; 'Do this', never 'consider'. Keep the whole document under 3,500 characters.",
    "",
    "DAY NUMBERS:",
    header,
    "PER SETTER:",
    ...(setterLines.length ? setterLines : ["- none"]),
    "",
    briefs.length
      ? `YOUR PER-SETTER REVIEW NOTES (${briefs.length} — condense them, do not copy them):`
      : "PER-SETTER REVIEW NOTES: none stored — write from the day numbers alone and say the conversation detail is missing.",
    ...briefs.map((b) => `--- NOTES ${b.key} ---\n${b.md}`),
  ].join("\n");
}

/**
 * If every setter-batch run expected for `date` is finished (the run calling
 * this counts as finished — its row is still "running" while we finalize it),
 * dispatch the single combined DM BRIEF run. sendAndMaybeCollect's alreadyDone
 * guard (run kind "dm-combine", keyed by date) makes the dispatch idempotent.
 */
export async function maybeDispatchDmCombine(
  sb: Sb,
  date: string,
  day: { bySetter: Record<string, SetterConversation[]>; totals: { active: number; engaged: number } },
  currentRunId?: number
): Promise<string> {
  const expected = setterRunKeys(date, day.bySetter);
  if (expected.length === 0) return "no setter runs expected for the day";
  const { data, error } = await sb.from("mm_review_runs")
    .select("id,fathom_id,status").eq("kind", "digest").in("fathom_id", expected);
  if (error) return `run check failed: ${error.message}`;
  const byKey: Record<string, { id: number; status: string }> = {};
  for (const r of (data || []) as { id: number; fathom_id: string; status: string }[]) byKey[r.fathom_id] = r;
  // A run is done when it completed, failed for good, or is the one being
  // finalized right now. A key with no row was never dispatched (?setter=
  // debug, or the nightly cron has not run) — the day is not complete.
  const pending = expected.filter((k) => {
    const r = byKey[k];
    return !(r && (r.id === currentRunId || r.status === "completed" || r.status === "failed"));
  });
  if (pending.length > 0) return `waiting on ${pending.length}/${expected.length} setter runs`;

  // Per-setter notes from mm_reports; tolerate the table not existing yet.
  let briefs: { key: string; md: string }[] = [];
  let briefsNote = "";
  try {
    const { data: reps, error: repErr } = await sb.from("mm_reports")
      .select("period_key,report_md").eq("kind", "setter")
      .like("period_key", `${date}:%`).order("period_key");
    if (repErr) briefsNote = ` (notes unavailable: ${clip(repErr.message, 60)})`;
    else briefs = (reps || []).map((r) => ({ key: String(r.period_key), md: String(r.report_md || "") }));
  } catch (e) {
    briefsNote = ` (notes unavailable: ${clip(String(e), 60)})`;
  }
  const header = renderDmBriefHeader(date, day.bySetter, day.totals);
  const how = await sendAndMaybeCollect(
    sb, "dm-combine", date,
    buildDmCombineMessage(date, header, setterStatLines(day.bySetter), briefs),
    (run, reply) => finalizeDmCombine(sb, run, reply),
    { waitMs: 0 }
  );
  return `${how}${briefsNote}`;
}

/** The pipeline's ONLY Slack post: "DM Brief — {date}" as one PDF. */
export async function finalizeDmCombine(sb: Sb, run: RunRow, reply: string): Promise<string> {
  const date = String(run.fathom_id || "").replace(/^dm-combine:/, "") || etDate();
  const md = reply.trim();
  if (!md || md.length < 120) throw new Error("reply too short to be a DM brief");
  let header = `*DM BRIEF* | ${date}`;
  try {
    const { bySetter, totals } = await collectSetterDay(sb, date);
    header = renderDmBriefHeader(date, bySetter, totals);
  } catch { /* header degrades to the title line */ }
  const full = `${header}\n\n${md}`;
  const { error: repErr } = await sb.from("mm_reports").upsert({
    kind: "dm-brief", period_key: date, report_md: full, fields: null, model: "jeremy",
    created_at: new Date().toISOString(),
  }, { onConflict: "kind,period_key" });
  const how = await deliverReport({
    title: `DM Brief — ${date}`,
    filename: `dm-brief-${date}.pdf`,
    summary: header,
    body: full,
  });
  return `DM brief delivered as ${how}${repErr ? ` (not stored: ${clip(repErr.message, 60)})` : ""}`;
}

/* ---------------------------------- run ----------------------------------- */

export async function runDmReviews(sb: Sb, opts: { date?: string; force?: boolean; setter?: string } = {}) {
  const report: Record<string, unknown> = {};
  const date = opts.date || etDate();
  try {
    const { data: scriptsData } = await sb.from("mm_scripts").select("role,content");
    const find = (role: string) => scriptsData?.find((s) => s.role === role)?.content?.trim() || null;
    const scripts = { setterScript: find("setter"), guardrails: find("guardrails") };
    const { bySetter, totals } = await collectSetterDay(sb, date);
    report.totals = totals;
    const setters = Object.keys(bySetter).filter((s) => !opts.setter || s.toLowerCase() === opts.setter.toLowerCase()).sort();
    const results: Record<string, string> = {};
    // force on a full-day run redoes the whole day, including the one Slack
    // post: clear the combine run so the last re-collected setter run
    // re-dispatches it. A ?setter= debug run never touches the combine.
    if (opts.force && !opts.setter) {
      await sb.from("mm_review_runs").delete().eq("kind", "digest").eq("fathom_id", `dm-combine:${date}`);
    }
    // Fire every batch without waiting (a night is 8-12 Jeremy turns of 2-5
    // min each — far beyond one function invocation); the 30-minute
    // call-reviews tick collects them silently, and the last one to finish
    // dispatches the single combined DM BRIEF.
    const waitEach = 0;
    let fired = 0;
    for (const setter of setters) {
      const batches = splitBatches(bySetter[setter]);
      for (let i = 0; i < batches.length; i++) {
        const key = `${date}:${setter}${i > 0 ? `:p${i + 1}` : ""}`;
        try {
          // Space the dispatches out — 8+ back-to-back sends is what made
          // Jeremy return id-less responses for the tail of the batch.
          if (fired > 0) await new Promise((r) => setTimeout(r, 2000));
          fired += 1;
          results[key] = await sendAndMaybeCollect(
            sb, "setter", key,
            buildSetterMessage(setter, date, batches[i], { n: i + 1, of: batches.length }, scripts),
            (run, reply) => finalizeSetterRun(sb, run, reply),
            { force: opts.force, waitMs: waitEach }
          );
        } catch (e) {
          results[key] = `error: ${String(e).slice(0, 200)}`;
        }
      }
    }
    report.setters = results;
    if (setters.length === 0) report.note = "no engaged conversations today";
    // Safety net: if every setter run already finished (e.g. a re-run after a
    // crash) the finalize path never fires again, so check the combine here
    // too. Harmless mid-night — it just reports "waiting on n/m setter runs".
    if (!opts.setter && setters.length > 0) {
      try {
        report.combine = await maybeDispatchDmCombine(sb, date, { bySetter, totals });
      } catch (e) {
        report.combine = `error: ${String(e).slice(0, 200)}`;
      }
    }
    // Sweep the previous 3 days: a day whose LAST setter run failed never
    // re-enters the finalize path, so its combine would otherwise strand
    // forever (this happened to 2026-09-17 when two id-less Jeremy sends
    // failed). alreadyDone keeps this idempotent.
    if (!opts.setter) {
      for (let back = 1; back <= 3; back++) {
        const prior = addDays(date, -back);
        try {
          const priorDay = await collectSetterDay(sb, prior);
          if (Object.keys(priorDay.bySetter).length === 0) continue;
          const r = await maybeDispatchDmCombine(sb, prior, priorDay);
          if (!/already completed|waiting on/.test(r)) report[`combine_${prior}`] = r;
        } catch { /* best-effort sweep */ }
      }
    }
  } catch (e) {
    report.error = String(e).slice(0, 300);
  }
  return report;
}
