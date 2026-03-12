import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchSheetData } from "@/lib/google-sheets";
import { postToSlack } from "@/lib/slack";
import { uploadFileToSlack } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { listMeetings, FathomMeeting } from "@/lib/fathom";

/* ── Team filter (same as fathom-calls route) ────────────────────── */

const TEAM_EMAILS = new Set([
  "matthew@clientconversion.io", "alex@clientconversion.io", "alexwalsh520@gmail.com",
  "brozee2019@gmail.com", "will@start2finishcoaching.com", "williamluke.buckley21@gmail.com",
  "austinrichard6@gmail.com", "austinr@gfpenterprises.com", "tysonnek29@gmail.com",
  "saeed16765@gmail.com", "keithholland35@gmail.com", "averyjfisk@gmail.com", "isaac@sendblue.com",
  "gideonadebowale11@gmail.com", "amaraedwin9@gmail.com", "umunnakelechi89@gmail.com", "nwosudebbie@gmail.com",
]);
const INTERNAL_TITLES = ["sales team huddle", "c suite", "management", "setter connect", "training", "interview", "1:1", "huddle"];

function isSalesCall(m: FathomMeeting): boolean {
  const titleLower = (m.title || "").toLowerCase();
  if (INTERNAL_TITLES.some((p) => titleLower.includes(p))) return false;
  const invitees = m.calendar_invitees || [];
  return invitees.some((a) => a.email && !TEAM_EMAILS.has(a.email.toLowerCase()));
}

/* ── Supabase DM transcript fetcher ──────────────────────────────── */

