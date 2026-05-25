// Weekly Check-In Digest — built and emailed every Sunday 4 PM PKT.
//
// The digest is the manager's (Saeed) single source of truth for what
// the client base is reporting that week. Replaces the per-form Slack
// alert that was originally specced — per-form pings created too much
// noise and made it harder to see patterns.
//
// Contents (in order):
//   1. KPI strip: submissions, avg score, attention-needed count, % missing
//   2. AI-generated executive summary (Claude Sonnet 4.5, 300-400 words)
//   3. Attention Needed table: clients with this week's avg < 60
//   4. Coach Engagement table: per-coach % of active clients missing
//      this week (sorted desc, high = losing engagement)
//   5. Missing Check-Ins: grouped by coach, full list of skip-this-week clients
//   6. "End date may need fixing" notes: clients with negative days_left
//      who submitted anyway (likely stale CCOS status)
//
// Week boundary: This Monday 00:00 PKT → cron firing moment (Sun 4 PM PKT).
// We accept the last 8 hours of Sunday data are missing — clients almost
// never submit Sunday evening anyway.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { sendEmail, type SendEmailResult } from "@/lib/email/resend";
import { ATTENTION_NEEDED_THRESHOLD } from "@/lib/check-in/types";
import { stripDashes } from "@/lib/daily-coacher/text-cleanup";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // PKT = UTC+5, no DST
const MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_RECIPIENT = "saeed16765@gmail.com";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface CheckInRow {
  id: number;
  client_id: number | null;
  client_name: string;
  coach_name: string | null;
  q1_overall: number;
  q2_strength: number;
  q3_lifestyle: number;
  q4_progress: number;
  q5_open_response: string | null;
  score_0_100: number;
  submitted_at: string;
}

interface ClientRow {
  id: number;
  name: string;
  coach_name: string | null;
  status: string | null;
  end_date: string | null;
}

interface PerClientThisWeek {
  clientId: number | null;
  clientName: string;
  coachName: string | null;
  submissions: CheckInRow[];
  avgScore: number;
  endDateNegative: boolean; // submitted but days_left <= 0
}

interface PerCoachEngagement {
  coachName: string;
  activeClientCount: number; // active + days_left > 0
  submittedClientCount: number;
  missingClientCount: number;
  missingPct: number;
  missingClients: string[]; // sorted by name
}

export interface DigestData {
  weekStartPkt: Date; // Mon 00:00 PKT
  weekEndPkt: Date; // cron firing moment in PKT
  submissions: CheckInRow[];
  perClient: PerClientThisWeek[];
  perCoach: PerCoachEngagement[];
  attentionClients: PerClientThisWeek[]; // weekly avg < 60
  totalActiveClientsWithDaysLeft: number;
  totalMissingClients: number; // across all active clients
  netAvgScore: number | null;
  endDateFlagged: PerClientThisWeek[]; // negative days_left + submitted
}

// ---------------------------------------------------------------------------
// Week boundary computation
// ---------------------------------------------------------------------------

/** Returns this Monday at 00:00 PKT, expressed as a UTC Date object. */
export function getThisWeekMondayPkt(now: Date = new Date()): Date {
  // Shift to PKT, find Monday of the current week, then shift back to UTC.
  const nowPkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const dayOfWeek = nowPkt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon→0, Sun→6
  const mondayPkt = new Date(nowPkt);
  mondayPkt.setUTCDate(mondayPkt.getUTCDate() - daysBack);
  mondayPkt.setUTCHours(0, 0, 0, 0);
  // Convert PKT-as-UTC back to true UTC by subtracting offset.
  return new Date(mondayPkt.getTime() - PKT_OFFSET_MS);
}

