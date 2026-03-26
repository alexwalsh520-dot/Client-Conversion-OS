import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { uploadFileAsCso } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { fetchSheetData as fetchSheetRows, type SheetRow } from "@/lib/google-sheets";
import { fetchSubscriptionsSold } from "@/lib/google-sheets";

/* ── Config ─────────────────────────────────────────────────────── */

const CLOSERS = [
  { name: "Will Rincan", sheetKey: "WILL", alias: ["WILL", "RINCAN"] },
  { name: "Jacob Broz", sheetKey: "BROZ", alias: ["BROZ", "JACOB"] },
  { name: "Austin Richard", sheetKey: "AUSTIN", alias: ["AUSTIN"] },
];

const SETTERS = ["AMARA", "KELECHI", "KELCHI", "DEBBIE", "GIDEON"];

/* ── System Prompts ─────────────────────────────────────────────── */

const CLOSER_BRIEF_PROMPT = `You are the Chief Sales Officer generating a daily closer brief for Core Shift LLC's fitness coaching sales team. This brief is for ONE specific closer. Be direct, tactical, data-driven. No motivational fluff. No AI catchphrases. NEVER blame leads — closers own every outcome.

Format EXACTLY as follows (do not deviate):

# DAILY BRIEF — [CLOSER NAME]
**[Day of week], [Full Date] | [X] Scheduled Calls**
**MTD: $[X] cash | [X]% close rate | [X]% show rate**

---

## SECTION 1: CALL UPDATES

For each prospect:

### [Prospect Name]
**Client:** [Keith Holland / Tyson Sonnek] | **Setter:** [name] | **Status:** Confirmed
**Lead Score:** [X/10] | **Warmth:** [Hot/Warm/Cold-Warm/Cold]

[2-4 sentences of tactical notes. Reference setter patterns, client-specific close rates, and specific advice for THIS call. If no DM transcript, tell them to text the setter NOW with exact questions to ask. Include what to open with and what to probe.]

---

## SECTION 2: MINI REVIEW — YESTERDAY'S CALLS

[For each call from yesterday:]

### [Name] — [OUTCOME]
[Set by [setter] ([client]). [X]-minute call. What happened, what worked, what to do differently. Be specific.]

**Overall Pattern:** [1-2 sentences on the pattern]

---

## SECTION 3: ACTION ITEMS

[Numbered list, 4-7 items. Each must be specific and completable today. Include who to text, what to say, when to do it.]

---

## SECTION 4: AI ANALYSIS

[3-4 bullet points. Revenue at stake, patterns, risk flags, key focus for today. Include specific dollar amounts.]

---

Rules:
- NEVER blame leads or lead quality. The closer owns every outcome.
- Every sentence must be actionable or informative. Zero filler.
- If DM transcript missing, tell them to text the setter with exact questions.
- Use sales tracker data for setter names — NEVER say "setter unknown".
- Score leads based on setter track record, client type, and engagement signals.
- Keep under 5 minutes reading time.`;

const CEO_RECAP_PROMPT = `You are the Chief Sales Officer writing a daily sales recap to the CEO. Be direct, confident, data-driven. No suggestions — give DIRECTIVES. You are telling the CEO what IS happening and what they NEED to do.

Format EXACTLY as follows:

# CEO DAILY SALES RECAP
**[Day of week], [Full Date]**

---

## SECTION 1: MTD METRICS SNAPSHOT

[Present key metrics in a clear list format:]
- **Cash Collected:** $X
- **Revenue Booked:** $X
- **Calls Booked / Taken / Wins:** X / X / X
- **Close Rate:** X% (target: 45%)
- **Show Rate:** X% (target: 65%)
- **AOV:** $X
- **No-Shows:** X (X%)
- **Open PCFUs:** X ($X potential)
- **Subscriptions Sold:** X

**Yesterday:** [1-line summary of yesterday's results]

---

## SECTION 2: TEAM PERFORMANCE

### Closer Performance
[For each closer: name, booked, taken, wins, cash, close rate, show rate. Then 1-2 sentences of analysis and "What to follow up about:" with specific directive.]

### Setter Performance
[For each setter: name, client, booked, taken, wins, show rate. Then analysis and "What to follow up about:" with specific directive.]

---

## SECTION 3: WHERE THE MONEY IS LEAKING

[3-4 specific revenue leaks with dollar amounts. Each leak should have: the problem, the dollar impact, and the fix.]

---

## SECTION 4: CALL REVIEWS

[Review 1-2 specific calls from yesterday. Reference recording links if available. Compare approaches between closers. Give specific observations.]

---

## SECTION 5: PATTERNS AND DIRECTIVES

[Daily + monthly patterns. What you've noticed this month vs yesterday. Confident directives.]

---

## SECTION 6: CEO ACTION ITEMS

[5-7 numbered items. Each starts with a bold action verb. Specific, measurable, completable.]

---

Rules:
- Blend numbers AND call-based feedback. Never just numbers alone.
- Be 100% confident in decisions. "Do this" not "consider doing this."
- Include daily AND monthly patterns.
- Include specific dollar amounts for every revenue leak.
- NEVER blame leads in closer briefs. Lead quality issues go to CEO recap ONLY.
- Team names: Will Rincan, Jacob Broz, Austin Richard. Setters: Amara, Kelechi (Tyson), Gideon, Debbie (Keith).`;