async function fetchDMTranscripts(dateFrom: string, dateTo: string): Promise<string[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const url = `${supabaseUrl}/rest/v1/dm_transcripts?submitted_at=gte.${dateFrom}&submitted_at=lte.${dateTo}T23:59:59&select=setter_name,client,transcript,submitted_at`;
    const res = await fetch(url, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
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

const WEEKLY_SALES_REPORT_PROMPT = `You are a Chief Sales Officer / Sales Director for Core Shift LLC, a fitness coaching agency. You see EVERYTHING — from DM engagement to call outcomes to cash collected. Your job is NOT to review individual calls but to evaluate the entire sales SYSTEM and identify where the business is leaking money and what to fix.

You think in terms of:
- Conversion funnel stages and drop-off rates
- System bottlenecks vs individual performance issues
- Revenue multipliers — what ONE change gives the biggest lift
- Process improvements, not just "try harder" advice

Given the data, produce a report covering:

## Sales System Overview
One paragraph: the state of the sales machine this week. What's working, what's broken, where's the biggest leak. Be direct.

## Funnel Analysis
Break down each stage: Leads → DM Engagement → Calls Booked → Shows → Closes → Cash Collected.
For each stage, give the conversion rate and flag where the biggest drop-off is.

## Where We're Leaking Money
Rank the top 3 revenue leaks by estimated dollar impact. For each:
- What's happening (with data)
- Why it's happening (root cause)
- How to fix it (specific, actionable)

## Closer Performance Comparison
Quick comparison of closers. Who's pulling weight, who needs support. Use actual numbers. One paragraph per closer max.

## Show Rate & No-Show Analysis
What's driving no-shows? Day-of-week patterns? Setter quality? Follow-up gaps? Give specific fixes.

## AOV & Revenue Optimization
Where can we increase average order value? Are closers leaving money on the table? Payment plan vs PIF split. Upsell opportunities.

## What I Would Change This Week
If you were running this sales org, what are the top 3 things you'd change IMMEDIATELY? Be specific — name the person, the process, or the system. These should be the highest-leverage changes.

## 30-Day Roadmap
3-5 strategic initiatives for the next 30 days to hit the next revenue multiplier. Each should include: what to do, who owns it, expected impact.

RULES:
- Think like a sales DIRECTOR, not a call coach — system-level thinking
- Every recommendation must tie back to revenue impact
- Be blunt and specific. Name names when relevant.
- No fluff, no motivational language — just data and decisions
- Reference actual numbers from the data provided`;

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

    // Collect data in parallel
    const [sheetData, fathomMeetings, dmTranscripts] = await Promise.all([
      fetchSheetData(dateFrom, dateTo).catch(() => []),
      listMeetings({
        createdAfter: dateFrom,
        createdBefore: `${dateTo}T23:59:59Z`,
        includeTranscript: true,
      }).catch(() => [] as FathomMeeting[]),
      fetchDMTranscripts(dateFrom, dateTo),
    ]);

    // Filter to sales calls only
    const salesCalls = fathomMeetings.filter(isSalesCall);

    // Build data context
    const dataParts: string[] = [];
    dataParts.push(`Report Period: ${dateFrom} to ${dateTo}`);
    dataParts.push("");

    // Sheet data summary
    if (sheetData.length > 0) {
      const totalCalls = sheetData.length;
      const callsTaken = sheetData.filter((r) => r.callTaken).length;
      const noShows = sheetData.filter((r) => !r.callTaken).length;
      const wins = sheetData.filter((r) => r.outcome === "WIN").length;
      const losses = sheetData.filter((r) => r.outcome === "LOST").length;
      const pcfus = sheetData.filter((r) => r.outcome === "PCFU").length;
      const totalCash = sheetData.reduce((sum, r) => sum + r.cashCollected, 0);
      const totalRevenue = sheetData.reduce((sum, r) => sum + r.revenue, 0);

      dataParts.push("=== SALES CALL DATA ===");
      dataParts.push(`Total scheduled: ${totalCalls}`);
      dataParts.push(`Calls taken: ${callsTaken} | No-shows: ${noShows}`);
      dataParts.push(`Show rate: ${totalCalls > 0 ? ((callsTaken / totalCalls) * 100).toFixed(1) : "N/A"}%`);
      dataParts.push(`Wins: ${wins} | Losses: ${losses} | PCFUs: ${pcfus}`);
      const denom = wins + losses + pcfus;
      dataParts.push(`Close rate: ${denom > 0 ? ((wins / denom) * 100).toFixed(1) : "N/A"}%`);
      dataParts.push(`Cash collected: $${totalCash.toLocaleString()}`);
      dataParts.push(`Revenue: $${totalRevenue.toLocaleString()}`);
      dataParts.push(`AOV: $${wins > 0 ? (totalRevenue / wins).toFixed(0) : "N/A"}`);

      // Closer breakdown
      const closerStats: Record<string, { scheduled: number; taken: number; wins: number; losses: number; pcfus: number; cash: number; revenue: number }> = {};
      for (const row of sheetData) {
        if (!row.closer) continue;
        if (!closerStats[row.closer]) closerStats[row.closer] = { scheduled: 0, taken: 0, wins: 0, losses: 0, pcfus: 0, cash: 0, revenue: 0 };
        closerStats[row.closer].scheduled++;
        if (row.callTaken) closerStats[row.closer].taken++;
        if (row.outcome === "WIN") { closerStats[row.closer].wins++; closerStats[row.closer].cash += row.cashCollected; closerStats[row.closer].revenue += row.revenue; }
        if (row.outcome === "LOST") closerStats[row.closer].losses++;
        if (row.outcome === "PCFU") closerStats[row.closer].pcfus++;
      }
      dataParts.push("\nCloser breakdown:");
      for (const [name, s] of Object.entries(closerStats)) {
        const cr = (s.wins + s.losses + s.pcfus) > 0 ? ((s.wins / (s.wins + s.losses + s.pcfus)) * 100).toFixed(0) : "N/A";
        const sr = s.scheduled > 0 ? ((s.taken / s.scheduled) * 100).toFixed(0) : "N/A";
        dataParts.push(`  ${name}: ${s.scheduled} sched, ${s.taken} taken (${sr}% show), ${s.wins}W/${s.losses}L/${s.pcfus}P (${cr}% close), $${s.cash.toLocaleString()} cash, AOV $${s.wins > 0 ? (s.revenue / s.wins).toFixed(0) : "N/A"}`);
      }

      // Setter breakdown
      const setterStats: Record<string, { calls: number; wins: number; noShows: number }> = {};
      for (const row of sheetData) {
        if (!row.setter) continue;
        if (!setterStats[row.setter]) setterStats[row.setter] = { calls: 0, wins: 0, noShows: 0 };
        setterStats[row.setter].calls++;
        if (row.outcome === "WIN") setterStats[row.setter].wins++;
        if (!row.callTaken) setterStats[row.setter].noShows++;
      }
      dataParts.push("\nSetter breakdown:");
      for (const [name, s] of Object.entries(setterStats)) {
        dataParts.push(`  ${name}: ${s.calls} calls set, ${s.wins} wins, ${s.noShows} no-shows`);
      }

      // Objections
      const objStats: Record<string, number> = {};
      for (const row of sheetData) { if (row.objection) objStats[row.objection] = (objStats[row.objection] || 0) + 1; }
      if (Object.keys(objStats).length > 0) {
        dataParts.push("\nObjections:");
        for (const [obj, count] of Object.entries(objStats).sort((a, b) => b[1] - a[1])) dataParts.push(`  ${obj}: ${count}`);
      }

      // Payment methods
      const methodStats: Record<string, number> = {};
      for (const row of sheetData) { if (row.outcome === "WIN" && row.method) methodStats[row.method] = (methodStats[row.method] || 0) + 1; }
      if (Object.keys(methodStats).length > 0) {
        dataParts.push("\nPayment methods:");
        for (const [method, count] of Object.entries(methodStats)) dataParts.push(`  ${method}: ${count}`);
      }

      // Day of week show rates
      const dayStats: Record<string, { scheduled: number; taken: number }> = {};
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      for (const row of sheetData) {
        const d = dayNames[new Date(row.date).getDay()];
        if (!dayStats[d]) dayStats[d] = { scheduled: 0, taken: 0 };
        dayStats[d].scheduled++;
        if (row.callTaken) dayStats[d].taken++;
      }
      dataParts.push("\nShow rate by day:");
      for (const [day, s] of Object.entries(dayStats)) {
        dataParts.push(`  ${day}: ${s.taken}/${s.scheduled} (${s.scheduled > 0 ? ((s.taken / s.scheduled) * 100).toFixed(0) : 0}%)`);
      }
    } else {
      dataParts.push("=== SALES CALL DATA: No data for this period ===");
    }

    // Call transcripts
    if (salesCalls.length > 0) {
      dataParts.push("\n=== SALES CALL TRANSCRIPTS ===");
      let charBudget = 25000;
      for (const call of salesCalls) {
        if (charBudget <= 0) break;
        dataParts.push(`\n--- ${call.title} (${call.created_at?.split("T")[0]}) ---`);
        if (call.transcript && Array.isArray(call.transcript) && call.transcript.length > 0) {
          const text = call.transcript.map((seg) => `${seg.speaker || "Speaker"}: ${seg.text || ""}`).join("\n");
          const t = text.length > charBudget ? text.substring(0, charBudget) + "...[truncated]" : text;
          dataParts.push(t);
          charBudget -= text.length;
        }
      }
    }

    // DM transcripts
    if (dmTranscripts.length > 0) {
      dataParts.push("\n=== DM TRANSCRIPTS ===");
      let charBudget = 15000;
      for (const t of dmTranscripts) {
        if (charBudget <= 0) break;
        const truncated = t.length > charBudget ? t.substring(0, charBudget) + "...[truncated]" : t;
        dataParts.push(truncated);
        dataParts.push("---");
        charBudget -= t.length;
      }
    }

    // Generate report with Claude
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: WEEKLY_SALES_REPORT_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate the weekly sales system report based on this data:\n\n${dataParts.join("\n")}`,
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
      const pdfBuffer = generatePDF(`Weekly Sales Report (${dateFrom} to ${dateTo})`, report);
      pdfBase64 = pdfBuffer.toString("base64");
    } catch (pdfErr) {
      console.error("Weekly sales report: PDF error:", pdfErr);
    }

    // Send to Slack
    let slackSent = false;
    const shouldSendSlack = sendToSlack !== false;
    const slackChannel = process.env.SLACK_USER_DM || process.env.SLACK_CHANNEL_MARKETING;

    if (shouldSendSlack && slackChannel) {
      try {
        if (pdfBase64) {
          const pdfBuffer = Buffer.from(pdfBase64, "base64");
          slackSent = await uploadFileToSlack(
            slackChannel,
            pdfBuffer,
            `weekly-sales-report-${dateFrom}-to-${dateTo}.pdf`,
            `Weekly Sales Report (${dateFrom} to ${dateTo})`,
            `Weekly Sales Report — system review for ${dateFrom} to ${dateTo}`
          );
        }
        if (!slackSent) {
          const truncated = report.length > 3500 ? report.substring(0, 3500) + "\n\n_...truncated_" : report;
          slackSent = await postToSlack(slackChannel, `*Weekly Sales Report (${dateFrom} to ${dateTo})*\n\n${truncated}`);
        }
      } catch (slackErr) {
        console.error("Weekly sales report: Slack error:", slackErr);
      }
    }

    return NextResponse.json({ report, slackSent, pdfBase64 });
  } catch (err) {
    console.error("Weekly sales report error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate weekly sales report" },
      { status: 500 }
    );
  }
}
