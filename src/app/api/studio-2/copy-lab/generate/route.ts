import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

type UsableWinner = {
  clientKey: string;
  offerType: string;
  spend: number;
  copy: string;
};

let anthropic: Anthropic | null = null;
function getAnthropic() {
  anthropic ||= new Anthropic();
  return anthropic;
}

const SYSTEM_PROMPT = `You write direct-response Instagram Story ad copy for fitness creators.

Use winning ad copy as source material. Make close but fresh variations.

Rules:
- Keep the creator's tone direct, casual, and slightly confrontational.
- Do not sound like a generic marketing template.
- Respect the offer type for each requested ad.
- Output only usable ad copy.
- Each line of ad copy goes on its own line.
- Blank lines separate text blocks within one ad.
- Five dashes on their own line separate different ads.
- Never number the ads.
- Never wrap the output in markdown.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const winners = Array.isArray(body.winners) ? body.winners : [];
    const count = Math.max(1, Math.min(60, Number(body.count || 10) || 10));
    const direction = String(body.direction || "").trim();

    const usableWinners = winners
      .map((winner: Record<string, unknown>) => ({
        clientKey: String(winner.clientKey || "client"),
        offerType: String(winner.offerType || "Lead Magnet"),
        spend: Number(winner.spend || 0),
        copy: String(winner.extractedCopy || winner.text || "").trim(),
      }))
      .filter((winner: { copy: string }) => winner.copy);

    if (!usableWinners.length) {
      return NextResponse.json({ error: "Transcribe at least one winning ad first." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const sourceText = (usableWinners as UsableWinner[])
      .map((winner: UsableWinner, index: number) => [
        `Winner ${index + 1}`,
        `Client: ${winner.clientKey}`,
        `Offer type: ${winner.offerType}`,
        `Spend: ${winner.spend}`,
        winner.copy,
      ].join("\n"))
      .join("\n\n---\n\n");

    const response = await getAnthropic().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `Write ${count} new ad copy variations based on these winners.`,
            direction ? `Extra direction: ${direction}` : "",
            "Keep them close to what is already working. Small changes are better than wild rewrites.",
            "Format for Studio 2.0 exactly: blank lines create text blocks, five dashes separate ads.",
            "",
            sourceText,
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const text = response.content.find((part) => part.type === "text")?.text?.trim() || "";
    return NextResponse.json({ copy: text }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-copy-lab-generate] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate copy variations" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
