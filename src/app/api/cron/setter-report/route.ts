import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { uploadFileAsCso } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { getSetterReportData } from "@/lib/setter-report-data";

/* ── System Prompt ──────────────────────────────────────────────── */

const SETTER_REPORT_PROMPT = `You are the Setter Manager writing a daily setter performance report to the CEO. You are explicitly direct about where money is being lost. No sugarcoating. No motivation. Pure accountability.

Your job is to review each setter's live DM conversations, response times, booking rates, show rates, close rates, and AOV — then tell the CEO exactly what each setter needs to fix and what to follow up with them about.

Format EXACTLY as follows:

# DAILY SETTER REPORT
**[Day of week], [Full Date]**
**Team Targets: 15% Booking Rate | 65% Show Rate**

---

## TEAM SNAPSHOT

[Quick metrics table for all setters: name, client, MTD new leads, MTD booked, show rate, booking rate, average response time in minutes]

---

## SETTER REVIEWS

For each setter:

### [Setter Name] — [Client Name]

**Numbers (MTD):**
- Leads → Booked: X/X ([X]% booking rate) — Target: 15%
- Show Rate: [X]% — Target: 65%
- Close Rate: [X]%
- AOV: $X
- No-Shows: X
- Wins from their leads: X ($X cash collected)

**Response Time Analysis (Noon–Midnight EST):**
[Use the average response time in minutes that is provided. Then use the transcript timestamps to point out specific slow gaps. Be specific.]

**DM Quality Review:**
[Review the actual live conversations. Are they getting the lead from goal → gap → stakes → qualified? Are they building urgency? Are they sending the booking link at the right time? Are they following up on dead conversations? Cite specific examples from the transcripts — quote what they said and what they should have said instead.]

**Where Money Is Being Lost:**
[Specific dollar amount being leaked. Example: "3 no-shows this week at $1,538 AOV = $4,614 in lost potential revenue. 2 of those prospects were never sent a confirmation text."]

**Directives:**
[3-5 specific, numbered action items. Not suggestions — directives. "Do this today." Each one addresses a specific problem found in the transcripts or numbers.]

---

## CEO FOLLOW-UP ITEMS

[5-7 numbered items for the CEO to address with the setter team. Each is specific and actionable. Include which setter, what to say to them, and why.]

---

Rules:
- Be brutally honest. You are protecting revenue, not feelings.
- Every claim must be backed by a number or a transcript quote.
- Response time between noon and midnight EST is what matters — that's when prospects are active.
- Use the live conversation transcripts provided, not old uploaded transcripts.
- If a setter has weak transcript coverage, call it out as a data problem.
- Booking rate target is 15%. Show rate target is 65%. Anything below is costing money.
- Calculate the dollar impact of every gap: missed leads × AOV = money lost.
- If a setter is doing well, say so briefly and move on. Spend time on problems, not praise.`;

