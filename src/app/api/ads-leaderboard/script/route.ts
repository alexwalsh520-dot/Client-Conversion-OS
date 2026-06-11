// /api/ads-leaderboard/script  (PUBLIC, token-validated)
// Generates the contestant's custom video ad script using the in-house SONNET
// framework from their intake answers, stores it on the entry, and returns it.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import {
  SONNET_SYSTEM_PROMPT,
  buildSonnetUserMessage,
  INTAKE_QUESTIONS,
} from "@/lib/ads-leaderboard/sonnet-framework";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-20250514";
const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const db = getServiceSupabase();
    const { data: row, error } = await db
      .from("ad_contest_entries")
      .select("id, status, intake")
      .eq("token", token)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

    // Prefer the intake passed in this request (latest), fall back to stored.
    const intake: Record<string, string> =
      body.intake && typeof body.intake === "object" ? body.intake : (row.intake as Record<string, string>) || {};

    // Require the must-have answers before spending tokens.
    const missing = INTAKE_QUESTIONS.filter((q) => q.required && !(intake[q.id] || "").trim());
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Please answer: ${missing.map((q) => q.label).join(", ")}` },
        { status: 400 },
      );
    }

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SONNET_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildSonnetUserMessage(intake) }],
    });

    try {
      logAiUsage({ feature: "ads-leaderboard-script", model: MODEL, usage: msg.usage });
    } catch {
      /* usage logging is non-critical */
    }

    const script = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!script) {
      return NextResponse.json({ error: "Could not generate a script. Please try again." }, { status: 502 });
    }

    await db
      .from("ad_contest_entries")
      .update({
        intake,
        script,
        status: row.status === "submitted" || row.status === "live" ? row.status : "script_ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return NextResponse.json({ script });
  } catch (err) {
    console.error("[ads-leaderboard/script] error:", err);
    return NextResponse.json({ error: "Script generation failed. Please try again." }, { status: 500 });
  }
}