/* ── Data Fetching (direct library call, no HTTP) ───────────────── */

async function fetchSheetData(dateFrom: string, dateTo: string): Promise<{ rows: SheetRow[]; subscriptionsSold: number }> {
  const [rows, subscriptionsSold] = await Promise.all([
    fetchSheetRows(dateFrom, dateTo),
    fetchSubscriptionsSold(dateFrom, dateTo).catch(() => 0),
  ]);
  return { rows, subscriptionsSold };
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function getCloserMTD(allRows: SheetRow[], alias: string[]) {
  const cr = allRows.filter((r) => alias.some((a) => (r.closer || "").toUpperCase() === a));
  const ct = cr.filter((r) => r.callTaken);
  const cw = cr.filter((r) => r.outcome === "WIN");
  const cc = cr.reduce((s, r) => s + (r.cashCollected || 0), 0);
  const cns = cr.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
  return { booked: cr.length, taken: ct.length, wins: cw.length, cash: cc, noShows: cns.length,
    cr: ct.length > 0 ? (cw.length / ct.length * 100).toFixed(1) : "0",
    sr: cr.length > 0 ? (ct.length / cr.length * 100).toFixed(1) : "0" };
}

function getSetterMTD(allRows: SheetRow[], setter: string) {
  const sr = allRows.filter((r) => (r.setter || "").toUpperCase().includes(setter));
  const st = sr.filter((r) => r.callTaken);
  const sw = sr.filter((r) => r.outcome === "WIN");
  const sns = sr.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
  const clients = [...new Set(sr.map((r) => r.offer).filter(Boolean))];
  return { booked: sr.length, taken: st.length, wins: sw.length, noShows: sns.length, clients,
    sr: sr.length > 0 ? (st.length / sr.length * 100).toFixed(1) : "0" };
}

/* ── Main Handler ───────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  // Verify cron secret
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

  // Dates in ET
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStr = etNow.toISOString().split("T")[0];
  const yesterday = new Date(etNow); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const monthStart = todayStr.substring(0, 8) + "01";

  // Fetch sales tracker data
  let sheetData: { rows: SheetRow[]; subscriptionsSold: number };
  try {
    sheetData = await fetchSheetData(monthStart, todayStr);
  } catch (err) {
    return NextResponse.json({ error: `Sheet data error: ${err}` }, { status: 500 });
  }

  const allRows = sheetData.rows;
  const todayRows = allRows.filter((r) => r.date === todayStr);
  const yesterdayRows = allRows.filter((r) => r.date === yesterdayStr);

  // MTD totals
  const taken = allRows.filter((r) => r.callTaken);
  const wins = allRows.filter((r) => r.outcome === "WIN");
  const noShows = allRows.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
  const pcfus = allRows.filter((r) => r.outcome === "PCFU");
  const totalCash = allRows.reduce((s, r) => s + (r.cashCollected || 0), 0);
  const totalRevenue = allRows.reduce((s, r) => s + (r.revenue || 0), 0);
  const closeRate = taken.length > 0 ? (wins.length / taken.length * 100) : 0;
  const showRate = allRows.length > 0 ? (taken.length / allRows.length * 100) : 0;
  const aov = wins.length > 0 ? totalCash / wins.length : 0;

  const mtdSummary = `Cash: $${totalCash.toLocaleString()} | Rev: $${totalRevenue.toLocaleString()} | ${allRows.length} booked / ${taken.length} taken / ${wins.length} wins | CR: ${closeRate.toFixed(1)}% | SR: ${showRate.toFixed(1)}% | AOV: $${aov.toFixed(0)} | NS: ${noShows.length} | PCFUs: ${pcfus.length} | Subs: ${sheetData.subscriptionsSold}`;

  const results: { type: string; closer?: string; success: boolean; error?: string }[] = [];

  // ─── CLOSER BRIEFS ───
  for (const closer of CLOSERS) {
    const todayCalls = todayRows.filter((r) => closer.alias.some((a) => (r.closer || "").toUpperCase() === a));
    const yesterdayCalls = yesterdayRows.filter((r) => closer.alias.some((a) => (r.closer || "").toUpperCase() === a));
    const mtd = getCloserMTD(allRows, closer.alias);

    const context = `Closer: ${closer.name}
Date: ${todayStr}
MTD: $${mtd.cash.toLocaleString()} cash | ${mtd.cr}% CR | ${mtd.sr}% SR | ${mtd.wins} wins / ${mtd.taken} taken / ${mtd.booked} booked

TODAY'S CALLS (${todayCalls.length}):
${todayCalls.length === 0 ? "No calls scheduled." : todayCalls.map((r, i) => `${i + 1}. ${r.name} | Client: ${r.offer || "?"} | Setter: ${r.setter || "?"}`).join("\n")}

YESTERDAY'S CALLS (${yesterdayCalls.length}):
${yesterdayCalls.length === 0 ? "No calls yesterday." : yesterdayCalls.map((r) => `${r.name}: ${r.outcome || "No outcome"} | Setter: ${r.setter || "?"} | Client: ${r.offer || "?"} | Taken: ${r.callTaken} | Length: ${r.callLength || "?"} min | Objection: ${r.objection || "none"} | Cash: $${r.cashCollected || 0} | Recording: ${r.recordingLink || "N/A"}`).join("\n")}

TEAM MTD: ${mtdSummary}

SETTER STATS:
${SETTERS.map((s) => { const d = getSetterMTD(allRows, s); return `${s} (${d.clients.join("/")}): ${d.booked} booked | ${d.taken} taken | ${d.wins} wins | ${d.noShows} NS | ${d.sr}% SR`; }).join("\n")}`;

    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514", max_tokens: 4000,
        system: CLOSER_BRIEF_PROMPT,
        messages: [{ role: "user", content: `Generate the daily brief for ${closer.name}:\n\n${context}` }],
      });
      const brief = msg.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n");
      const pdf = generatePDF(`Daily Brief — ${closer.name} (${todayStr})`, brief);
      await uploadFileAsCso(pdf, `brief-${closer.sheetKey.toLowerCase()}-${todayStr}.pdf`,
        `Daily Brief — ${closer.name} (${todayStr})`,
        `📋 *DAILY BRIEF — ${closer.name.toUpperCase()}*\n${todayCalls.length} calls | MTD: $${mtd.cash.toLocaleString()} | ${mtd.cr}% CR | ${mtd.sr}% SR`);
      results.push({ type: "closer_brief", closer: closer.name, success: true });
    } catch (err) {
      console.error(`[cron/daily-briefs] ${closer.name} error:`, err);
      results.push({ type: "closer_brief", closer: closer.name, success: false, error: String(err) });
    }
  }

  // ─── CEO RECAP ───
  try {
    const ceoContext = `MTD (${monthStart} to ${todayStr}):
${mtdSummary}

YESTERDAY (${yesterdayStr}):
${yesterdayRows.map((r) => `${r.name} | ${r.closer} | ${r.outcome || "pending"} | Setter: ${r.setter || "?"} | Cash: $${r.cashCollected || 0} | Obj: ${r.objection || "none"} | ${r.callLength || "?"} min | Recording: ${r.recordingLink || "N/A"} | Client: ${r.offer || "?"}`).join("\n") || "No calls yesterday."}

TODAY'S SCHEDULE:
${todayRows.map((r) => `${r.name} | ${r.closer} | Setter: ${r.setter || "?"} | Client: ${r.offer || "?"}`).join("\n") || "No calls today."}

CLOSER BREAKDOWN:
${CLOSERS.map((c) => { const m = getCloserMTD(allRows, c.alias); return `${c.name}: ${m.booked} booked | ${m.taken} taken | ${m.wins} wins | $${m.cash.toLocaleString()} | CR=${m.cr}% | SR=${m.sr}% | NS=${m.noShows}`; }).join("\n")}

SETTER BREAKDOWN:
${SETTERS.map((s) => { const d = getSetterMTD(allRows, s); return `${s} (${d.clients.join("/")}): ${d.booked} booked | ${d.taken} taken | ${d.wins} wins | ${d.noShows} NS | SR=${d.sr}%`; }).join("\n")}

CLIENT BREAKDOWN:
${["Tyson", "Keith"].map((cl) => { const cr = allRows.filter((r) => (r.offer || "").toLowerCase().includes(cl.toLowerCase())); const ct = cr.filter((r) => r.callTaken); const cw = cr.filter((r) => r.outcome === "WIN"); const cc = cr.reduce((s, r) => s + (r.cashCollected || 0), 0); return `${cl}: ${cr.length} booked | ${ct.length} taken | ${cw.length} wins | $${cc.toLocaleString()} | CR=${ct.length > 0 ? (cw.length / ct.length * 100).toFixed(1) : 0}%`; }).join("\n")}`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 6000,
      system: CEO_RECAP_PROMPT,
      messages: [{ role: "user", content: `Generate the CEO Daily Sales Recap:\n\n${ceoContext}` }],
    });
    const recap = msg.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n");
    const pdf = generatePDF(`CEO Daily Sales Recap (${todayStr})`, recap);
    await uploadFileAsCso(pdf, `ceo-recap-${todayStr}.pdf`,
      `CEO Daily Sales Recap — ${todayStr}`,
      `📊 *CEO DAILY SALES RECAP — ${todayStr}*\nMTD: $${totalCash.toLocaleString()} | ${wins.length} wins | ${closeRate.toFixed(1)}% CR | ${showRate.toFixed(1)}% SR | $${aov.toFixed(0)} AOV`);
    results.push({ type: "ceo_recap", success: true });
  } catch (err) {
    console.error("[cron/daily-briefs] CEO recap error:", err);
    results.push({ type: "ceo_recap", success: false, error: String(err) });
  }

  return NextResponse.json({ success: true, date: todayStr, results, total: results.filter((r) => r.success).length });
}
