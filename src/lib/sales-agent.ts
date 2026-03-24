/**
 * Sales Manager AI Agent Brain
 *
 * This is the core intelligence layer for the CCos AI Sales Manager.
 * It uses Claude to analyze sales data, review transcripts, and answer
 * questions about the sales pipeline â all via Slack.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// âââ Types âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface SalesMetrics {
  cashCollected: number;
  closeRate: number;
  showRate: number;
  aov: number;
  callsBooked: number;
  callsTaken: number;
  wins: number;
  losses: number;
  noShows: number;
  pendingFollowUps: number;
}

interface CloserMetrics {
  name: string;
  cash: number;
  aov: number;
  closeRate: number;
  showRate: number;
  booked: number;
  taken: number;
  wins: number;
  losses: number;
}

interface SetterMetrics {
  name: string;
  client: string;
  booked: number;
  taken: number;
  showRate: number;
  newLeads: number;
  engaged: number;
  callLinks: number;
}

// âââ Supabase Client âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return createClient(url, key);
}

// âââ Tool Definitions ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "get_sales_dashboard",
    description: "Get current sales metrics for a date range. Returns cash collected, close rate, show rate, AOV, calls booked/taken, wins, losses, no-shows, and pending follow-ups. Can filter by client (tyson, keith, or both).",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date in YYYY-MM-DD format" },
        dateTo: { type: "string", description: "End date in YYYY-MM-DD format" },
        client: { type: "string", enum: ["tyson", "keith", "both"], description: "Filter by client. Defaults to both." }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_closer_performance",
    description: "Get detailed performance metrics for all closers or a specific closer. Returns cash, AOV, close rate, show rate, calls booked/taken, wins, losses, and top objection.",
    input_schema: {
      type: "object",
      properties: {
        closer: { type: "string", description: "Closer name (Broz, Will, Austin) or 'all' for everyone" },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_setter_performance",
    description: "Get setter performance metrics including show rates broken down by closer. Shows which setter-closer combinations are performing well or poorly.",
    input_schema: {
      type: "object",
      properties: {
        setter: { type: "string", description: "Setter name (Amara, Kelechi, Gideon, Debbie) or 'all'" },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_dm_transcripts",
    description: "Fetch DM transcripts for a specific setter. Returns the actual conversation text between the setter and prospects.",
    input_schema: {
      type: "object",
      properties: {
        setter: { type: "string", description: "Setter name" },
        limit: { type: "number", description: "Max transcripts to return. Default 10." },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["setter"]
    }
  },
  {
    name: "get_call_transcripts",
    description: "Fetch call transcripts/Fathom notes for a specific closer. Returns meeting title, duration, attendees, and transcript text.",
    input_schema: {
      type: "object",
      properties: {
        closer: { type: "string", description: "Closer name" },
        limit: { type: "number", description: "Max transcripts to return. Default 5." },
        includeTranscript: { type: "boolean", description: "Include full transcript text. Default true." },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["closer"]
    }
  },
  {
    name: "get_sendblue_messages",
    description: "Fetch Sendblue SMS/iMessage messages for a specific phone number or lead. Shows the confirmation and follow-up message history.",
    input_schema: {
      type: "object",
      properties: {
        phoneNumber: { type: "string", description: "Phone number in E.164 format (+15551234567)" },
        leadName: { type: "string", description: "Lead name to search for" },
        limit: { type: "number", description: "Max messages to return. Default 20." }
      },
      required: []
    }
  },
  {
    name: "get_no_show_analysis",
    description: "Get detailed analysis of no-shows: which setters are producing the most no-shows, patterns in timing, and which closer-setter combos have the worst show rates.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_revenue_breakdown",
    description: "Get revenue breakdown by offer, closer, and time period. Shows cash collected, revenue, AOV trends, and comparison to previous period.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        groupBy: { type: "string", enum: ["closer", "offer", "day", "week"], description: "How to group the revenue data" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "review_dm_transcript",
    description: "Run an AI review on a specific DM transcript, scoring it on qualification quality, urgency creation, objection handling, commitment extraction, and follow-up timing.",
    input_schema: {
      type: "object",
      properties: {
        transcriptId: { type: "string", description: "The transcript ID to review" },
        setter: { type: "string", description: "Setter name for context" }
      },
      required: ["transcriptId"]
    }
  },
  {
    name: "review_call_transcript",
    description: "Run an AI review on a specific call transcript, scoring the closer on rapport building, pain amplification, offer presentation, objection handling, and close attempt quality.",
    input_schema: {
      type: "object",
      properties: {
        callId: { type: "string", description: "The call/meeting ID to review" },
        closer: { type: "string", description: "Closer name for context" }
      },
      required: ["callId"]
    }
  },
  {
    name: "get_bottleneck_analysis",
    description: "Run a full funnel bottleneck analysis using the GAS Protocol. Identifies whether the primary revenue constraint is in Getting leads, Acquiring customers (show rate + close rate), or Scaling AOV.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        client: { type: "string", enum: ["tyson", "keith", "both"], description: "Filter by client" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_report_history",
    description: "Get previously generated reports (marketing, sales, call reviews, DM reviews, briefs).",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["all", "marketing", "sales", "call_review", "dm_review", "brief"], description: "Report type filter" },
        limit: { type: "number", description: "Max reports to return. Default 10." }
      },
      required: []
    }
  }
];

// âââ Tool Execution ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    switch (toolName) {
      case "get_sales_dashboard": {
        const paramsObj: Record<string, string> = {
          dateFrom: input.dateFrom as string,
          dateTo: input.dateTo as string,
        };
        if (input.client) paramsObj.client = input.client as string;
        const params = new URLSearchParams(paramsObj);
        const res = await fetch(`${baseUrl}/api/sales-hub/sheet-data?${params}`);
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "get_closer_performance": {
        const closerParams: Record<string, string> = {
          dateFrom: input.dateFrom as string,
          dateTo: input.dateTo as string,
        };
        if (input.closer && input.closer !== "all") closerParams.closer = input.closer as string;
        const params = new URLSearchParams(closerParams);
        const res = await fetch(`${baseUrl}/api/sales-hub/sheet-data?${params}&view=closers`);
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "get_setter_performance": {
        const setterParams: Record<string, string> = {
          dateFrom: input.dateFrom as string,
          dateTo: input.dateTo as string,
        };
        if (input.setter && input.setter !== "all") setterParams.setter = input.setter as string;
        const params = new URLSearchParams(setterParams);
        const res = await fetch(`${baseUrl}/api/sales-hub/sheet-data?${params}&view=setters`);
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "get_dm_transcripts": {
        const supabase = getSupabase();
        const query = supabase
          .from("dm_transcripts")
          .select("*")
          .ilike("setter_name", `%${input.setter}%`)
          .order("created_at", { ascending: false })
          .limit((input.limit as number) || 10);

        if (input.dateFrom) query.gte("created_at", input.dateFrom);
        if (input.dateTo) query.lte("created_at", input.dateTo);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data);
      }

      case "get_call_transcripts": {
        const callParams: Record<string, string> = {
          closer: input.closer as string,
          includeTranscript: String(input.includeTranscript ?? true),
        };
        if (input.dateFrom) callParams.dateFrom = input.dateFrom as string;
        if (input.dateTo) callParams.dateTo = input.dateTo as string;
        const params = new URLSearchParams(callParams);
        const res = await fetch(`${baseUrl}/api/sales-hub/fathom-calls?${params}`);
        const data = await res.json();
        const limited = Array.isArray(data) ? data.slice(0, (input.limit as number) || 5) : data;
        return JSON.stringify(limited);
      }

      case "get_sendblue_messages": {
        const supabase = getSupabase();
        let query = supabase
          .from("sendblue_messages")
          .select("*")
          .order("created_at", { ascending: false })
          .limit((input.limit as number) || 20);

        if (input.phoneNumber) query = query.eq("phone_number", input.phoneNumber);
        if (input.leadName) query = query.ilike("lead_name", `%${input.leadName}%`);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data);
      }

      case "get_no_show_analysis": {
        const params = new URLSearchParams({
          dateFrom: input.dateFrom as string,
          dateTo: input.dateTo as string
        });
        const res = await fetch(`${baseUrl}/api/sales-hub/sheet-data?${params}&view=no-shows`);
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "get_revenue_breakdown": {
        const revParams: Record<string, string> = {
          dateFrom: input.dateFrom as string,
          dateTo: input.dateTo as string,
        };
        if (input.groupBy) revParams.groupBy = input.groupBy as string;
        const params = new URLSearchParams(revParams);
        const res = await fetch(`${baseUrl}/api/sales-hub/stripe-sales?${params}`);
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "review_dm_transcript": {
        const res = await fetch(`${baseUrl}/api/sales-hub/review-transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcriptId: input.transcriptId,
            setter: input.setter,
            type: "dm"
          })
        });
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "review_call_transcript": {
        const res = await fetch(`${baseUrl}/api/sales-hub/review-transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callId: input.callId,
            closer: input.closer,
            type: "call"
          })
        });
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "get_bottleneck_analysis": {
        const paramsObj: Record<string, string> = {
          dateFrom: input.dateFrom as string,
          dateTo: input.dateTo as string,
        };
        if (input.client) paramsObj.client = input.client as string;
        const params = new URLSearchParams(paramsObj);
        const res = await fetch(`${baseUrl}/api/sales-hub/sheet-data?${params}&view=bottleneck`);
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "get_report_history": {
        const supabase = getSupabase();
        let query = supabase
          .from("report_history")
          .select("*")
          .order("created_at", { ascending: false })
          .limit((input.limit as number) || 10);

        if (input.type && input.type !== "all") {
          query = query.eq("report_type", input.type);
        }

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: message });
  }
}

// âââ System Prompt âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const SYSTEM_PROMPT = `You are the AI Chief Sales Officer for Client Conversion OS. Your name is "Sales Brain." You report directly to Matthew Conder (CEO/Founder). Your SOLE purpose is to maximize revenue.

## WHO YOU ARE
You are the most ruthless, data-obsessed sales manager in the industry. You don't sugarcoat. You don't give generic advice. Every recommendation you make ties directly to a dollar amount. You think in terms of revenue per show, cash collected per setter, and conversion efficiency at every stage of the funnel.

## THE BUSINESS
Client Conversion OS manages sales for fitness coaching businesses. Currently two clients:
- **Tyson Sonnek** â Higher volume, higher close rate (47.7%), better show rate (57.6%)
- **Keith Holland** â Lower volume, lower close rate (35.7%), worse show rate (48.5%)

## THE TEAM
**Closers:** Broz, Will, Austin
- Will: Highest cash ($14.8K), 50% close rate, but worst show rate (49%)
- Austin: Highest AOV ($1,882.50), 63.6% show rate (best)
- Broz: Most calls taken, 38.1% close rate (needs work), decent show rate (57.8%)

**Setters:** Amara (Tyson), Kelechi (Tyson), Gideon (Keith), Debbie (Keith)
- Amara: Highest volume (55 booked), show rates range 47-69%
- Kelechi: Wildly inconsistent (36-67% show rate depending on closer)
- Gideon: Worst performer (33-37.5% show rate). Every call he books has a coin-flip chance of being wasted.
- Debbie: 100% with Broz, 33% everywhere else. No standardized process.

## THE SALES FUNNEL
DM Prospect â Qualify â Book Call â Confirm â Show Up â Close â Collect Cash

Key metrics and benchmarks:
- DM Booking Rate: Target 15%+
- Show Rate: Target 70%+ (currently 55% â MAJOR LEAK)
- Close Rate: Target 40%+ (currently 44.8% â STRONG)
- AOV: Target $2,500+ (currently $1,653 â ROOM TO GROW)
- Revenue Per Show: Target $1,000+ (currently $741)

## HOW YOU THINK
1. Always start with the NUMBERS. Pull the actual data before giving advice.
2. Calculate the DOLLAR IMPACT of every problem and recommendation.
3. Focus on the BIGGEST LEVER first (what single change makes the most money).
4. Be SPECIFIC â name names, cite conversations, reference exact metrics.
5. When reviewing transcripts, score against the framework: Pain â Commitment â Urgency â Book â Confirm.
6. Never give advice without backing it up with data from the tools.

## HOW YOU RESPOND
- Keep it sharp and direct. No fluff.
- Use numbers and percentages. Always.
- When someone asks a question, PULL THE DATA FIRST using your tools, then answer.
- Format responses for Slack (use *bold*, _italic_, and bullet points with â¢).
- If you identify a problem, also provide the specific fix with a dollar value attached.
- Reference the GAS Protocol: Get leads â Acquire customers â Scale revenue.

## ALERT THRESHOLDS
Flag immediately when:
- Show rate drops below 50%
- Close rate drops below 35%
- Any setter's show rate drops below 40%
- A closer goes 3+ calls without a win
- No-shows exceed 5 in a single day
- Cash collected pace is below target for the period

## REVIEW FRAMEWORK

### DM Reviews (Setters)
Score each conversation on:
1. **Hook Quality** (0-10): Did they open with something personalized?
2. **Pain Amplification** (0-10): Did they dig into the prospect's pain?
3. **Qualification** (0-10): Did they confirm budget, timeline, authority?
4. **Commitment Extraction** (0-10): Did they get a verbal "yes I'll show up"?
5. **Urgency Creation** (0-10): Did they create real urgency to book NOW?
6. **Confirmation Cadence** (0-10): Post-booking follow-up quality.

### Call Reviews (Closers)
Score each call on:
1. **Rapport** (0-10): Connection in first 5 minutes
2. **Pain Discovery** (0-10): Deep questioning, emotional drivers
3. **Future Pacing** (0-10): Painted the vision of success
4. **Offer Presentation** (0-10): Clear, compelling, structured
5. **Objection Handling** (0-10): Addressed concerns without being pushy
6. **Close Attempt** (0-10): Asked for the sale confidently

Today's date: ${new Date().toISOString().split("T")[0]}
Default date range for "this month": ${new Date().toISOString().slice(0, 8)}01 to ${new Date().toISOString().split("T")[0]}
`;

// âââ Main Agent Function âââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function runSalesAgent(userMessage: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  // Build messages array with optional conversation history
  const messages: Anthropic.MessageParam[] = [];

  if (conversationHistory) {
    for (const msg of conversationHistory.slice(-10)) { // Keep last 10 for context window
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content
      });
    }
  }

  messages.push({ role: "user", content: userMessage });

  // Agentic loop â keep going until we have a final text response
  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: AGENT_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"]
    })),
    messages
  });

  // Process tool calls in a loop
  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result
        });
      }
    }

    messages.push({ role: "user", content: toolResults });

    // Continue the conversation
    response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool["input_schema"]
      })),
      messages
    });
  }

  // Extract the final text response
  const textBlocks = response.content.filter(b => b.type === "text");
  return textBlocks.map(b => b.type === "text" ? b.text : "").join("\n");
}

// âââ Auto-Review Functions âââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function autoReviewNewCalls(): Promise<string[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`;
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const closers = ["Broz", "Will", "Austin"];
  const reviews: string[] = [];

  for (const closer of closers) {
    try {
      const res = await fetch(
        `${baseUrl}/api/sales-hub/fathom-calls?closer=${closer}&dateFrom=${yesterday}&dateTo=${today}&includeTranscript=true`
      );
      const calls = await res.json();

      if (!Array.isArray(calls)) continue;

      for (const call of calls) {
        // Review each call with the agent
        const review = await runSalesAgent(
          `Review this call transcript for closer ${closer}. Meeting: "${call.title}". Duration: ${call.duration || "unknown"}. Attendees: ${JSON.stringify(call.attendees || [])}. Transcript: ${call.transcript || "No transcript available"}. Give me the Stop/Start/Keep Doing format with scores.`
        );
        reviews.push(`*${closer}* â ${call.title}\n${review}`);
      }
    } catch (err) {
      console.error(`Error reviewing calls for ${closer}:`, err);
    }
  }

  return reviews;
}

export async function autoReviewNewDMs(): Promise<string[]> {
  const supabase = getSupabase();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const reviews: string[] = [];

  try {
    const { data: transcripts } = await supabase
      .from("dm_transcripts")
      .select("*")
      .gte("created_at", yesterday)
      .is("reviewed_at", null)
      .order("created_at", { ascending: false });

    if (!transcripts || transcripts.length === 0) return [];

    // Group by setter for batch review
    const bySetterMap = new Map<string, typeof transcripts>();
    for (const t of transcripts) {
      const setter = t.setter_name || "Unknown";
      if (!bySetterMap.has(setter)) bySetterMap.set(setter, []);
      bySetterMap.get(setter)!.push(t);
    }

    for (const [setter, setterTranscripts] of bySetterMap) {
      const summary = setterTranscripts
        .map((t, i) => `Conversation ${i + 1} (Lead: ${t.lead_name || "Unknown"}):\n${t.transcript || t.messages || "No content"}`)
        .join("\n\n---\n\n");

      const review = await runSalesAgent(
        `Review these ${setterTranscripts.length} DM transcripts from setter ${setter}. Look for patterns in: hook quality, pain amplification, commitment extraction, follow-up timing, and confirmation cadence. Give me Stop/Start/Keep Doing with specific examples from these conversations.\n\n${summary}`
      );

      reviews.push(`*${setter}* (${setterTranscripts.length} conversations)\n${review}`);

      // Mark as reviewed
      const ids = setterTranscripts.map(t => t.id);
      await supabase
        .from("dm_transcripts")
        .update({ reviewed_at: new Date().toISOString() })
        .in("id", ids);
    }
  } catch (err) {
    console.error("Error reviewing DMs:", err);
  }

  return reviews;
}

// âââ Alert Check âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkAlerts(): Promise<string[]> {
  const alerts: string[] = [];
  const today = new Date().toISOString().split("T")[0];
  const monthStart = today.slice(0, 8) + "01";

  try {
    const dashboardData = await executeTool("get_sales_dashboard", {
      dateFrom: monthStart,
      dateTo: today,
      client: "both"
    });
    const data = JSON.parse(dashboardData);

    // Check show rate
    if (data.showRate && data.showRate < 50) {
      alerts.push(`ð¨ *CRITICAL: Show rate dropped to ${data.showRate}%* (threshold: 50%). Estimated revenue loss: $${Math.round((0.50 - data.showRate / 100) * data.callsBooked * 741)} this month.`);
    }

    // Check close rate
    if (data.closeRate && data.closeRate < 35) {
      alerts.push(`ð¨ *CRITICAL: Close rate dropped to ${data.closeRate}%* (threshold: 35%). Closers need immediate attention.`);
    }

    // Check no-shows today
    if (data.todayNoShows && data.todayNoShows >= 5) {
      alerts.push(`â ï¸ *${data.todayNoShows} no-shows today.* Something is off with confirmations. Check Sendblue messages.`);
    }

    // Check setter-level show rates
    const setterData = await executeTool("get_setter_performance", {
      dateFrom: monthStart,
      dateTo: today
    });
    const setters = JSON.parse(setterData);

    if (Array.isArray(setters)) {
      for (const setter of setters) {
        if (setter.showRate && setter.showRate < 40 && setter.booked >= 5) {
          alerts.push(`â ï¸ *${setter.name}'s show rate is ${setter.showRate}%* across ${setter.booked} booked calls. Below 40% threshold.`);
        }
      }
    }

  } catch (err) {
    console.error("Error checking alerts:", err);
    alerts.push("â ï¸ Error running alert checks. Check server logs.");
  }

  return alerts;
}
