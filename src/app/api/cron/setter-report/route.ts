import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { uploadFileAsCso } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import {
  formatResponseDuration,
  formatResponseGap,
  getSetterReportData,
  type SetterPeriodMetrics,
  type SetterReportRow,
} from "@/lib/setter-report-data";

const ACTION_ITEMS_PROMPT = `You are the sales manager. Your only job is to find the easiest next fix that can improve booking rate or show rate.

Return VALID JSON only. No markdown. No explanation outside JSON.

Schema:
{
  "setters": [
    {
      "setterKey": "amara",
      "actionItems": [
        "string",
        "string",
        "string"
      ]
    }
  ],
  "ceoActionItems": [
    "string",
    "string",
    "string",
    "string",
    "string"
  ]
}

Rules:
- Each setter must get 2 to 4 action items.
- Action items must be concrete and short.
- Use the numbers and transcript quotes provided.
- Focus on small script or behavior changes, not big process overhauls.
- If a setter has weak live data, say that clearly instead of faking confidence.
- CEO action items must be data-driven.
- If a script line is weak, say what line is weak and what line should replace it.
- Prioritize the biggest drop-off and the easiest lever to improve next.`;

interface ActionPayload {
  setters: Array<{
    setterKey: string;
    actionItems: string[];
  }>;
  ceoActionItems: string[];
}

