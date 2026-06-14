// Weekly Check-In Digest — built and DM'd to Saeed every Sunday 4 PM PKT.
//
// Single source of truth for the manager's view of the client base for
// the week. Replaces both the per-form Slack DM (too noisy) and the
// earlier short-lived email implementation (Slack is the channel
// for everything else in CCOS, no reason to split notifications).
//
// Contents (in order):
//   1. KPI fields: submissions, avg score, attention-needed count, % missing
//   2. AI-generated executive summary (Claude Sonnet 4.5, 300-400 words)
//   3. Attention Needed: clients with this week's avg < 60
//   4. Coach Engagement: per-coach % of active clients missing this week
//   5. Missing Check-Ins: grouped by coach, full list
//   6. End-date-needs-fixing flag (clients with negative days_left who
//      still submitted — likely their CCOS record is stale)
//
// Week boundary: This Monday 00:00 PKT → cron firing moment (Sun 4 PM PKT).
// Last 8 hours of Sunday data are knowingly excluded; clients almost
// never submit Sunday evening anyway.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import {
  ADMIN_SLACK_USER_ID,
  openDmChannel,
  postBlocks,
} from "@/lib/slack/coaching-bot";
import { ATTENTION_NEEDED_THRESHOLD } from "@/lib/check-in/types";
import { stripDashes } from "@/lib/daily-coacher/text-cleanup";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // PKT = UTC+5, no DST
const MODEL = "claude-sonnet-4-5-20250929";
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://client-conversion-os.vercel.app";

// Slack section.text mrkdwn is capped at 3000 chars. The summary
// prompt asks for 300-400 words (~2000 chars) so we have headroom,
// but truncate just in case.
const SLACK_SECTION_TEXT_LIMIT = 2900;
const MAX_ATTENTION_CLIENTS_INLINE = 10;

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
  endDateNegative: boolean;
}

interface PerCoachEngagement {
  coachName: string;
  activeClientCount: number;
  submittedClientCount: number;
  missingClientCount: number;
  missingPct: number;
  missingClients: string[];
  /** Names of this coach's clients who DID submit this week, sorted
   *  alphabetically. Mirror of missingClients; lets the digest show
   *  who showed up as well as who didn't. */
  submittedClients: string[];
  /** Avg of per-client weekly scores for this coach's submitters
   *  (each client weighted equally, not each submission). null when
   *  no client submitted. */
  coachAvgScore: number | null;
}

export interface DigestData {
  weekStartPkt: Date;
  weekEndPkt: Date;
  submissions: CheckInRow[];
  perClient: PerClientThisWeek[];
  perCoach: PerCoachEngagement[];
  attentionClients: PerClientThisWeek[];
  totalActiveClientsWithDaysLeft: number;
  totalMissingClients: number;
  netAvgScore: number | null;
  endDateFlagged: PerClientThisWeek[];
}

// ---------------------------------------------------------------------------
// Week boundary computation
// ---------------------------------------------------------------------------

/** Returns this Monday at 00:00 PKT, expressed as a UTC Date object. */
export function getThisWeekMondayPkt(now: Date = new Date()): Date {
  const nowPkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const dayOfWeek = nowPkt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayPkt = new Date(nowPkt);
  mondayPkt.setUTCDate(mondayPkt.getUTCDate() - daysBack);
  mondayPkt.setUTCHours(0, 0, 0, 0);
  return new Date(mondayPkt.getTime() - PKT_OFFSET_MS);
}

