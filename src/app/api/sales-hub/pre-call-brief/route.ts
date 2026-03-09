import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const PRE_CALL_BRIEF_SYSTEM_PROMPT = `You are a pre-call brief generator for a fitness coaching sales team. Given the data about a prospect, create a concise one-page brief that helps the closer go into the call prepared.

Format the brief as:

## [Prospect Name] — Pre-Call Brief
**Call Date:** [date/time]
**Closer:** [closer name]
**Client Offer:** [Tyson Sonnek / Keith Holland]
**Setter:** [who set this lead]

### Lead Temperature: [HOT / WARM / COLD]
[One sentence explaining why]

### Key Pain Points & Buying Signals
[Extract from DM conversation data and engagement signals. Be specific.]

### What Brought Them In
[The lead magnet/campaign that attracted them]

### Engagement Level
[How engaged were they in DMs? Quick replies? Detailed responses? Ghosted and came back?]

### Pricing Signals
[Any indication of budget from DMs]

### Potential Objections
[Based on patterns, what objections might come up? Money/Fear/Spouse/Timing?]

### Recommended Approach
[Specific advice for the closer based on this lead's profile. What to emphasize, what to avoid.]

Keep it concise and actionable. The closer should be able to read this in 60 seconds before the call.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactName, callDate, closer, client, setter, manychatData, sheetHistory, ghlData } = body;

    if (!contactName) {
      return NextResponse.json(
        { error: "contactName is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Build the context message with all available data
    const contextParts: string[] = [];

    contextParts.push(`Prospect Name: ${contactName}`);
    if (callDate) contextParts.push(`Call Date: ${callDate}`);
    if (closer) contextParts.push(`Closer: ${closer}`);
    if (client) contextParts.push(`Client/Offer: ${client}`);
    if (setter) contextParts.push(`Setter: ${setter}`);

    if (manychatData) {
      contextParts.push(`\n--- ManyChat / DM Data ---\n${typeof manychatData === "string" ? manychatData : JSON.stringify(manychatData, null, 2)}`);
    }

    if (sheetHistory) {
      contextParts.push(`\n--- Sheet History (Previous Calls) ---\n${typeof sheetHistory === "string" ? sheetHistory : JSON.stringify(sheetHistory, null, 2)}`);
    }

    if (ghlData) {
      contextParts.push(`\n--- GHL Contact Data ---\n${typeof ghlData === "string" ? ghlData : JSON.stringify(ghlData, null, 2)}`);
    }

    const userMessage = contextParts.join("\n");

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: PRE_CALL_BRIEF_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate a pre-call brief for this prospect:\n\n${userMessage}`,
        },
      ],
    });

    const brief = message.content
      .filter((block) => block.type === "text")
      .map((block) => {
        if (block.type === "text") return block.text;
        return "";
      })
      .join("\n");

    return NextResponse.json({ brief });
  } catch (err) {
    console.error("Pre-call brief generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate pre-call brief" },
      { status: 500 }
    );
  }
}
