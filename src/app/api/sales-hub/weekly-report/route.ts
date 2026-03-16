import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchSheetData } from "@/lib/google-sheets";
import { getMetrics } from "@/lib/manychat";
import { countSubscriptionSales } from "@/lib/stripe-client";
import { postToSlack } from "@/lib/slack";
import { uploadFileToSlack } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";

/* ── Fathom transcript fetcher (server-side) ────────────────────── */

async function fetchFathomTranscripts(
  dateFrom: string,
  dateTo: string
): Promise<string[]> {
  const apiKey = process.env.FATHOM_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.fathom.ai/external/v1/meetings?created_after=${dateFrom}&created_before=${dateTo}T23:59:59Z`,
      { headers: { "X-Api-Key": apiKey } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const meetings = data.items || [];
    if (!Array.isArray(meetings)) return [];

    const transcripts: string[] = [];
    for (const m of meetings.slice(0, 20)) {
      try {
        const tRes = await fetch(
          `https://api.fathom.ai/external/v1/meetings/${m.id}/transcript`,
          { headers: { "X-Api-Key": apiKey } }
        );
        if (tRes.ok) {
          const tData = await tRes.json();
          const segments = tData.segments || tData || [];
          if (Array.isArray(segments) && segments.length > 0) {
            const text = segments
              .map((s: { speaker?: string; text?: string }) => `${s.speaker || "Speaker"}: ${s.text || ""}`)
              .join("\n");
            transcripts.push(`[Call: ${m.title || "Untitled"}]\n${text}`);
          }
        }
      } catch {
        // Skip individual transcript errors
      }
    }
    return transcripts;
  } catch {
    return [];
  }
}

/* ── Supabase DM transcript fetcher (server-side) ───────────────── */

async function fetchDMTranscripts(
  dateFrom: string,
  dateTo: string
): Promise<string[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const url = `${supabaseUrl}/rest/v1/dm_transcripts?submitted_at=gte.${dateFrom}&submitted_at=lte.${dateTo}T23:59:59&select=setter_name,client,transcript,submitted_at`;
    const res = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(
      (t: { setter_name: string; client: string; transcript: string; submitted_at: string }) =>
        `[DM — Setter: ${t.setter_name}, Client: ${t.client}, Date: ${t.submitted_at}]\n${t.transcript}`
    );
  } catch {
    return [];
  }
}

/* ── System prompt ──────────────────────────────────────────────── */

