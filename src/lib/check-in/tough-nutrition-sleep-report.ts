/**
 * Tough Nutrition + Sleep report.
 *
 * Sent to Saeed as a Slack DM every Sunday 30 minutes after the weekly
 * check-in digest. Lists every client whose LOWEST q3_lifestyle
 * (nutrition + sleep) score this week was 4 or below on the 1-10 slider.
 *
 * The check-in form combines nutrition and sleep into a single Q3 slider:
 * "How well did you manage nutrition and sleep in the last 7 days?"
 * A low Q3 means the client struggled with one or both.
 *
 * The report uses the SAME week window as the big weekly digest so both
 * reports always describe the same seven days. If a client submitted
 * multiple times in the week, the MIN of their q3_lifestyle values is
 * used to decide inclusion, since we want to catch any bad stretch, not
 * average it out.
 */

import { getServiceSupabase } from "@/lib/supabase";
import {
  ADMIN_SLACK_USER_ID,
  openDmChannel,
  postBlocks,
} from "@/lib/slack/coaching-bot";
import { getThisWeekMondayPkt } from "@/lib/check-in/weekly-digest";

export const TOUGH_THRESHOLD = 4;

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://client-conversion-os.vercel.app";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

interface CheckInMinRow {
  client_id: number | null;
  client_name: string;
  coach_name: string | null;
  q3_lifestyle: number;
  submitted_at: string;
}

export interface ToughClient {
  clientName: string;
  coachName: string | null;
  worstScore: number;
  submissionCount: number;
}

export interface ToughReportData {
  weekStart: Date;
  weekEnd: Date;
  toughClients: ToughClient[];
  totalSubmissionsThisWeek: number;
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

export async function gatherToughReport(
  now: Date = new Date(),
): Promise<ToughReportData> {
  const supabase = getServiceSupabase();
  const weekStart = getThisWeekMondayPkt(now);

  const { data, error } = await supabase
    .from("client_check_ins")
    .select("client_id, client_name, coach_name, q3_lifestyle, submitted_at")
    .gt("submitted_at", weekStart.toISOString());
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const rows = (data ?? []) as CheckInMinRow[];

  // Group by client (id preferred, name fallback) so multiple submissions
  // in the same week collapse into one row per client.
  const byClient = new Map<string, CheckInMinRow[]>();
  for (const r of rows) {
    const key = r.client_id ? `id:${r.client_id}` : `name:${r.client_name}`;
    const list = byClient.get(key);
    if (list) list.push(r);
    else byClient.set(key, [r]);
  }

  const tough: ToughClient[] = [];
  for (const [, subs] of byClient) {
    const worst = subs.reduce((min, r) => Math.min(min, r.q3_lifestyle), Infinity);
    if (worst <= TOUGH_THRESHOLD) {
      tough.push({
        clientName: subs[0].client_name,
        coachName: subs[0].coach_name,
        worstScore: worst,
        submissionCount: subs.length,
      });
    }
  }

  // Sort by worst score ascending (most concerning first), then by name.
  tough.sort((a, b) => {
    if (a.worstScore !== b.worstScore) return a.worstScore - b.worstScore;
    return a.clientName.localeCompare(b.clientName);
  });

  return {
    weekStart,
    weekEnd: now,
    toughClients: tough,
    totalSubmissionsThisWeek: rows.length,
  };
}

export function buildToughReportBlocks(d: ToughReportData): unknown[] {
  const blocks: unknown[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "Tough Week: Nutrition + Sleep",
      emoji: true,
    },
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Week of ${formatDatePkt(d.weekStart)} to ${formatDatePkt(d.weekEnd)} (PKT). Clients whose lowest nutrition+sleep score this week was ${TOUGH_THRESHOLD} or below out of 10.`,
      },
    ],
  });

  if (d.toughClients.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: *No clients flagged this week.* All ${d.totalSubmissionsThisWeek} submissions scored above ${TOUGH_THRESHOLD}/10 on nutrition and sleep.`,
      },
    });
    return blocks;
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${d.toughClients.length} client${d.toughClients.length === 1 ? "" : "s"} had a rough week with nutrition or sleep:*`,
    },
  });

  // Slack section text is capped at 3000 chars. Each line is ~80 chars so
  // 30 clients fits comfortably. Chunk into groups of 20 as a safety net
  // in case there is a really bad week.
  const lines = d.toughClients.map((c) => {
    const coach = c.coachName ? ` _(${c.coachName})_` : "";
    return `• *${c.clientName}*${coach} — ${c.worstScore}/10`;
  });

  const CHUNK = 20;
  for (let i = 0; i < lines.length; i += CHUNK) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.slice(i, i + CHUNK).join("\n"),
      },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open Client Progress", emoji: true },
        url: `${APP_BASE_URL}/coaching`,
        action_id: "open_client_progress_tough_nutrition_sleep",
        style: "primary",
      },
    ],
  });

  return blocks;
}

export interface BuildAndSendResult {
  data: ToughReportData;
  slack: { ok: boolean; error?: string };
}

export async function buildAndSendToughReport(
  now: Date = new Date(),
): Promise<BuildAndSendResult> {
  const data = await gatherToughReport(now);
  const blocks = buildToughReportBlocks(data);

  const channel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!channel) {
    return {
      data,
      slack: {
        ok: false,
        error: "Could not open admin DM channel (check SLACK_BOT_TOKEN_COACHING)",
      },
    };
  }

  const fallback =
    data.toughClients.length === 0
      ? "Tough Nutrition + Sleep report: no clients flagged this week."
      : `Tough Nutrition + Sleep report: ${data.toughClients.length} clients flagged this week.`;

  const result = await postBlocks(channel, blocks, fallback);
  return {
    data,
    slack: {
      ok: result.ok,
      error: result.ok ? undefined : (result as { error?: string }).error,
    },
  };
}
