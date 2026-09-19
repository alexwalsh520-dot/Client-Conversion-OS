// Setter DM Review — the model (in the "Jeremy" head-of-sales persona) grades
// every engaged Instagram conversation, per setter, once a night, and Matt
// gets exactly ONE "DM Brief — {date}" PDF in #a-sales-manager (owner's rule:
// never per-setter posts, never part 1/2/3).
//
// The whole night runs synchronously inside ONE cron invocation, against the
// Anthropic API directly (src/lib/dm-reviews-model.ts) — no chat-agent
// middleman, no run rows, no collector tick, nothing that can strand:
//   1. Grade. The day's conversations for one setter go out as one request
//      (split only when a setter's day exceeds the size cap); up to 4 batches
//      run concurrently. Each reply is a structured object: the brief body
//      plus a grade per conversation, which lands in mm_dm_conversation_reviews
//      for trends; the notes land in mm_reports (kind "setter"). Nothing is
//      posted to Slack.
//   2. Combine. One more request gets the day totals plus every setter note
//      from step 1 and writes THE DM BRIEF — the pipeline's only deliverReport
//      call. A batch that fails after retries is skipped and named in the
//      brief; the day is never stranded.
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
import { DM_MODEL, DmModelError, gradeSetterBatch, pool, writeDmBrief, type SetterGrading } from "@/lib/dm-reviews-model";

type Sb = SupabaseClient;

const THREAD_LOOKBACK_DAYS = 14;
const MAX_MSGS_PER_CONV = 40;
const MAX_BATCH_CHARS = 80000;
const MIN_INBOUND = 2; // "engaged": the lead replied at least twice, not just the keyword

// Wall-clock budget. The route's maxDuration is 300s: collection takes a few
// seconds, grading gets the bulk, the combine + PDF get what is left.
const GRADE_CONCURRENCY = 4;
const GRADE_DEADLINE_MS = 200_000; // from the start of grading
const COMBINE_DEADLINE_MS = 75_000; // from the start of the combine

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

/** Field-by-field meaning of the structured reply; the shape itself is
 *  enforced by SETTER_GRADING_SCHEMA in dm-reviews-model.ts. */
