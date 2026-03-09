import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchSheetData } from "@/lib/google-sheets";
import { getMetrics } from "@/lib/manychat";
import { countSubscriptionSales } from "@/lib/stripe-client";
import { postToSlack } from "@/lib/slack";

const WEEKLY_REPORT_SYSTEM_PROMPT = `You are a marketing strategist and sales operations analyst for Core Shift LLC, a fitness coaching agency. Generate a weekly performance report with actionable marketing recommendations.

Given the data from the past week, create a report covering:

## Weekly Performance Summary
[Key numbers: leads, calls booked, show rate, close rate, revenue, AOV]
[Compare to previous week if data available]

## DM Performance Insights
[Which setters performed best/worst and why]
[Engagement quality trends]
[Recommendations for DM script adjustments]

## Sales Call Insights
[Which closers performed best/worst]
[Common objections this week]
[Call quality trends]

## Show Rate Analysis
[This week's show rate]
[Which day/time had best show rates]

## AOV Analysis
[This week's AOV]
[Which payment methods are trending]

## Marketing Recommendations
[Top 3 actionable recommendations]

## Red Flags
[Anything concerning that needs immediate attention]

Be specific, data-driven, and actionable. No fluff.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { dateFrom: customDateFrom, dateTo: customDateTo, sendToSlack } = body as {
      dateFrom?: string;
      dateTo?: string;
      sendToSlack?: boolean;
    };

    // Default to last 7 days if no dates provided
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dateFrom = customDateFrom || sevenDaysAgo.toISOString().split("T")[0];
    const dateTo = customDateTo || now.toISOString().split("T")[0];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Collect data from all sources in parallel
    const [
      sheetData,
      tysonManychat,
      keithManychat,
      tysonStripe,
      keithStripe,
    ] = await Promise.all([
      fetchSheetData(dateFrom, dateTo).catch((err) => {
        console.error("Weekly report: sheet data error:", err);
        return [];
      }),
      getMetrics("tyson", dateFrom, dateTo).catch((err) => {
        console.error("Weekly report: tyson manychat error:", err);
        return null;
      }),
      getMetrics("keith", dateFrom, dateTo).catch((err) => {
        console.error("Weekly report: keith manychat error:", err);
        return null;
      }),
      countSubscriptionSales("tyson", dateFrom, dateTo).catch((err) => {
        console.error("Weekly report: tyson stripe error:", err);
        return 0;
      }),
      countSubscriptionSales("keith", dateFrom, dateTo).catch((err) => {
        console.error("Weekly report: keith stripe error:", err);
        return 0;
      }),
    ]);

    // Build data context for Claude
    const dataParts: string[] = [];

    dataParts.push(`Report Period: ${dateFrom} to ${dateTo}`);
    dataParts.push("");

    // Sheet data summary
    if (sheetData.length > 0) {
      const totalCalls = sheetData.length;
      const callsTaken = sheetData.filter((r) => r.callTaken).length;
      const wins = sheetData.filter((r) => r.outcome === "WIN").length;
      const noShows = sheetData.filter(
        (r) => r.outcome === "NS-RS" || r.outcome.includes("NS")
      ).length;
      const totalRevenue = sheetData.reduce((sum, r) => sum + r.revenue, 0);
      const totalCashCollected = sheetData.reduce((sum, r) => sum + r.cashCollected, 0);

      dataParts.push("=== SALES CALL DATA (Google Sheets) ===");
      dataParts.push(`Total scheduled calls: ${totalCalls}`);
      dataParts.push(`Calls taken: ${callsTaken}`);
      dataParts.push(`Wins: ${wins}`);
      dataParts.push(`No-shows/Rescheduled: ${noShows}`);
      dataParts.push(`Show rate: ${totalCalls > 0 ? ((callsTaken / totalCalls) * 100).toFixed(1) : "N/A"}%`);
      dataParts.push(`Close rate (of calls taken): ${callsTaken > 0 ? ((wins / callsTaken) * 100).toFixed(1) : "N/A"}%`);
      dataParts.push(`Total revenue: $${totalRevenue.toLocaleString()}`);
      dataParts.push(`Total cash collected: $${totalCashCollected.toLocaleString()}`);
      dataParts.push(`AOV: $${wins > 0 ? (totalRevenue / wins).toFixed(0) : "N/A"}`);

      // Closer breakdown
      const closerStats: Record<string, { calls: number; wins: number; revenue: number }> = {};
      for (const row of sheetData) {
        if (!row.closer) continue;
        if (!closerStats[row.closer]) closerStats[row.closer] = { calls: 0, wins: 0, revenue: 0 };
        if (row.callTaken) closerStats[row.closer].calls++;
        if (row.outcome === "WIN") {
          closerStats[row.closer].wins++;
          closerStats[row.closer].revenue += row.revenue;
        }
      }
      dataParts.push("\nCloser breakdown:");
      for (const [name, stats] of Object.entries(closerStats)) {
        dataParts.push(`  ${name}: ${stats.calls} calls, ${stats.wins} wins (${stats.calls > 0 ? ((stats.wins / stats.calls) * 100).toFixed(0) : 0}%), $${stats.revenue.toLocaleString()} revenue`);
      }

      // Setter breakdown
      const setterStats: Record<string, { calls: number; wins: number }> = {};
      for (const row of sheetData) {
        if (!row.setter) continue;
        if (!setterStats[row.setter]) setterStats[row.setter] = { calls: 0, wins: 0 };
        setterStats[row.setter].calls++;
        if (row.outcome === "WIN") setterStats[row.setter].wins++;
      }
      dataParts.push("\nSetter breakdown (calls set):");
      for (const [name, stats] of Object.entries(setterStats)) {
        dataParts.push(`  ${name}: ${stats.calls} calls set, ${stats.wins} resulting in wins`);
      }

      // Payment method breakdown
      const methodStats: Record<string, number> = {};
      for (const row of sheetData) {
        if (row.outcome === "WIN" && row.method) {
          methodStats[row.method] = (methodStats[row.method] || 0) + 1;
        }
      }
      if (Object.keys(methodStats).length > 0) {
        dataParts.push("\nPayment methods:");
        for (const [method, count] of Object.entries(methodStats)) {
          dataParts.push(`  ${method}: ${count} sales`);
        }
      }

      // Objection breakdown
      const objectionStats: Record<string, number> = {};
      for (const row of sheetData) {
        if (row.objection) {
          objectionStats[row.objection] = (objectionStats[row.objection] || 0) + 1;
        }
      }
      if (Object.keys(objectionStats).length > 0) {
        dataParts.push("\nObjections encountered:");
        for (const [objection, count] of Object.entries(objectionStats)) {
          dataParts.push(`  ${objection}: ${count}`);
        }
      }

      // Day of week analysis
      const dayStats: Record<string, { scheduled: number; taken: number }> = {};
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      for (const row of sheetData) {
        const dayOfWeek = dayNames[new Date(row.date).getDay()];
        if (!dayStats[dayOfWeek]) dayStats[dayOfWeek] = { scheduled: 0, taken: 0 };
        dayStats[dayOfWeek].scheduled++;
        if (row.callTaken) dayStats[dayOfWeek].taken++;
      }
      dataParts.push("\nShow rate by day:");
      for (const [day, stats] of Object.entries(dayStats)) {
        dataParts.push(`  ${day}: ${stats.taken}/${stats.scheduled} (${stats.scheduled > 0 ? ((stats.taken / stats.scheduled) * 100).toFixed(0) : 0}%)`);
      }

      // Raw row data for context
      dataParts.push("\nDetailed call data:");
      dataParts.push(JSON.stringify(sheetData, null, 2));
    } else {
      dataParts.push("=== SALES CALL DATA: No data available for this period ===");
    }

    dataParts.push("");

    // ManyChat data
    dataParts.push("=== MANYCHAT / DM METRICS ===");
    if (tysonManychat) {
      dataParts.push(`Tyson Sonnek: ${JSON.stringify(tysonManychat, null, 2)}`);
    } else {
      dataParts.push("Tyson Sonnek: No ManyChat data available");
    }
    if (keithManychat) {
      dataParts.push(`Keith Holland: ${JSON.stringify(keithManychat, null, 2)}`);
    } else {
      dataParts.push("Keith Holland: No ManyChat data available");
    }

    dataParts.push("");

    // Stripe data
    dataParts.push("=== STRIPE SUBSCRIPTION SALES ===");
    dataParts.push(`Tyson Sonnek subscriptions: ${tysonStripe}`);
    dataParts.push(`Keith Holland subscriptions: ${keithStripe}`);

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: WEEKLY_REPORT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate the weekly performance report based on this data:\n\n${dataParts.join("\n")}`,
        },
      ],
    });

    const report = message.content
      .filter((block) => block.type === "text")
      .map((block) => {
        if (block.type === "text") return block.text;
        return "";
      })
      .join("\n");

    // Optionally send to Slack
    let slackSent = false;
    const shouldSendSlack = sendToSlack !== false; // default to true
    const slackChannel = process.env.SLACK_CHANNEL_MARKETING;

    if (shouldSendSlack && slackChannel) {
      try {
        slackSent = await postToSlack(
          slackChannel,
          `*Weekly Performance Report (${dateFrom} to ${dateTo})*\n\n${report}`
        );
      } catch (slackErr) {
        console.error("Weekly report: Slack send error:", slackErr);
      }
    }

    return NextResponse.json({ report, slackSent });
  } catch (err) {
    console.error("Weekly report generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate weekly report" },
      { status: 500 }
    );
  }
}