function formatDatePkt(d: Date): string {
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

  // 1. All submissions this week
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
      const cid = subs[0].client_id;
      const client = cid ? activeClients.find((c) => c.id === cid) : undefined;
      let endDateNegative = false;
      if (cid && !client) endDateNegative = true;
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

  // 4. Per-coach engagement
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
      const submitted = clients.filter((c) => submittedClientIds.has(c.id));
      // Average of per-client weekly avgs for this coach's submitters
      // (matches the per-coach Client Progress boost logic in
      // CoachPerformanceTab — each client weighted equally, not each
      // submission). null when nobody submitted.
      const submittedIdSet = new Set(submitted.map((c) => c.id));
      const submittedPerClient = perClient.filter(
        (p) => p.coachName === coachName && p.clientId && submittedIdSet.has(p.clientId),
      );
      const coachAvgScore = submittedPerClient.length > 0
        ? Math.round(
            submittedPerClient.reduce((sum, p) => sum + p.avgScore, 0) /
              submittedPerClient.length,
          )
        : null;
      return {
        coachName,
        activeClientCount: clients.length,
        submittedClientCount: clients.length - missing.length,
        missingClientCount: missing.length,
        missingPct: Math.round((missing.length / clients.length) * 100),
        missingClients: missing.map((c) => c.name).sort(),
        submittedClients: submitted.map((c) => c.name).sort(),
        coachAvgScore,
      };
    })
    .sort((a, b) => b.missingPct - a.missingPct);

  const attentionClients = perClient
    .filter((p) => p.avgScore < ATTENTION_NEEDED_THRESHOLD)
    .sort((a, b) => a.avgScore - b.avgScore); // worst first

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

  // End-date-flagged: clients who submitted but days_left <= 0
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
    .map((c) => {
      const avgPart =
        c.coachAvgScore !== null
          ? `, ${c.submittedClientCount} submitted (avg ${c.coachAvgScore}/100)`
          : "";
      return `  ${c.coachName}: ${c.missingClientCount}/${c.activeClientCount} missing (${c.missingPct}%)${avgPart}`;
    })
    .join("\n");

  return `You are summarizing this week's CCOS client check-in forms for Saeed, the manager of the entire coaching operation. Saeed reads this Slack DM Sunday evening and uses it to know which clients and which coaches need attention this coming week.

WEEK: ${formatDatePkt(d.weekStartPkt)} to ${formatDatePkt(d.weekEndPkt)}
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
- Standout concerns (name specific clients + what's happening, be candid about who is struggling and why)
- Coach-level patterns worth investigating (high missing %, clusters of low scores under one coach, etc.)
- Anything else that would help Saeed manage the team and clients next week

WRITING RULES:
- Direct manager-to-manager tone. Saeed already knows the team; no need to over-explain.
- Quote client paragraphs when they capture something specific. Use quotation marks.
- NO em-dashes or en-dashes. Use commas, periods, parentheses, or restructure.
- Plain prose paragraphs, not bullet lists. The Slack message already has structured tables below this summary.
- Output ONLY the summary text. No preamble, no headings, no closing.`;
}

export async function generateSummaryWithClaude(d: DigestData): Promise<string> {
  if (d.submissions.length === 0) {
    return "No client check-in forms were submitted this week. Every active client with positive days left is on the missing list below. This warrants immediate investigation: either the form link did not go out, the link is broken, or all coaches simultaneously skipped this week's send. Review the coach engagement table below and confirm the link is reaching clients via Everfit before next week.";
  }

  const anthropic = new Anthropic({ apiKey: getApiKey() });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildSummaryPrompt(d) }],
  });

  logAiUsage({ feature: "check-in-weekly-digest", model: MODEL, usage: response.usage });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    return "(summary generation returned no text — check Anthropic logs)";
  }
  return stripDashes(block.text.trim());
}

// ---------------------------------------------------------------------------
// Slack Block Kit rendering
// ---------------------------------------------------------------------------

function truncateForSlack(text: string, max: number = SLACK_SECTION_TEXT_LIMIT): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function pctEmoji(pct: number): string {
  if (pct >= 50) return "🔴";
  if (pct >= 25) return "🟡";
  return "🟢";
}

function scoreEmoji(score: number): string {
  if (score >= 75) return "🟢";
  if (score >= 50) return "🟡";
  return "🔴";
}

/**
 * Build the Slack Block Kit blocks for the digest DM. Stays under
 * Slack's 50-block limit by collapsing long lists into multi-line
 * section text rather than one block per item.
 */