/* ── Main Handler ───────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

  const anthropic = new Anthropic({ apiKey });

  // Dates
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStr = etNow.toISOString().split("T")[0];
  const monthStart = todayStr.substring(0, 8) + "01";

  const data = await getSetterReportData(todayStr);
  const setterContextParts: string[] = [];
  const totalBooked = data.setters.reduce((sum, setter) => sum + setter.mtd.booked, 0);
  const totalTaken = data.setters.reduce((sum, setter) => sum + setter.mtd.taken, 0);
  const totalWins = data.setters.reduce((sum, setter) => sum + setter.mtd.wins, 0);
  const totalCash = data.setters.reduce((sum, setter) => sum + setter.mtd.cashCollected, 0);
  const teamShowRate = totalBooked > 0 ? (totalTaken / totalBooked) * 100 : 0;
  const aov = totalWins > 0 ? totalCash / totalWins : 0;

  for (const setter of data.setters) {
    const responseMinutes =
      setter.responseTime.averageMinutes === null
        ? "No live response samples yet"
        : `${setter.responseTime.averageMinutes.toFixed(1)} min average from ${setter.responseTime.sampleCount} samples`;

    const worstGaps =
      setter.responseTime.worstGaps.length === 0
        ? "No large gaps captured yet."
        : setter.responseTime.worstGaps
            .map(
              (gap) =>
                `- ${gap.minutes.toFixed(1)} min gap | Prospect: ${gap.prospectAt} | Setter: ${gap.setterAt} | Conversation: ${gap.conversationId}`,
            )
            .join("\n");

    const transcripts =
      setter.transcripts.length === 0
        ? "NO LIVE GHL CONVERSATIONS CAPTURED IN THE LAST 3 DAYS."
        : setter.transcripts
            .map(
              (transcript) =>
                `[Conversation ${transcript.conversationId} | Latest ${transcript.latestMessageAt} | ${transcript.messageCount} messages]\n${transcript.transcript.substring(0, 3500)}`,
            )
            .join("\n\n--- NEXT CONVERSATION ---\n\n");

    setterContextParts.push(`
=== ${setter.setterName.toUpperCase()} (${setter.clientLabel}) ===

DAILY FUNNEL:
- New leads today: ${setter.daily.newLeads}
- Engaged today: ${setter.daily.engaged}
- Goal clear today: ${setter.daily.goalClear}
- Gap clear today: ${setter.daily.gapClear}
- Stakes clear today: ${setter.daily.stakesClear}
- Qualified today: ${setter.daily.qualified}
- Call link sent today: ${setter.daily.linkSent}
- Subscription link sent today: ${setter.daily.subLinkSent}

MTD NUMBERS:
- New leads: ${setter.mtd.newLeads}
- Engaged: ${setter.mtd.engaged}
- Goal clear: ${setter.mtd.goalClear}
- Gap clear: ${setter.mtd.gapClear}
- Stakes clear: ${setter.mtd.stakesClear}
- Qualified: ${setter.mtd.qualified}
- Call links sent: ${setter.mtd.linkSent}
- Subscription links sent: ${setter.mtd.subLinkSent}
- Booked: ${setter.mtd.booked}
- Calls Taken (showed): ${setter.mtd.taken}
- Show Rate: ${setter.mtd.showRate.toFixed(1)}% (target: 65%)
- Booking Rate: ${setter.mtd.bookingRate.toFixed(1)}% (target: 15%)
- Close Rate: ${setter.mtd.closeRate.toFixed(1)}%
- Wins: ${setter.mtd.wins}
- No-Shows: ${setter.mtd.noShows}
- Cash Collected: $${setter.mtd.cashCollected.toLocaleString()}
- Revenue: $${setter.mtd.revenue.toLocaleString()}
- AOV: $${setter.mtd.aov.toFixed(0)}

RESPONSE TIME (Noon–Midnight EST):
${responseMinutes}

WORST RESPONSE GAPS:
${worstGaps}

LIVE GHL DM TRANSCRIPTS (last 3 days):
${transcripts}
`);
  }

  const fullContext = `Date: ${todayStr}
MTD Period: ${monthStart} to ${todayStr}

TEAM-WIDE METRICS:
- Total Booked: ${totalBooked}
- Total Taken: ${totalTaken}
- Total Wins: ${totalWins}
- Cash Collected: $${totalCash.toLocaleString()}
- Team Show Rate: ${teamShowRate.toFixed(1)}%
- AOV: $${aov.toFixed(0)}
- Live transcript source: ${data.transcriptSource}
- Legacy upload count in last 3 days: ${data.dataQuality.recentLegacyUploads}
- Live messages in last 3 days: ${data.dataQuality.recentLiveMessages}
- Live stage states available: ${data.dataQuality.recentStageStates}
- Live messages missing setter name: ${data.dataQuality.missingSetterMessages}

${setterContextParts.join("\n")}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: SETTER_REPORT_PROMPT,
      messages: [{ role: "user", content: `Generate the Daily Setter Report:\n\n${fullContext}` }],
    });

    const report = msg.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n");
    const pdf = generatePDF(`Daily Setter Report (${todayStr})`, report);

    await uploadFileAsCso(
      pdf,
      `setter-report-${todayStr}.pdf`,
      `Daily Setter Report — ${todayStr}`,
      `📋 *DAILY SETTER REPORT — ${todayStr}*\nTeam SR: ${teamShowRate.toFixed(1)}% (target: 65%) | ${totalBooked} booked | ${totalWins} wins | $${totalCash.toLocaleString()}`
    );

    return NextResponse.json({ success: true, date: todayStr });
  } catch (err) {
    console.error("[cron/setter-report] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