const WEEKLY_REPORT_SYSTEM_PROMPT = `You are a senior marketing strategist and sales operations analyst for Core Shift LLC, a fitness coaching agency with two clients: Keith Holland and Tyson Sonnek.

Your job: generate an in-depth weekly performance report with transcript-based insights and ad copy.

IMPORTANT OPTIMIZATION GUARDRAILS:
- Optimize for ROAS (return on ad spend) as the primary metric
- Show rates must stay ABOVE 60%
- Close rates must stay ABOVE 50%
- AOV must stay ABOVE $2,000
- Do NOT recommend strategies that would tank show rate or close rate just to net more money

Given the data, create a report covering:

## Weekly Performance Summary
Key numbers: leads, calls booked, show rate, close rate, cash collected, AOV.
Compare to benchmarks (60% show, 50% close, $2k AOV).

## DM Performance Insights
Which setters performed best/worst. Engagement quality trends.
If DM transcripts are provided, analyze messaging patterns — what language/angles got leads to book.

## Sales Call Insights
Which closers performed best/worst. Common objections.
If call transcripts are provided, analyze what closing techniques worked, what didn't.

## Transcript Analysis
If transcripts (DM or call) are provided, analyze:
- Common pain points prospects mention
- Language patterns that resonate
- Objection themes and how they were handled
- Buying signals and emotional triggers
- What messaging moves prospects toward booking/closing

## Advertising Trend Insights
Based on transcript data and performance metrics:
- What types of prospects are converting best
- What messaging angles resonate most
- What pain points to amplify in ads
- Demographic/psychographic patterns
- Content themes that should be tested

## Ad Copy — Keith Holland (30 pieces)
Write exactly 30 pieces of ad copy for Keith Holland's fitness coaching offer.
For EACH piece: the ad copy text, then a 1-2 sentence explanation of why it should work based on the data.
Vary the styles: hooks, long-form, short-form, testimonial-style, problem-agitate-solve, etc.
Base the copy on actual patterns found in the transcripts and data.

## Ad Copy — Tyson Sonnek (30 pieces)
Write exactly 30 pieces of ad copy for Tyson Sonnek's fitness coaching offer.
Same format: ad copy + 1-2 sentence rationale for each.
Vary the styles and base on actual data patterns.

## Red Flags
Anything concerning that needs immediate attention.

## CMO Strategic Analysis

You are now speaking as the CMO of Core Shift LLC. Based on everything you've seen in the data, transcripts, and performance metrics, provide your strategic input. Your analysis should be framed around solving ONE constraint at a time with two optimization goals:

1. **Maximize ROAS** — get the highest possible return on every dollar spent on ads
2. **Maximize Ad Spend** — once ROAS is strong, scale spend as aggressively as possible

Think through:
- What is the current bottleneck limiting ROAS? (creative fatigue, audience saturation, funnel leaks, offer mismatch, etc.)
- What would you do THIS week to improve ROAS based on the data?
- Where would you allocate additional budget and why?
- What creative angles are working and which should be killed?
- What's the single most impactful lever to pull right now?
- What tests would you run in the next 7 days?

Be direct and opinionated. Give your actual recommendation, not a list of options. Think like a CMO who owns the P&L and has skin in the game.

Be specific, data-driven, and actionable. No fluff. Reference actual data points.`;

