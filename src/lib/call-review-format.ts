// Call Review Autopilot — output contracts and Slack renderers.
//
// The field list and the message shapes were agreed with Jeremy (the reviewer
// persona) on 2026-09-19 — see docs/call-review-autopilot.md. Keep the JSON
// spec and the renderers in sync: the renderers only read fields the spec asks
// for, and everything is tolerant of a missing field (Jeremy is an LLM).
//
// Slack constraints (Matt reads these on his phone): bold labels, one idea per
// line, no tables, no code blocks, per-call post well under 2,000 characters.

export const APP_URL = "https://client-conversion-os.vercel.app";

/** The JSON footer Jeremy must emit after the markdown review. */
export const CALL_FIELDS_SPEC = `{
  "grade": <0-100 overall rep performance>,
  "adherence_score": <0-100, ONLY when a closer script is provided; otherwise omit>,
  "adherence_notes": "<one sentence, only with a script>",
  "closer": "<rep first name as spoken>",
  "prospect_name": "<prospect full name>",
  "call_type": "Strategy Session | Onboarding Call",
  "outcome": "won | lost | follow-up | no-show | unclear",
  "sub_scores": { "qualification": <0-100>, "discovery": <0-100>, "pitch": <0-100>, "objections": <0-100>, "close": <0-100> },
  "objections_raised": [
    { "category": "price | timing | spouse | skepticism | competitor | identity | authority | fit | other",
      "verbatim_quote": "<exact prospect words>", "timestamp": "<mm:ss>",
      "how_handled": "addressed | deflected | ignored | missed",
      "handling_quality": "effective | partial | ineffective" }
  ],
  "prospect_language": ["<3-6 verbatim prospect quotes that describe their pain, desire or doubt>"],
  "ad_to_call_mismatch": { "flag": <true|false>, "note": "<what the prospect expected vs what the call was, or null>" },
  "setter_handoff": {
    "expectation_gap": <true|false>, "note": "<gap between what the DMs set up and the call, or null>",
    "dm_stated_motivation": "<what the prospect said they wanted in the DMs, or null>",
    "closer_used_motivation": <true|false>, "motivation_note": "<did the closer connect the pitch to it, or null>"
  },
  "systemic_flags": ["<anything upstream of the closer: lead quality, setter misrepresentation, offer confusion, process breaks>"],
  "review_flag": { "flag": <true|false>, "reason": "<why Matthew should personally listen to this call, or null>" },
  "call_summary": "<one paragraph>",
  "stop": "<the ONE behaviour to stop, one sentence>",
  "start": "<the ONE behaviour to start, one sentence with example phrasing>",
  "keep": "<the ONE behaviour to keep, one sentence>",
  "drill": "<one specific drill for the next call>",
  "if_i_ran_the_call": "<2-4 sentence rewrite of the key missed moment>",
  "red_flags": ["<closer behaviours that consistently kill deals>"]
}`;

export const REVIEW_FLAG_RULES =
  "Set review_flag.flag=true only when: grade < 50, OR an objection category not seen in this closer's last 14 days, OR any systemic_flags entry, OR cash collected far outside the normal $1,200-$3,000 range, OR any red_flags entry.";

/* --------------------------------- helpers --------------------------------- */