export function buildDigestSlackBlocks(
  d: DigestData,
  summary: string
): Array<Record<string, unknown>> {
  const weekLabel = `${formatDatePkt(d.weekStartPkt)} to ${formatDatePkt(d.weekEndPkt)}`;
  const netAvgDisplay = d.netAvgScore === null ? "—" : `${d.netAvgScore}/100`;
  const totalMissingPct = d.totalActiveClientsWithDaysLeft > 0
    ? Math.round((d.totalMissingClients / d.totalActiveClientsWithDaysLeft) * 100)
    : 0;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "CCOS Weekly Check-In Digest 📊",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Week of ${weekLabel}*` }],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Submissions*\n${d.submissions.length}` },
        { type: "mrkdwn", text: `*Net avg score*\n${netAvgDisplay}` },
        {
          type: "mrkdwn",
          text: `*Attention needed*\n${d.attentionClients.length} client${d.attentionClients.length === 1 ? "" : "s"}`,
        },
        {
          type: "mrkdwn",
          text: `*Missing this week*\n${totalMissingPct}% (${d.totalMissingClients}/${d.totalActiveClientsWithDaysLeft})`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Summary*\n${truncateForSlack(summary)}`,
      },
    },
    { type: "divider" },
  ];

  // Attention Needed section
  if (d.attentionClients.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🚨 Attention Needed* (weekly avg < ${ATTENTION_NEEDED_THRESHOLD})\n_No clients flagged this week._`,
      },
    });
  } else {
    const visible = d.attentionClients.slice(0, MAX_ATTENTION_CLIENTS_INLINE);
    const overflow = d.attentionClients.length - visible.length;
    const lines = visible.map((c) => {
      const lastPara = [...c.submissions]
        .reverse()
        .find((s) => s.q5_open_response?.trim())?.q5_open_response?.trim();
      const paraSnippet = lastPara
        ? ` — _"${lastPara.replace(/\n/g, " ").slice(0, 140)}${lastPara.length > 140 ? "…" : ""}"_`
        : "";
      const coach = c.coachName ? ` (${c.coachName})` : "";
      return `${scoreEmoji(c.avgScore)} *${c.clientName}*${coach} — *${c.avgScore}/100*${paraSnippet}`;
    });
    const moreLine = overflow > 0 ? `\n_+${overflow} more in Client Progress tab_` : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateForSlack(
          `*🚨 Attention Needed* (weekly avg < ${ATTENTION_NEEDED_THRESHOLD})\n${lines.join("\n")}${moreLine}`
        ),
      },
    });
  }

  // Coach Engagement section
  if (d.perCoach.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Coach Engagement*\n_No active clients with end dates._",
      },
    });
  } else {
    const lines = d.perCoach.map((c) => {
      const avgPart =
        c.coachAvgScore !== null
          ? `  ·  ${c.submittedClientCount} submitted (avg *${c.coachAvgScore}/100*)`
          : `  ·  0 submitted`;
      return `${pctEmoji(c.missingPct)} *${c.coachName}* — ${c.missingClientCount}/${c.activeClientCount} missing (*${c.missingPct}%*)${avgPart}`;
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateForSlack(
          `*Coach Engagement* (high missing % = losing client engagement)\n${lines.join("\n")}`
        ),
      },
    });
  }

  // Submitted Check-Ins per coach — mirrors the Missing section so
  // Saeed can see WHO showed up as well as who didn't.
  const coachesWithSubmissions = d.perCoach.filter((c) => c.submittedClientCount > 0);
  if (coachesWithSubmissions.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Submitted Check-Ins by Coach*" },
    });
    for (const c of coachesWithSubmissions) {
      // Block-limit defense; same as the Missing loop below.
      if (blocks.length >= 45) break;
      const names = c.submittedClients.join(", ");
      const avgPart =
        c.coachAvgScore !== null ? `, avg ${c.coachAvgScore}/100` : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateForSlack(
            `*${c.coachName}* (${c.submittedClientCount} submitted${avgPart}):\n${names}`
          ),
        },
      });
    }
  }

  // Missing Check-Ins per coach. Each coach with missing clients gets
  // its own section so we don't blow the 3000-char limit on a single
  // mrkdwn field when many coaches have many missing clients.
  const coachesWithMissing = d.perCoach.filter((c) => c.missingClientCount > 0);
  if (coachesWithMissing.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Missing Check-Ins by Coach*\n_Everyone submitted this week. 🎉_",
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Missing Check-Ins by Coach*" },
    });
    for (const c of coachesWithMissing) {
      // Slack's 50-block limit. If we somehow have >40 coaches with
      // missing clients, skip the rest — never going to happen in
      // practice, but defensive.
      if (blocks.length >= 45) break;
      const names = c.missingClients.join(", ");
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateForSlack(
            `*${c.coachName}* (${c.missingClientCount} missing):\n${names}`
          ),
        },
      });
    }
  }

  // End-date-flagged warning, only if any
  if (d.endDateFlagged.length > 0) {
    const names = d.endDateFlagged
      .map((c) => `${c.clientName}${c.coachName ? ` (${c.coachName})` : ""}`)
      .join(", ");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateForSlack(
          `⚠️ *End date may need fixing*\nThese clients submitted this week but their CCOS end date is past. If they are still active, update their end date on the Client Roster:\n${names}`
        ),
      },
    });
  }

  // Footer with link to Client Progress
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open Client Progress", emoji: true },
        url: `${APP_BASE_URL}/coaching`,
        action_id: "open_client_progress_weekly",
        style: "primary",
      },
    ],
  });

  return blocks;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface BuildAndSendResult {
  digest: DigestData;
  summary: string;
  slack: { ok: boolean; error?: string };
}

/**
 * Top-level: gather data, run Claude, render Slack blocks, DM Saeed.
 * Returns the data + result so the cron handler can log + respond.
 */
export async function buildAndSendWeeklyDigest(
  now: Date = new Date()
): Promise<BuildAndSendResult> {
  const digest = await gatherDigestData(now);
  const summary = await generateSummaryWithClaude(digest);
  const blocks = buildDigestSlackBlocks(digest, summary);

  const channel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!channel) {
    return {
      digest,
      summary,
      slack: { ok: false, error: "Could not open admin DM channel (check SLACK_BOT_TOKEN_COACHING)" },
    };
  }

  const fallback = `CCOS Weekly Check-In Digest: ${digest.submissions.length} submissions, ${digest.attentionClients.length} need attention.`;
  const result = await postBlocks(channel, blocks, fallback);

  return {
    digest,
    summary,
    slack: {
      ok: result.ok,
      error: result.ok ? undefined : (result as { error?: string }).error,
    },
  };
}