/* ── Main handler ───────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { dateFrom: customDateFrom, dateTo: customDateTo, sendToSlack } = body as {
      dateFrom?: string;
      dateTo?: string;
      sendToSlack?: boolean;
    };

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dateFrom = customDateFrom || sevenDaysAgo.toISOString().split("T")[0];
    const dateTo = customDateTo || now.toISOString().split("T")[0];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Collect ALL data sources in parallel
    const [
      sheetData,
      tysonManychat,
      keithManychat,
      tysonStripe,
      keithStripe,
      fathomTranscripts,
      dmTranscripts,
    ] = await Promise.all([
      fetchSheetData(dateFrom, dateTo).catch(() => []),
      getMetrics("tyson", dateFrom, dateTo).catch(() => null),
      getMetrics("keith", dateFrom, dateTo).catch(() => null),
      countSubscriptionSales("tyson", dateFrom, dateTo).catch(() => 0),
      countSubscriptionSales("keith", dateFrom, dateTo).catch(() => 0),
      fetchFathomTranscripts(dateFrom, dateTo),
      fetchDMTranscripts(dateFrom, dateTo),
    ]);

    // Build data context
    const dataParts: string[] = [];
    dataParts.push(`Report Period: ${dateFrom} to ${dateTo}`);
    dataParts.push("");

    // Sheet data summary
    if (sheetData.length > 0) {
      const totalCalls = sheetData.length;
      const callsTaken = sheetData.filter((r) => r.callTaken).length;
      const wins = sheetData.filter((r) => r.outcome === "WIN").length;
      const losses = sheetData.filter((r) => r.outcome === "LOST").length;
      const pcfus = sheetData.filter((r) => r.outcome === "PCFU").length;
      const noShows = sheetData.filter((r) => r.outcome === "NS-RS" || r.outcome.includes("NS")).length;
      const totalCashCollected = sheetData.reduce((sum, r) => sum + r.cashCollected, 0);
      const totalRevenue = sheetData.reduce((sum, r) => sum + r.revenue, 0);

      dataParts.push("=== SALES CALL DATA ===");
      dataParts.push(`Total scheduled calls: ${totalCalls}`);
      dataParts.push(`Calls taken: ${callsTaken}`);
      dataParts.push(`Wins: ${wins} | Losses: ${losses} | PCFUs: ${pcfus} | No-shows: ${noShows}`);
      dataParts.push(`Show rate: ${totalCalls > 0 ? ((callsTaken / totalCalls) * 100).toFixed(1) : "N/A"}%`);
      const denom = wins + losses + pcfus;
      dataParts.push(`Close rate: ${denom > 0 ? ((wins / denom) * 100).toFixed(1) : "N/A"}%`);
      dataParts.push(`Cash collected: $${totalCashCollected.toLocaleString()}`);
      dataParts.push(`AOV: $${wins > 0 ? (totalRevenue / wins).toFixed(0) : "N/A"}`);

      // Closer breakdown
      const closerStats: Record<string, { calls: number; wins: number; cash: number }> = {};
      for (const row of sheetData) {
        if (!row.closer) continue;
        if (!closerStats[row.closer]) closerStats[row.closer] = { calls: 0, wins: 0, cash: 0 };
        if (row.callTaken) closerStats[row.closer].calls++;
        if (row.outcome === "WIN") {
          closerStats[row.closer].wins++;
          closerStats[row.closer].cash += row.cashCollected;
        }
      }
      dataParts.push("\nCloser breakdown:");
      for (const [name, stats] of Object.entries(closerStats)) {
        dataParts.push(`  ${name}: ${stats.calls} taken, ${stats.wins} wins, $${stats.cash.toLocaleString()} cash`);
      }

      // Setter breakdown
      const setterStats: Record<string, { calls: number; wins: number }> = {};
      for (const row of sheetData) {
        if (!row.setter) continue;
        if (!setterStats[row.setter]) setterStats[row.setter] = { calls: 0, wins: 0 };
        setterStats[row.setter].calls++;
        if (row.outcome === "WIN") setterStats[row.setter].wins++;
      }
      dataParts.push("\nSetter breakdown:");
      for (const [name, stats] of Object.entries(setterStats)) {
        dataParts.push(`  ${name}: ${stats.calls} calls set, ${stats.wins} wins`);
      }

      // Objections
      const objectionStats: Record<string, number> = {};
      for (const row of sheetData) {
        if (row.objection) objectionStats[row.objection] = (objectionStats[row.objection] || 0) + 1;
      }
      if (Object.keys(objectionStats).length > 0) {
        dataParts.push("\nObjections:");
        for (const [obj, count] of Object.entries(objectionStats).sort((a, b) => b[1] - a[1])) {
          dataParts.push(`  ${obj}: ${count}`);
        }
      }

      // Payment methods
      const methodStats: Record<string, number> = {};
      for (const row of sheetData) {
        if (row.outcome === "WIN" && row.method) methodStats[row.method] = (methodStats[row.method] || 0) + 1;
      }
      if (Object.keys(methodStats).length > 0) {
        dataParts.push("\nPayment methods:");
        for (const [method, count] of Object.entries(methodStats)) {
          dataParts.push(`  ${method}: ${count}`);
        }
      }

      // Day of week
      const dayStats: Record<string, { scheduled: number; taken: number }> = {};
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      for (const row of sheetData) {
        const d = dayNames[new Date(row.date).getDay()];
        if (!dayStats[d]) dayStats[d] = { scheduled: 0, taken: 0 };
        dayStats[d].scheduled++;
        if (row.callTaken) dayStats[d].taken++;
      }
      dataParts.push("\nShow rate by day:");
      for (const [day, stats] of Object.entries(dayStats)) {
        dataParts.push(`  ${day}: ${stats.taken}/${stats.scheduled} (${stats.scheduled > 0 ? ((stats.taken / stats.scheduled) * 100).toFixed(0) : 0}%)`);
      }
    } else {
      dataParts.push("=== SALES CALL DATA: No data for this period ===");
    }

    dataParts.push("");

    // ManyChat
    dataParts.push("=== MANYCHAT / DM METRICS ===");
    dataParts.push(tysonManychat ? `Tyson: ${JSON.stringify(tysonManychat, null, 2)}` : "Tyson: No data");
    dataParts.push(keithManychat ? `Keith: ${JSON.stringify(keithManychat, null, 2)}` : "Keith: No data");
    dataParts.push("");

    // Stripe
    dataParts.push("=== STRIPE SUBSCRIPTIONS ===");
    dataParts.push(`Tyson: ${tysonStripe} | Keith: ${keithStripe}`);
    dataParts.push("");

    // Fathom call transcripts
    if (fathomTranscripts.length > 0) {
      dataParts.push("=== CALL TRANSCRIPTS (Fathom) ===");
      // Limit total transcript size to ~30k chars to stay within token limits
      let charBudget = 30000;
      for (const t of fathomTranscripts) {
        if (charBudget <= 0) break;
        const truncated = t.length > charBudget ? t.substring(0, charBudget) + "...[truncated]" : t;
        dataParts.push(truncated);
        dataParts.push("---");
        charBudget -= t.length;
      }
    } else {
      dataParts.push("=== CALL TRANSCRIPTS: None available ===");
    }
    dataParts.push("");

    // DM transcripts
    if (dmTranscripts.length > 0) {
      dataParts.push("=== DM TRANSCRIPTS (Supabase) ===");
      let charBudget = 20000;
      for (const t of dmTranscripts) {
        if (charBudget <= 0) break;
        const truncated = t.length > charBudget ? t.substring(0, charBudget) + "...[truncated]" : t;
        dataParts.push(truncated);
        dataParts.push("---");
        charBudget -= t.length;
      }
    } else {
      dataParts.push("=== DM TRANSCRIPTS: None available ===");
    }

    // Generate report with Claude
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: WEEKLY_REPORT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate the weekly performance report with all sections including 30 ad copies per client based on this data:\n\n${dataParts.join("\n")}`,
        },
      ],
    });

    const report = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");

    // Generate PDF
    let pdfBase64: string | null = null;
    try {
      const pdfBuffer = generatePDF(`Weekly Marketing Report (${dateFrom} to ${dateTo})`, report);
      pdfBase64 = pdfBuffer.toString("base64");
    } catch (pdfErr) {
      console.error("Weekly report: PDF generation error:", pdfErr);
    }

    // Send to Slack
    let slackSent = false;
    const shouldSendSlack = sendToSlack !== false;
    const slackChannel = process.env.SLACK_USER_DM || process.env.SLACK_CHANNEL_MARKETING;

    if (shouldSendSlack && slackChannel) {
      try {
        // Try uploading PDF first
        if (pdfBase64) {
          const pdfBuffer = Buffer.from(pdfBase64, "base64");
          slackSent = await uploadFileToSlack(
            slackChannel,
            pdfBuffer,
            `weekly-report-${dateFrom}-to-${dateTo}.pdf`,
            `Weekly Marketing Report (${dateFrom} to ${dateTo})`,
            `Weekly Marketing Report for ${dateFrom} to ${dateTo}`
          );
        }

        // Also send text summary
        if (!slackSent) {
          const truncated = report.length > 3500
            ? report.substring(0, 3500) + "\n\n_...truncated. Full report available as PDF download._"
            : report;
          slackSent = await postToSlack(
            slackChannel,
            `*Weekly Marketing Report (${dateFrom} to ${dateTo})*\n\n${truncated}`
          );
        }
      } catch (slackErr) {
        console.error("Weekly report: Slack send error:", slackErr);
      }
    }

    return NextResponse.json({ report, slackSent, pdfBase64 });
  } catch (err) {
    console.error("Weekly report generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate weekly report" },
      { status: 500 }
    );
  }
}