export function clip(s: unknown, n: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export function money(cents: number | null | undefined): string {
  const n = Math.round((Number(cents) || 0) / 100);
  return `$${n.toLocaleString("en-US")}`;
}

export function pct(v: number | null | undefined): string {
  return typeof v === "number" ? `${v}%` : "—";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/* --------------------------------- per call -------------------------------- */

export interface CallPostInput {
  fathomId: string;
  closer: string | null;
  prospect: string | null;
  callType: string | null;
  outcome: string | null;
  cashCents: number | null;
  grade: number | null;
  trend: string | null;
  avg14: number | null;
  history: number;
  fields: Record<string, unknown>;
  dmAvailable: boolean;
  trackerMatched: boolean;
}

/** Jeremy's per-call post (artifact 2). */
export function renderCallPost(i: CallPostInput): string {
  const f = i.fields;
  const sub = (f.sub_scores || {}) as Record<string, unknown>;
  const objections = Array.isArray(f.objections_raised) ? (f.objections_raised as Record<string, unknown>[]) : [];
  const top = objections[0];
  const flag = (f.review_flag || {}) as { flag?: boolean; reason?: string };
  const cash = i.cashCents != null ? money(i.cashCents) : "—";
  const trend = i.trend && i.trend !== "insufficient" ? i.trend : "n/a";
  const avg = i.avg14 != null ? `14d avg ${i.avg14}, ${i.history} call${i.history === 1 ? "" : "s"}` : "no 14d history";
  const lines = [
    `*${i.closer || "Closer"}* | ${i.prospect || "prospect"} | ${i.callType || "Sales Call"}`,
    `*Outcome* ${i.outcome || "unclear"} | *Cash* ${cash} | *Grade* ${i.grade ?? "—"}/100`,
    `*Trend* ${trend} (${avg})`,
    "",
    `*KEEP* ${clip(f.keep, 220) || "—"}`,
    `*STOP* ${clip(f.stop, 220) || "—"}`,
    `*START* ${clip(f.start, 260) || "—"}`,
    "",
    `*Sub-scores* Q${num(sub.qualification) ?? "-"} D${num(sub.discovery) ?? "-"} P${num(sub.pitch) ?? "-"} O${num(sub.objections) ?? "-"} C${num(sub.close) ?? "-"}`,
  ];
  if (top) {
    lines.push("", `*Top objection* "${clip(top.verbatim_quote, 160)}" (${str(top.category) || "other"}) — handled: ${str(top.handling_quality) || "?"}`);
  }
  lines.push("", `*Drill* ${clip(f.drill, 240) || "—"}`);
  const gaps: string[] = [];
  if (!i.trackerMatched) gaps.push("no tracker row matched");
  if (!i.dmAvailable) gaps.push("no DM transcript");
  lines.push("", flag.flag ? `:rotating_light: *REVIEW* ${clip(flag.reason, 200)}` : ":white_check_mark: Clear");
  if (gaps.length) lines.push(`_(${gaps.join(", ")})_`);
  lines.push(`Full review: ${APP_URL}/micromanager?deal=${encodeURIComponent(i.fathomId)}`);
  return lines.join("\n");
}

/* ------------------------------- daily digest ------------------------------- */

export interface DigestHeaderInput {
  date: string;
  booked: number; taken: number; closed: number; cashCents: number;
  closeRate: number | null; showRate: number | null;
  reviewed: number;
}

/** The numeric header of the DAILY SALES BRIEF is rendered by us, never by the model. */
export function renderDigestHeader(h: DigestHeaderInput): string {
  return [
    `*DAILY SALES BRIEF* | ${h.date}`,
    `${h.taken} taken of ${h.booked} booked | ${h.closed} closed | ${money(h.cashCents)} cash | ${pct(h.closeRate)} close | ${pct(h.showRate)} show | ${h.reviewed} reviewed`,
    `_show = taken ÷ (taken + no-shows); close = closed ÷ taken; source: sales tracker_`,
  ].join("\n");
}

export const DIGEST_BODY_TEMPLATE = `*DAY IN REVIEW*
{one paragraph: what happened, the single biggest theme}

*PER-CLOSER*
*{closer}* ({calls} calls, {close_rate} close, avg grade {grade})
Strong: {strengths, tied to moments from today's calls}
Fix: {weaknesses, tied to moments}
Drill: {the one drill this week}
{repeat per closer who took calls today; skip closers with zero calls}

*TOP 3 LOW-HANGING FRUIT*
1. {fix — which call showed it, the exact behaviour change, why it moves money}
2. {...}
3. {...}

*WATCH LIST*
{closer} — {what is drifting in the 14-day trend}
{or "None today"}

*FLAG FOR MANAGEMENT*
{systemic issues only: lead quality, setter expectation gaps, offer confusion, cross-closer objections that signal messaging, ad-to-call mismatch, recording gaps}
{or "None today"}

*CALLS TO REVIEW*
{closer} x {prospect} — {reason}
{or "None today"}

*ACTION ITEMS*
{who — what, by when}
{or "None today"}`;

/* ------------------------------ marketer digest ----------------------------- */

export const MARKETING_TEMPLATE = `*DAILY MARKETING BRIEF* | {date}
_For Alex. {calls} calls analyzed | {show_rate} show rate | {close_rate} close rate_

*AUDIENCE LANGUAGE*
"{verbatim quote}" — {one line: what it signals}
{3-6 quotes}

*RECURRING OBJECTIONS MTD*
{category} ({count}): "{verbatim example}"
{top 3-5; then one line on the trend vs the prior days}

*AD-TO-CALL MISMATCH*
{what the prospect expected vs what the call was, with the DM/ad source when known}
{or "None today"}

*HOOK OPPORTUNITIES*
{angle — the prospect language it comes from}
{2-4}

*CONTENT ANGLES*
{topic — why the calls say the market needs it}
{2-4}

*PRIORITY ACTIONS*
1. {action}
2. {action}`;

/* ------------------------------- weekly report ------------------------------ */

export const WEEKLY_TEMPLATE = `*WEEKLY PATTERN REPORT* | Week of {week_start}

*WEEK*
{taken} taken of {booked} booked | {closed} closed | {cash} cash | {close_rate} close | {show_rate} show

*CLOSER TRENDS*
*{closer}* {calls} calls, avg {grade}, {improving|declining|stable}
{one line assessment vs last week}
{repeat per closer}

*OBJECTION PATTERNS*
{category}: {count} ({up|down|flat} vs last week)
{top 3-5}

*AD ANGLE PERFORMANCE*
{angle — close %, show %, calls} or "Insufficient data"

*SETTER PERFORMANCE*
{setter} — {show %} show, {lead quality note from the handoff analyses}
{repeat per setter or "No setter data this week"}

*MARKETING INSIGHTS*
{insight 1}
{insight 2}
{insight 3}
Top prospect language of the week:
"{quote}"
"{quote}"

*COACHING FOCUS*
{closer} — {reason}
{or "No priority this week"}

*REVIEW QUEUE*
{closer} x {prospect} — {reason}
{or "None this week"}`;

/** Slack keeps long posts readable only up to a point; trim and link out. */
export function fitSlack(text: string, max = 3800, link?: string): string {
  const t = text.trim();
  if (t.length <= max) return link ? `${t}\n\n${link}` : t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf("\n");
  return `${cut.slice(0, at > max * 0.6 ? at : max).trimEnd()}\n\n(Trimmed for Slack.)${link ? `\n${link}` : ""}`;
}