function formatDatePkt(d: Date): string {
  // Format a UTC date as PKT calendar date
  const pkt = new Date(d.getTime() + PKT_OFFSET_MS);
  return pkt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysLeftFromEndDate(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

export async function gatherDigestData(now: Date = new Date()): Promise<DigestData> {
  const supabase = getServiceSupabase();
  const weekStartUtc = getThisWeekMondayPkt(now);

  // 1. All submissions this week (UTC ISO comparison works fine)
  const { data: subsData } = await supabase
    .from("client_check_ins")
    .select(
      "id, client_id, client_name, coach_name, q1_overall, q2_strength, q3_lifestyle, q4_progress, q5_open_response, score_0_100, submitted_at"
    )
    .gt("submitted_at", weekStartUtc.toISOString())
    .order("submitted_at", { ascending: true });
  const submissions = (subsData ?? []) as CheckInRow[];

  // 2. All active clients with positive days_left (denominator for missing %)
  const { data: activeData } = await supabase
    .from("clients")
    .select("id, name, coach_name, status, end_date")
    .eq("status", "active");
  const todayMs = Date.now();
  const activeClients: ClientRow[] = ((activeData ?? []) as ClientRow[]).filter(
    (c) => {
      if (!c.end_date) return false;
      const end = new Date(c.end_date).getTime();
      return !Number.isNaN(end) && end > todayMs;
    }
  );

  // 3. Group submissions by client
  const byClient = new Map<string, CheckInRow[]>();
  for (const s of submissions) {
    const key = s.client_id ? `id:${s.client_id}` : `name:${s.client_name}`;
    (byClient.get(key) ?? byClient.set(key, []).get(key)!).push(s);
  }
  const perClient: PerClientThisWeek[] = Array.from(byClient.entries()).map(
    ([, subs]) => {
      const avg = Math.round(
        subs.reduce((a, b) => a + b.score_0_100, 0) / subs.length
      );
      // Match snapshot client_id to current active list to derive days_left
      const cid = subs[0].client_id;
      const client = cid ? activeClients.find((c) => c.id === cid) : undefined;
      // If client exists but has negative/zero days_left, flag
      // Look it up in the full clients list (we only fetched active above)
      let endDateNegative = false;
      if (cid && !client) {
        // Not in active list — might be completed or end_date passed. Re-fetch
        // is expensive for this one check; just mark as potentially-flagged.
        endDateNegative = true;
      }
      return {
        clientId: cid,
        clientName: subs[0].client_name,
        coachName: subs[0].coach_name,
        submissions: subs,
        avgScore: avg,
        endDateNegative,
      };
    }
  );

  // 4. Per-coach engagement: for each coach with active clients, count who
  //    submitted this week vs. who's missing.
  const submittedClientIds = new Set(
    perClient.map((p) => p.clientId).filter(Boolean) as number[]
  );
  const coachMap = new Map<string, ClientRow[]>();
  for (const c of activeClients) {
    if (!c.coach_name) continue;
    (coachMap.get(c.coach_name) ?? coachMap.set(c.coach_name, []).get(c.coach_name)!)
      .push(c);
  }
  const perCoach: PerCoachEngagement[] = Array.from(coachMap.entries())
    .map(([coachName, clients]) => {
      const missing = clients.filter((c) => !submittedClientIds.has(c.id));
      return {
        coachName,
        activeClientCount: clients.length,
        submittedClientCount: clients.length - missing.length,
        missingClientCount: missing.length,
        missingPct: Math.round((missing.length / clients.length) * 100),
        missingClients: missing.map((c) => c.name).sort(),
      };
    })
    .sort((a, b) => b.missingPct - a.missingPct);

  const attentionClients = perClient.filter(
    (p) => p.avgScore < ATTENTION_NEEDED_THRESHOLD
  );

  const totalMissingClients = perCoach.reduce(
    (acc, c) => acc + c.missingClientCount,
    0
  );

  const netAvgScore =
    submissions.length > 0
      ? Math.round(
          submissions.reduce((a, b) => a + b.score_0_100, 0) / submissions.length
        )
      : null;

  // End-date-flagged: clients who submitted but days_left <= 0. Need their
  // actual end_date for the note; re-fetch by ID for the flagged subset.
  const flaggedIds = perClient
    .filter((p) => p.endDateNegative)
    .map((p) => p.clientId)
    .filter(Boolean) as number[];
  const endDateFlagged: PerClientThisWeek[] = [];
  if (flaggedIds.length > 0) {
    const { data: flaggedClients } = await supabase
      .from("clients")
      .select("id, end_date, status")
      .in("id", flaggedIds);
    const flaggedMeta = new Map(
      (flaggedClients ?? []).map((c) => [
        c.id as number,
        { endDate: c.end_date as string | null, status: c.status as string | null },
      ])
    );
    for (const p of perClient) {
      if (!p.endDateNegative || !p.clientId) continue;
      const meta = flaggedMeta.get(p.clientId);
      // Truly negative days_left + status active → real flag
      const days = daysLeftFromEndDate(meta?.endDate ?? null);
      if (meta?.status === "active" && days !== null && days <= 0) {
        endDateFlagged.push(p);
      }
    }
  }

  return {
    weekStartPkt: weekStartUtc,
    weekEndPkt: now,
    submissions,
    perClient,
    perCoach,
    attentionClients,
    totalActiveClientsWithDaysLeft: activeClients.length,
    totalMissingClients,
    netAvgScore,
    endDateFlagged,
  };
}

// ---------------------------------------------------------------------------
// Claude summary
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return key;
}

function buildSummaryPrompt(d: DigestData): string {
  // Compact structured dump of every submission's data so Claude can
  // both quote specifics and detect patterns. Includes coach + paragraph
  // so coach-level themes are visible.
  const subsBlock = d.submissions.length === 0
    ? "(zero submissions this week)"
    : d.submissions
        .map((s) => {
          const datePkt = formatDatePkt(new Date(s.submitted_at));
          const coach = s.coach_name ?? "(no coach)";
          const para = s.q5_open_response?.trim()
            ? `  paragraph: ${s.q5_open_response.trim().replace(/\n/g, " ")}`
            : "  paragraph: (none)";
          return `[${datePkt}] ${s.client_name} (coach: ${coach}) — score ${s.score_0_100}/100 (Q1 coaching=${s.q1_overall}, Q2 strength=${s.q2_strength}, Q3 nutrition+sleep=${s.q3_lifestyle}, Q4 progress=${s.q4_progress})\n${para}`;
        })
        .join("\n\n");

  const coachStats = d.perCoach
    .map(
      (c) =>
        `  ${c.coachName}: ${c.missingClientCount}/${c.activeClientCount} missing (${c.missingPct}%)`
    )
    .join("\n");

  return `You are summarizing this week's CCOS client check-in forms for Saeed, the manager of the entire coaching operation. Saeed reads this email Sunday evening and uses it to know which clients and which coaches need attention this coming week.

WEEK: ${formatDatePkt(d.weekStartPkt)} – ${formatDatePkt(d.weekEndPkt)}
TOTAL SUBMISSIONS: ${d.submissions.length}
NET AVG SCORE: ${d.netAvgScore ?? "N/A"}/100
ACTIVE CLIENTS WITH POSITIVE DAYS LEFT: ${d.totalActiveClientsWithDaysLeft}
MISSING CHECK-INS: ${d.totalMissingClients}/${d.totalActiveClientsWithDaysLeft}

ALL SUBMISSIONS THIS WEEK:
${subsBlock}

PER-COACH MISSING %:
${coachStats || "(no active clients)"}

WRITE A 300-400 WORD EXECUTIVE SUMMARY for Saeed covering:
- Overall mood and health of the client base this week (themes from the numeric scores AND paragraphs)
- Standout positive feedback (name specific clients + what they said)
- Standout concerns (name specific clients + what's happening — be candid about who is struggling and why)
- Coach-level patterns worth investigating (high missing %, clusters of low scores under one coach, etc.)
- Anything else that would help Saeed manage the team and clients next week

WRITING RULES:
- Direct manager-to-manager tone. Saeed already knows the team; no need to over-explain.
- Quote client paragraphs when they capture something specific. Use quotation marks.
- NO em-dashes or en-dashes (—, –). Use commas, periods, parentheses, or restructure.
- Plain prose paragraphs, not bullet lists. Email already has tables below this summary.
- Output ONLY the summary text. No preamble, no headings, no closing.`;
}

export async function generateSummaryWithClaude(d: DigestData): Promise<string> {
  // Don't waste an LLM call on zero data; just write a deterministic message.
  if (d.submissions.length === 0) {
    return "No client check-in forms were submitted this week. Every active client with positive days left is on the missing list below. This warrants immediate investigation: either the form link did not go out, the link is broken, or all coaches simultaneously skipped this week's send. Review the coach engagement table below and confirm the link is reaching clients via Everfit before next week.";
  }

  const anthropic = new Anthropic({ apiKey: getApiKey() });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildSummaryPrompt(d) }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    return "(summary generation returned no text — check Anthropic logs)";
  }
  return stripDashes(block.text.trim());
}

