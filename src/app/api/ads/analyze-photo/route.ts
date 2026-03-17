import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a layout assistant for Instagram Story ads (1080×1920 pixels).

Your job: look at this photo of a person and tell me which SIDE of the frame has the most open space for large text overlays.

The canvas is 1080px wide × 1920px tall.

CRITICAL CONSTRAINTS:
- The bottom 25% (below y=1440) is a DEAD ZONE — Instagram's UI covers it. NO text there.
- Text must be LARGE and READABLE — minimum 700px wide. The full width (960px) is preferred.
- Text blocks use black semi-transparent pill backgrounds so they are readable over ANY area — even over the subject's body is fine. Just avoid covering the FACE.
- The ad needs 3 zones stacked vertically: TITLE near top, BODY in middle, CTA near bottom (but above 1440).

WHAT I NEED FROM YOU:
1. Where is the person's FACE? (so we avoid covering it)
2. Which side of the frame should text align to? (left, center, or right)

OUTPUT FORMAT — Return ONLY valid JSON:
{
  "face": {
    "centerX": <number 0-1080>,
    "centerY": <number 0-1920>,
    "radius": <number — approximate radius in px covering the face>
  },
  "textSide": "left" | "center" | "right",
  "titleY": <number — suggested Y position for title block, typically 60-200>,
  "bodyY": <number — suggested Y position for body/bullets, typically 400-800>,
  "ctaY": <number — suggested Y position for CTA, MUST be between 1050-1350>
}

RULES FOR textSide:
- If the person is centered: use "left" (text left-aligned is most readable)
- If the person is on the right: use "left"
- If the person is on the left: use "right"
- Only use "center" if the person is very small or mostly at the bottom

RULES FOR Y positions:
- titleY: should be near the top (60-250), pick a spot where the face ISN'T
- bodyY: middle area (350-900), spread out from title, avoid face area
- ctaY: lower area but ALWAYS between 1050 and 1350 (above the dead zone)
- Each zone needs at least 150px of vertical space between them`;

export async function POST(req: NextRequest) {
  try {
    const { photoBase64 } = await req.json();

    if (!photoBase64) {
      return NextResponse.json({ error: "No photo provided" }, { status: 400 });
    }

    // Extract the base64 data and media type from the data URL
    const match = photoBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
    }

    const mediaType = match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const base64Data = match[2];

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: "Where is the person's face, and which side should I put large text? Return JSON only.",
            },
          ],
        },
      ],
    });

    // Extract the text content from the response
    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    // Parse the JSON response — handle potential markdown wrapping
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const analysis = JSON.parse(jsonStr);

    return NextResponse.json(analysis);
  } catch (error: unknown) {
    console.error("Photo analysis error:", error);
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