function parseDateOnly(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(date: string, days: number) {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatLongDate(date: string) {
  return parseDateOnly(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDate(date: string) {
  return parseDateOnly(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function pickResponseMetric(...options: Array<{
  label: string;
  averageResponseMinutes: number | null;
  responseSampleCount?: number;
}>) {
  for (const option of options) {
    if ((option.responseSampleCount || 0) > 0 && option.averageResponseMinutes !== null) {
      return option;
    }
  }

  return {
    label: options[0]?.label || "Daily",
    averageResponseMinutes: null,
    responseSampleCount: 0,
  };
}

function formatMetricBlock(metrics: {
  newLeads: number;
  booked: number;
  showRate: number;
  averageResponseMinutes: number | null;
  responseSampleCount?: number;
}, responseFallbacks: Array<{
  label: string;
  averageResponseMinutes: number | null;
  responseSampleCount?: number;
}> = [], primaryLabel = "Daily") {
  const responseMetric = pickResponseMetric(
    {
      label: primaryLabel,
      averageResponseMinutes: metrics.averageResponseMinutes,
      responseSampleCount: metrics.responseSampleCount,
    },
    ...responseFallbacks,
  );
  const responseLabel =
    responseMetric.averageResponseMinutes === null
      ? "—"
      : responseMetric.label === "Daily"
        ? formatResponseDuration(responseMetric.averageResponseMinutes)
        : `${formatResponseDuration(responseMetric.averageResponseMinutes)} (${responseMetric.label})`;

  return [
    `- New Leads: ${metrics.newLeads}`,
    `- Appointments Booked: ${metrics.booked}`,
    `- Show Rate: ${formatPercent(metrics.showRate)}`,
    `- Avg Response Time: ${responseLabel}`,
  ].join("\n");
}

function aggregateMetrics(rows: SetterReportRow[], periodKey: "daily" | "wtd" | "mtd") {
  const metrics = rows.map((row) => row[periodKey]);
  const totalNewLeads = metrics.reduce((sum, row) => sum + row.newLeads, 0);
  const totalBooked = metrics.reduce((sum, row) => sum + row.booked, 0);
  const totalShowEligible = metrics.reduce((sum, row) => sum + row.showEligible, 0);
  const totalTaken = metrics.reduce((sum, row) => sum + row.taken, 0);
  const totalWins = metrics.reduce((sum, row) => sum + row.wins, 0);
  const totalCash = metrics.reduce((sum, row) => sum + row.cashCollected, 0);
  const totalResponseSamples = metrics.reduce((sum, row) => sum + row.responseSampleCount, 0);
  const responseWeightedMinutes = metrics.reduce(
    (sum, row) => sum + (row.averageResponseMinutes || 0) * row.responseSampleCount,
    0,
  );

  return {
    newLeads: totalNewLeads,
    booked: totalBooked,
    showRate: totalShowEligible > 0 ? (totalTaken / totalShowEligible) * 100 : 0,
    closeRate: totalTaken > 0 ? (totalWins / totalTaken) * 100 : 0,
    aov: totalWins > 0 ? totalCash / totalWins : 0,
    responseSampleCount: totalResponseSamples,
    averageResponseMinutes:
      totalResponseSamples > 0 ? responseWeightedMinutes / totalResponseSamples : null,
  };
}

function buildOfferGroups(setters: SetterReportRow[]) {
  const groups = new Map<string, SetterReportRow[]>();
  for (const setter of setters) {
    const list = groups.get(setter.clientLabel) || [];
    list.push(setter);
    groups.set(setter.clientLabel, list);
  }
  return [...groups.entries()].map(([label, rows]) => ({ label, rows }));
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(text.slice(start, end + 1)) as ActionPayload;
}

function fallbackActionPayload(setters: SetterReportRow[]): ActionPayload {
  return {
    setters: setters.map((setter) => ({
      setterKey: setter.setterKey,
      actionItems: setter.mtd.responseSampleCount === 0
        ? ["Get more live DM volume into CCOS before judging this setter."]
        : [
            "Shorten the time between lead reply and the next real sales question.",
            "Push the lead into the next funnel stage faster instead of sending soft follow-ups.",
          ],
    })),
    ceoActionItems: [
      "Check the biggest funnel drop-off first and fix one line there before changing the whole script.",
      "Push setters to replace soft follow-ups with direct stage-moving questions.",
    ],
  };
}

function buildActionContext(data: Awaited<ReturnType<typeof getSetterReportData>>) {
  const teamDaily = aggregateMetrics(data.setters, "daily");
  const teamWtd = aggregateMetrics(data.setters, "wtd");
  const teamMtd = aggregateMetrics(data.setters, "mtd");
  const offers = buildOfferGroups(data.setters);

  const setterParts = data.setters.map((setter) => {
    const worstGaps =
      setter.mtd.worstResponseGaps.length === 0
        ? "No completed response samples yet."
        : setter.mtd.worstResponseGaps.map((gap) => `- ${formatResponseGap(gap)}`).join("\n");

    const transcripts =
      setter.transcripts.length === 0
        ? "NO LIVE TRANSCRIPTS CAPTURED."
        : setter.transcripts
            .map((transcript) => {
              const leadLabel = transcript.leadName || "Unknown lead";
              return `[${leadLabel} | ${transcript.messageCount} messages | Latest ${transcript.latestMessageAt || "unknown"}]\n${transcript.transcript.substring(0, 2500)}`;
            })
            .join("\n\n--- NEXT TRANSCRIPT ---\n\n");

    const topDrop = [
      { label: "Engaged to Goal Clear", from: setter.mtd.engaged, to: setter.mtd.goalClear },
      { label: "Goal Clear to Gap Clear", from: setter.mtd.goalClear, to: setter.mtd.gapClear },
      { label: "Gap Clear to Stakes Clear", from: setter.mtd.gapClear, to: setter.mtd.stakesClear },
      { label: "Stakes Clear to Qualified", from: setter.mtd.stakesClear, to: setter.mtd.qualified },
      { label: "Qualified to Link Sent", from: setter.mtd.qualified, to: setter.mtd.linkSent },
      { label: "Link Sent to Booked", from: setter.mtd.linkSent, to: setter.mtd.booked },
    ]
      .map((item) => ({
        ...item,
        rate: item.from > 0 ? (item.to / item.from) * 100 : 0,
      }))
      .sort((a, b) => a.rate - b.rate)[0];

    return `
SETTER: ${setter.setterName} (${setter.setterKey}) | CLIENT: ${setter.clientLabel}
DAILY: new=${setter.daily.newLeads}, booked=${setter.daily.booked}, show=${formatPercent(setter.daily.showRate)}, response=${formatResponseDuration(setter.daily.averageResponseMinutes)}
WTD: new=${setter.wtd.newLeads}, booked=${setter.wtd.booked}, show=${formatPercent(setter.wtd.showRate)}, response=${formatResponseDuration(setter.wtd.averageResponseMinutes)}
MTD: new=${setter.mtd.newLeads}, engaged=${setter.mtd.engaged}, goal=${setter.mtd.goalClear}, gap=${setter.mtd.gapClear}, stakes=${setter.mtd.stakesClear}, qualified=${setter.mtd.qualified}, link=${setter.mtd.linkSent}, booked=${setter.mtd.booked}, show=${formatPercent(setter.mtd.showRate)}, response=${formatResponseDuration(setter.mtd.averageResponseMinutes)}
TOP DROPOFF: ${topDrop.label} at ${formatPercent(topDrop.rate)}
WORST RESPONSE GAPS:
${worstGaps}
LIVE TRANSCRIPTS:
${transcripts}
`;
  });

  const offerParts = offers.map(({ label, rows }) => {
    const daily = aggregateMetrics(rows, "daily");
    const wtd = aggregateMetrics(rows, "wtd");
    const mtd = aggregateMetrics(rows, "mtd");
    return `${label}
- DAILY: new=${daily.newLeads}, booked=${daily.booked}, show=${formatPercent(daily.showRate)}, response=${formatResponseDuration(daily.averageResponseMinutes)}
- WTD: new=${wtd.newLeads}, booked=${wtd.booked}, show=${formatPercent(wtd.showRate)}, response=${formatResponseDuration(wtd.averageResponseMinutes)}
- MTD: new=${mtd.newLeads}, booked=${mtd.booked}, show=${formatPercent(mtd.showRate)}, response=${formatResponseDuration(mtd.averageResponseMinutes)}`;
  });

  return `REPORT DATE: ${data.reportDate}
TEAM DAILY: new=${teamDaily.newLeads}, booked=${teamDaily.booked}, show=${formatPercent(teamDaily.showRate)}, response=${formatResponseDuration(teamDaily.averageResponseMinutes)}
TEAM WTD: new=${teamWtd.newLeads}, booked=${teamWtd.booked}, show=${formatPercent(teamWtd.showRate)}, response=${formatResponseDuration(teamWtd.averageResponseMinutes)}
TEAM MTD: new=${teamMtd.newLeads}, booked=${teamMtd.booked}, show=${formatPercent(teamMtd.showRate)}, response=${formatResponseDuration(teamMtd.averageResponseMinutes)}

OFFERS:
${offerParts.join("\n")}

SETTERS:
${setterParts.join("\n")}`;
}

function buildSetterSection(
  setter: SetterReportRow,
  actionItems: string[],
) {
  const lines = [
    `### ${setter.setterName} — ${setter.clientLabel}`,
    "",
    "**Daily**",
    formatMetricBlock(
      setter.daily,
      [
        { label: "Week to Date", averageResponseMinutes: setter.wtd.averageResponseMinutes, responseSampleCount: setter.wtd.responseSampleCount },
        { label: "Month to Date", averageResponseMinutes: setter.mtd.averageResponseMinutes, responseSampleCount: setter.mtd.responseSampleCount },
      ],
      "Daily",
    ),
    "",
    "**Week to Date**",
    formatMetricBlock(
      setter.wtd,
      [{ label: "Month to Date", averageResponseMinutes: setter.mtd.averageResponseMinutes, responseSampleCount: setter.mtd.responseSampleCount }],
      "Week to Date",
    ),
    "",
    "**Month to Date**",
    formatMetricBlock(setter.mtd, [], "Month to Date"),
    "",
    "**Action Items**",
    ...(actionItems.length > 0
      ? actionItems.map((item, index) => `${index + 1}. ${item}`)
      : ["1. No action items generated."]),
    "",
  ];

  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const isVercelCron = req.headers.get("x-vercel-cron") === "true";
  const forceRun = req.nextUrl.searchParams.get("force") === "1";
  const overrideDate = req.nextUrl.searchParams.get("date");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const now = new Date();
  const todayEt = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const etHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  if (isVercelCron && !forceRun && etHour !== 0) {
    return NextResponse.json({
      skipped: true,
      reason: "Not midnight in America/New_York",
      etHour,
      date: todayEt,
    });
  }

  const reportDate = overrideDate || addDays(todayEt, -1);
  const anthropic = new Anthropic({ apiKey });
  const data = await getSetterReportData(reportDate);

  const companyDaily = aggregateMetrics(data.setters, "daily");
  const companyWtd = aggregateMetrics(data.setters, "wtd");
  const companyMtd = aggregateMetrics(data.setters, "mtd");
  const offerGroups = buildOfferGroups(data.setters);

  let actions = fallbackActionPayload(data.setters);

  try {
    const actionContext = buildActionContext(data);
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3500,
      system: ACTION_ITEMS_PROMPT,
      messages: [{ role: "user", content: actionContext }],
    });

    const text = msg.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");

    actions = extractJson(text);
  } catch (error) {
    console.error("[cron/setter-report] action generation fallback:", error);
  }

  const actionMap = new Map(
    actions.setters.map((setter) => [setter.setterKey, setter.actionItems]),
  );

  const reportSections = [
    "# C.C. Setter Report",
    `**${formatLongDate(reportDate)}**`,
    "**Team Targets: 15% Booking Rate | 65% Show Rate**",
    "",
    "---",
    "",
    "## COMPANY SCOREBOARD",
    "",
    `### Daily (${formatLongDate(reportDate)})`,
    formatMetricBlock(
      companyDaily,
      [
        { label: "Week to Date", averageResponseMinutes: companyWtd.averageResponseMinutes, responseSampleCount: companyWtd.responseSampleCount },
        { label: "Month to Date", averageResponseMinutes: companyMtd.averageResponseMinutes, responseSampleCount: companyMtd.responseSampleCount },
      ],
      "Daily",
    ),
    "",
    `### Week to Date (${formatShortDate(data.weekStart)} to ${formatShortDate(reportDate)})`,
    formatMetricBlock(
      companyWtd,
      [{ label: "Month to Date", averageResponseMinutes: companyMtd.averageResponseMinutes, responseSampleCount: companyMtd.responseSampleCount }],
      "Week to Date",
    ),
    "",
    `### Month to Date (${formatShortDate(data.monthStart)} to ${formatShortDate(reportDate)})`,
    formatMetricBlock(companyMtd, [], "Month to Date"),
    "",
    "---",
    "",
    "## OFFER SCOREBOARD",
    "",
    ...offerGroups.flatMap(({ label, rows }) => {
      const daily = aggregateMetrics(rows, "daily");
      const wtd = aggregateMetrics(rows, "wtd");
      const mtd = aggregateMetrics(rows, "mtd");
      return [
        `### ${label}`,
        "",
        "**Daily**",
        formatMetricBlock(
          daily,
          [
            { label: "Week to Date", averageResponseMinutes: wtd.averageResponseMinutes, responseSampleCount: wtd.responseSampleCount },
            { label: "Month to Date", averageResponseMinutes: mtd.averageResponseMinutes, responseSampleCount: mtd.responseSampleCount },
          ],
          "Daily",
        ),
        "",
        "**Week to Date**",
        formatMetricBlock(
          wtd,
          [{ label: "Month to Date", averageResponseMinutes: mtd.averageResponseMinutes, responseSampleCount: mtd.responseSampleCount }],
          "Week to Date",
        ),
        "",
        "**Month to Date**",
        formatMetricBlock(mtd, [], "Month to Date"),
        "",
      ];
    }),
    "---",
    "",
    "## SETTER REVIEWS",
    "",
    ...data.setters.flatMap((setter) => [
      buildSetterSection(setter, actionMap.get(setter.setterKey) || []),
    ]),
    "---",
    "",
    "## CEO ACTION ITEMS",
    "",
    ...(actions.ceoActionItems.length > 0
      ? actions.ceoActionItems.map((item, index) => `${index + 1}. ${item}`)
      : ["1. No CEO action items generated."]),
  ];

  const report = reportSections.join("\n");
  const pdf = generatePDF(`C.C. Setter Report (${reportDate})`, report);

  const uploaded = await uploadFileAsCso(
    pdf,
    `setter-report-${reportDate}.pdf`,
    `C.C. Setter Report — ${reportDate}`,
    `📋 *C.C. Setter Report — ${reportDate}*\nCompany MTD: ${companyMtd.newLeads} leads | ${companyMtd.booked} booked | ${formatPercent(companyMtd.showRate)} show | ${formatResponseDuration(companyMtd.averageResponseMinutes)} avg response`,
  );

  return NextResponse.json({
    success: uploaded,
    date: reportDate,
    weekStart: data.weekStart,
    monthStart: data.monthStart,
  });
}