// ---------------------------------------------------------------------------
// HTML email rendering
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scoreColor(score: number): string {
  if (score >= 75) return "#7ec9a0"; // success
  if (score >= 50) return "#e8c267"; // warning
  return "#d98e8e"; // danger
}

export function renderDigestEmail(d: DigestData, summary: string): string {
  const weekLabel = `${formatDatePkt(d.weekStartPkt)} – ${formatDatePkt(d.weekEndPkt)}`;
  const netAvgDisplay = d.netAvgScore === null ? "—" : `${d.netAvgScore}/100`;
  const totalMissingPct = d.totalActiveClientsWithDaysLeft > 0
    ? Math.round((d.totalMissingClients / d.totalActiveClientsWithDaysLeft) * 100)
    : 0;

  const kpiCell = (label: string, value: string, color = "#ffffff") => `
    <td style="padding: 16px; background: #16161e; border-radius: 8px; border: 1px solid #2a2a35; text-align: center;">
      <div style="font-size: 10px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">${escapeHtml(label)}</div>
      <div style="font-size: 24px; font-weight: 700; color: ${color};">${escapeHtml(value)}</div>
    </td>`;

  const attentionRows = d.attentionClients.length === 0
    ? `<tr><td colspan="4" style="padding: 14px; color: #8a8a96; text-align: center; font-style: italic;">No clients flagged this week.</td></tr>`
    : d.attentionClients
        .map((c) => {
          const lastPara = [...c.submissions].reverse().find((s) => s.q5_open_response?.trim())?.q5_open_response?.trim() ?? "";
          const paraTrunc = lastPara.length > 220 ? lastPara.slice(0, 219) + "…" : lastPara;
          return `
        <tr>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: #ffffff; font-weight: 600;">${escapeHtml(c.clientName)}</td>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: #c4c4cc;">${escapeHtml(c.coachName ?? "—")}</td>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: ${scoreColor(c.avgScore)}; font-weight: 700;">${c.avgScore}/100</td>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: #c4c4cc; font-size: 13px;">${escapeHtml(paraTrunc) || "<span style='color:#8a8a96;font-style:italic;'>(no paragraph)</span>"}</td>
        </tr>`;
        })
        .join("");

  const coachRows = d.perCoach.length === 0
    ? `<tr><td colspan="4" style="padding: 14px; color: #8a8a96; text-align: center; font-style: italic;">No active clients with end dates.</td></tr>`
    : d.perCoach
        .map((c) => {
          const pctColor = c.missingPct >= 50 ? "#d98e8e" : c.missingPct >= 25 ? "#e8c267" : "#7ec9a0";
          return `
        <tr>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: #ffffff; font-weight: 600;">${escapeHtml(c.coachName)}</td>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: #c4c4cc;">${c.activeClientCount}</td>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: #c4c4cc;">${c.missingClientCount}</td>
          <td style="padding: 10px 12px; border-top: 1px solid #2a2a35; color: ${pctColor}; font-weight: 700;">${c.missingPct}%</td>
        </tr>`;
        })
        .join("");

  const missingSections = d.perCoach
    .filter((c) => c.missingClientCount > 0)
    .map((c) => `
      <div style="margin-top: 12px; padding: 12px; background: #16161e; border: 1px solid #2a2a35; border-radius: 8px;">
        <div style="font-size: 13px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">${escapeHtml(c.coachName)} — ${c.missingClientCount} missing</div>
        <div style="font-size: 12px; color: #c4c4cc; line-height: 1.6;">${c.missingClients.map(escapeHtml).join(", ")}</div>
      </div>`)
    .join("");

  const endDateFlaggedSection = d.endDateFlagged.length === 0 ? "" : `
    <h2 style="margin: 32px 0 12px; font-size: 16px; font-weight: 600; color: #ffffff;">⚠️ End date may need fixing</h2>
    <div style="padding: 12px; background: #2d1c1c; border: 1px solid #5a3030; border-radius: 8px; color: #f4d8d8; font-size: 13px; line-height: 1.6;">
      The following clients submitted a check-in this week but their CCOS end date has already passed. If they are still active, update their end date on the Client Roster:
      <ul style="margin: 8px 0 0 20px; padding: 0;">
        ${d.endDateFlagged.map((c) => `<li>${escapeHtml(c.clientName)}${c.coachName ? ` (${escapeHtml(c.coachName)})` : ""}</li>`).join("")}
      </ul>
    </div>`;

  return `<!DOCTYPE html>
<html><body style="margin: 0; padding: 0; background: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
<div style="max-width: 720px; margin: 0 auto; padding: 32px 20px;">

  <div style="margin-bottom: 24px;">
    <div style="font-size: 11px; color: #c9a96e; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">CCOS · Weekly Digest</div>
    <h1 style="margin: 6px 0 4px; font-size: 24px; font-weight: 700; color: #ffffff;">Client Check-In Summary</h1>
    <div style="font-size: 13px; color: #8a8a96;">${escapeHtml(weekLabel)}</div>
  </div>

  <table cellpadding="0" cellspacing="8" style="width: 100%; border-collapse: separate;">
    <tr>
      ${kpiCell("Submissions", String(d.submissions.length))}
      ${kpiCell("Net avg score", netAvgDisplay, d.netAvgScore == null ? "#8a8a96" : scoreColor(d.netAvgScore))}
      ${kpiCell("Attention needed", String(d.attentionClients.length), d.attentionClients.length > 0 ? "#d98e8e" : "#ffffff")}
      ${kpiCell("Missing this week", `${totalMissingPct}%`, totalMissingPct >= 50 ? "#d98e8e" : totalMissingPct >= 25 ? "#e8c267" : "#7ec9a0")}
    </tr>
  </table>

  <h2 style="margin: 32px 0 12px; font-size: 16px; font-weight: 600; color: #ffffff;">Summary</h2>
  <div style="padding: 16px 18px; background: #16161e; border: 1px solid #2a2a35; border-radius: 8px; color: #d4d4dc; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(summary)}</div>

  <h2 style="margin: 32px 0 12px; font-size: 16px; font-weight: 600; color: #ffffff;">Attention Needed <span style="color: #8a8a96; font-weight: 400; font-size: 13px;">(weekly avg &lt; ${ATTENTION_NEEDED_THRESHOLD})</span></h2>
  <table style="width: 100%; border-collapse: collapse; background: #16161e; border: 1px solid #2a2a35; border-radius: 8px; overflow: hidden;">
    <thead><tr style="background: #1f1f29;">
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Client</th>
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Coach</th>
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Avg this week</th>
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Latest paragraph</th>
    </tr></thead>
    <tbody>${attentionRows}</tbody>
  </table>

  <h2 style="margin: 32px 0 12px; font-size: 16px; font-weight: 600; color: #ffffff;">Coach Engagement <span style="color: #8a8a96; font-weight: 400; font-size: 13px;">(high missing % = losing client engagement)</span></h2>
  <table style="width: 100%; border-collapse: collapse; background: #16161e; border: 1px solid #2a2a35; border-radius: 8px; overflow: hidden;">
    <thead><tr style="background: #1f1f29;">
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Coach</th>
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Active clients</th>
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">Missing</th>
      <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #8a8a96; text-transform: uppercase; letter-spacing: 0.5px;">% missing</th>
    </tr></thead>
    <tbody>${coachRows}</tbody>
  </table>

  <h2 style="margin: 32px 0 4px; font-size: 16px; font-weight: 600; color: #ffffff;">Missing check-ins by coach</h2>
  ${missingSections || `<div style="padding: 12px; color: #8a8a96; font-style: italic;">Everyone submitted this week.</div>`}

  ${endDateFlaggedSection}

  <div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #2a2a35; text-align: center; font-size: 11px; color: #8a8a96;">
    CCOS · Client Conversion · <a href="https://client-conversion-os.vercel.app/coaching" style="color: #c9a96e; text-decoration: none;">Open Client Progress tab</a>
  </div>

</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface BuildAndSendResult {
  digest: DigestData;
  summary: string;
  email: SendEmailResult;
}

/**
 * Top-level: gather data, run Claude, render HTML, send email.
 * Returns the data + result so the cron handler can log + respond.
 */
export async function buildAndSendWeeklyDigest(
  recipient: string = DEFAULT_RECIPIENT,
  now: Date = new Date()
): Promise<BuildAndSendResult> {
  const digest = await gatherDigestData(now);
  const summary = await generateSummaryWithClaude(digest);
  const html = renderDigestEmail(digest, summary);
  const weekLabel = `${formatDatePkt(digest.weekStartPkt)} – ${formatDatePkt(digest.weekEndPkt)}`;
  const subject = `CCOS Weekly Check-In Digest · ${weekLabel}`;
  const email = await sendEmail({ to: recipient, subject, html });
  return { digest, summary, email };
}