export const SETTER_FIELDS_SPEC = `{
  "brief_md": "<the SETTER BRIEF body in the structure above>",
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
    "THE BRIEF BODY (brief_md) HAS EXACTLY THIS STRUCTURE (Slack mrkdwn: *bold* labels, short lines, no tables, no code blocks, no # headings). Do NOT repeat the header line — the system prepends it:",
    SETTER_BRIEF_TEMPLATE,
    "",
    "Rules: quote the actual messages. Name leads exactly as they appear in the conversation headers. Be blunt and specific; 'Do this', never 'consider'. Keep the body under 3,000 characters.",
    "Reply with one structured object — the brief body plus the grading fields, with one conversations entry per conversation (grades 0-100):",
    SETTER_FIELDS_SPEC,
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

/* --------------------------------- store ---------------------------------- */

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

/** mm_reports period_key for a setter batch: "{date}:{Setter}[:pN]". */
export function setterNoteKey(date: string, setter: string, partN: number): string {
  return `${date}:${setter}${partN > 1 ? `:p${partN}` : ""}`;
}

export interface SetterBatch {
  key: string;
  setter: string;
  part: { n: number; of: number };
  convs: SetterConversation[];
}

/** Per-conversation grades -> mm_dm_conversation_reviews, matched back by lead name;
 *  the brief body -> mm_reports (kind "setter"), for the combiner only. */
async function storeSetterGrading(sb: Sb, date: string, batch: SetterBatch, totals: { active: number; engaged: number }, graded: SetterGrading): Promise<{ note: string; full: string }> {
  const { setter, convs, part } = batch;
  const { brief_md, ...fields } = graded;
  const md = String(brief_md || "").trim();
  if (md.length < 120) throw new DmModelError(`${batch.key}: brief body too short (${md.length} chars)`, false);
  const header = renderSetterHeader(setter, date, convs, totals, part);

  const byName: Record<string, SetterConversation> = {};
  for (const c of convs) {
    if (c.leadName) byName[normalizeName(c.leadName)] = c;
    if (c.handle) byName[`@${c.handle.toLowerCase()}`] = c;
  }
  const grades = Array.isArray(graded.conversations) ? graded.conversations : [];
  const rows = grades.map((g) => {
    const key = String(g.lead || "");
    const c = byName[normalizeName(key)] || byName[key.toLowerCase()] || null;
    if (!c) return null;
    return {
      review_date: date, setter, ig_subscriber_id: c.igId, manychat_subscriber_id: c.manychatId,
      lead_name: c.leadName || c.handle, grade: typeof g.grade === "number" ? Math.round(g.grade) : null,
      stage: typeof g.stage === "string" ? g.stage : null, fields: g, model: DM_MODEL,
    };
  }).filter(Boolean);
  let stored = 0; let storeErr: string | null = null;
  if (rows.length) {
    const { error } = await sb.from("mm_dm_conversation_reviews").upsert(rows, { onConflict: "review_date,ig_subscriber_id" });
    if (error) storeErr = error.message; else stored = rows.length;
  }
  const full = `${header}\n\n${md}`;
  const { error: repErr } = await sb.from("mm_reports").upsert({
    kind: "setter", period_key: batch.key, report_md: full,
    fields: { ...fields, conversations_matched: stored, conversations_sent: convs.length }, model: DM_MODEL, created_at: new Date().toISOString(),
  }, { onConflict: "kind,period_key" });
  const note = `${stored}/${grades.length} grades stored${storeErr ? ` (grades not stored: ${clip(storeErr, 60)})` : ""}${repErr ? ` (notes not stored: ${clip(repErr.message, 60)})` : ""}`;
  return { note, full };
}

/* ------------------------------- combiner ---------------------------------- */
// Owner's rule (2026-09-18): the whole pipeline posts exactly ONE Slack
// message per day — "DM Brief — {date}" as a PDF.

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

export function buildDmCombineMessage(date: string, header: string, setterLines: string[], briefs: { key: string; md: string }[], skipped: string[] = []): string {
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
    skipped.length ? `NOT REVIEWED (grading failed tonight — say so in their section instead of guessing): ${skipped.join(", ")}` : "",
    briefs.length
      ? `YOUR PER-SETTER REVIEW NOTES (${briefs.length} — condense them, do not copy them):`
      : "PER-SETTER REVIEW NOTES: none stored — write from the day numbers alone and say the conversation detail is missing.",
    ...briefs.map((b) => `--- NOTES ${b.key} ---\n${b.md}`),
  ].filter((l) => l !== "").join("\n");
}

/* ---------------------------------- run ----------------------------------- */

/** Every batch the day needs, in dispatch order. */
export function planBatches(date: string, bySetter: Record<string, SetterConversation[]>, only?: string): SetterBatch[] {
  const out: SetterBatch[] = [];
  for (const setter of Object.keys(bySetter).sort()) {
    if (only && setter.toLowerCase() !== only.toLowerCase()) continue;
    const batches = splitBatches(bySetter[setter]);
    batches.forEach((convs, i) => out.push({ key: setterNoteKey(date, setter, i + 1), setter, part: { n: i + 1, of: batches.length }, convs }));
  }
  return out;
}

export interface DmReviewReport {
  date: string;
  totals?: { active: number; engaged: number };
  batches?: Record<string, string>;
  failed?: Record<string, string>;
  brief?: string;
  note?: string;
  error?: string;
  timings_ms: Record<string, number>;
}

/**
 * The whole night, synchronously: collect -> grade every batch (4 at a time)
 * -> write the one combined brief -> deliver the PDF. `setter` grades one
 * setter silently and never posts; `force` regrades and reposts the day.
 */
export async function runDmReviews(sb: Sb, opts: { date?: string; force?: boolean; setter?: string } = {}): Promise<DmReviewReport> {
  const t0 = Date.now();
  const date = opts.date || etDate();
  const report: DmReviewReport = { date, timings_ms: {} };
  const lap = (name: string, since: number) => { report.timings_ms[name] = Date.now() - since; };
  try {
    // Double-post guard: a day whose brief already went out is never redone
    // without force. A ?setter= debug run grades regardless, but never posts.
    if (!opts.force && !opts.setter) {
      const { data: done } = await sb.from("mm_reports").select("period_key").eq("kind", "dm-brief").eq("period_key", date).limit(1);
      if (done && done.length) {
        report.brief = `already delivered for ${date} (pass force=1 to redo)`;
        lap("total", t0);
        return report;
      }
    }

    const tCollect = Date.now();
    const { data: scriptsData } = await sb.from("mm_scripts").select("role,content");
    const find = (role: string) => scriptsData?.find((s) => s.role === role)?.content?.trim() || null;
    const scripts = { setterScript: find("setter"), guardrails: find("guardrails") };
    const { bySetter, totals } = await collectSetterDay(sb, date);
    report.totals = totals;
    const batches = planBatches(date, bySetter, opts.setter);
    lap("collect", tCollect);
    if (batches.length === 0) {
      report.note = opts.setter ? `no engaged conversations for ${opts.setter} on ${date}` : "no engaged conversations today";
      lap("total", t0);
      return report;
    }

    // Grade: every batch through the model directly, GRADE_CONCURRENCY at a
    // time, all bounded by one deadline. A failure is recorded and skipped.
    const tGrade = Date.now();
    const deadline = tGrade + GRADE_DEADLINE_MS;
    const settled = await pool(batches, GRADE_CONCURRENCY, async (b) => {
      const graded = await gradeSetterBatch(buildSetterMessage(b.setter, date, b.convs, b.part, scripts), deadline, b.key);
      return storeSetterGrading(sb, date, b, totals, graded);
    });
    const results: Record<string, string> = {};
    const failed: Record<string, string> = {};
    const notes: { key: string; md: string }[] = [];
    settled.forEach((r, i) => {
      const b = batches[i];
      if (r.status === "fulfilled") { results[b.key] = r.value.note; notes.push({ key: b.key, md: r.value.full }); }
      else failed[b.key] = clip(r.reason instanceof Error ? r.reason.message : String(r.reason), 200);
    });
    report.batches = results;
    if (Object.keys(failed).length) report.failed = failed;
    lap("grade", tGrade);
    if (opts.setter) {
      report.brief = "not posted (?setter= grades silently)";
      lap("total", t0);
      return report;
    }

    // Combine: one document for the day from the notes that succeeded.
    const tCombine = Date.now();
    const header = renderDmBriefHeader(date, bySetter, totals);
    const skipped = batches.filter((b) => failed[b.key]).map((b) => b.part.of > 1 ? `${b.setter} (part ${b.part.n}/${b.part.of})` : b.setter);
    let body: string;
    let how: string;
    if (notes.length === 0) {
      throw new DmModelError(`every batch failed — nothing to combine (${Object.values(failed)[0]})`, true);
    }
    try {
      body = await writeDmBrief(buildDmCombineMessage(date, header, setterStatLines(bySetter), notes, skipped), tCombine + COMBINE_DEADLINE_MS);
      how = "combined";
    } catch (e) {
      // The notes are graded and stored; a dead combine must not strand the
      // day, so the brief degrades to the notes stitched together.
      report.note = `combine failed, delivered the stitched setter notes instead: ${clip(e instanceof Error ? e.message : String(e), 200)}`;
      body = notes.map((n) => n.md).join("\n\n");
      how = "stitched";
    }
    const full = `${header}\n\n${body}`;
    lap("combine", tCombine);

    const tDeliver = Date.now();
    const { error: repErr } = await sb.from("mm_reports").upsert({
      kind: "dm-brief", period_key: date, report_md: full, fields: { how, skipped }, model: DM_MODEL,
      created_at: new Date().toISOString(),
    }, { onConflict: "kind,period_key" });
    const delivered = await deliverReport({
      title: `DM Brief — ${date}`,
      filename: `dm-brief-${date}.pdf`,
      summary: header,
      body: full,
    });
    lap("deliver", tDeliver);
    report.brief = `${how} brief delivered as ${delivered}${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}${repErr ? ` (not stored: ${clip(repErr.message, 60)})` : ""}`;
  } catch (e) {
    report.error = clip(e instanceof Error ? e.message : String(e), 300);
  }
  lap("total", t0);
  return report;
}
