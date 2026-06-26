import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";
const NAMES: Record<string, string> = { tyson: "Tyson", antwan: "Antwan" };
// dm_transcripts / connection rows use long keys; ads use short. Accept both.
const CLIENT_ALIASES: Record<string, string[]> = {
  tyson: ["tyson", "tyson_sonnek"],
  antwan: ["antwan", "antwan_rarcus"],
};

interface GenIdea { title: string; angle?: string; hook?: string; evidence?: string; source?: string }

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = (new URL(req.url).searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const name = NAMES[slug] || slug;

  // 1) Buyer language — people who ACTUALLY paid (scoped to this creator via keyword join).
  const { data: subs } = await sb
    .from("ads_keyword_events")
    .select("subscriber_id")
    .eq("client_key", slug)
    .not("subscriber_id", "is", null);
  const subIds = [...new Set((subs || []).map((s) => s.subscriber_id))].slice(0, 4000);
  let buyerNotes: string[] = [];
  if (subIds.length) {
    const { data: buyers } = await sb
      .from("sales_tracker_rows")
      .select("offer, objection, call_notes, program_length, collected_revenue_cents, manychat_subscriber_id")
      .gt("collected_revenue_cents", 0)
      .in("manychat_subscriber_id", subIds)
      .order("date", { ascending: false })
      .limit(30);
    buyerNotes = (buyers || [])
      .map((b) =>
        [b.offer && `offer:${b.offer}`, b.objection && `objection:${b.objection}`, b.call_notes && `notes:${b.call_notes}`]
          .filter(Boolean)
          .join(" | ")
      )
      .filter((s) => s.trim().length > 0);
  }

  // 2) DM pain language for this creator.
  const { data: dms } = await sb
    .from("dm_transcripts")
    .select("transcript, client")
    .in("client", CLIENT_ALIASES[slug] || [slug])
    .order("submitted_at", { ascending: false })
    .limit(40);
  const dmText = (dms || [])
    .map((d) => (d.transcript || "").slice(0, 1200))
    .filter((s) => s.trim().length > 0);

  if (!buyerNotes.length && !dmText.length) {
    return NextResponse.json(
      { error: `No buyer notes or DM transcripts found for ${name} yet — nothing to mine.` },
      { status: 422 }
    );
  }

  const system =
    "You are a direct-response content strategist for a 1:1 fitness coaching business. " +
    "From REAL evidence (what paying clients said on sales calls + what leads say in DMs), produce " +
    "Instagram Reel content ideas that would attract MORE of the people who actually buy. " +
    "Every idea must be grounded in the evidence — no generic fitness fluff. Return STRICT JSON only.";

  const user = [
    `Creator: ${name}.`,
    "",
    "=== WHAT PAYING CLIENTS SAID (sales calls — offers, objections, notes) ===",
    buyerNotes.length ? buyerNotes.map((b, i) => `${i + 1}. ${b}`).join("\n") : "(none attributed yet)",
    "",
    "=== WHAT LEADS SAY IN DMs (pain language) ===",
    dmText.length ? dmText.map((d, i) => `${i + 1}. ${d}`).join("\n") : "(none yet)",
    "",
    "Produce 8 reel ideas. Return STRICT JSON: an array of objects with keys:",
    `"title" (short), "angle" (the buyer psychology it targets), "hook" (the first spoken line of the reel), ` +
    `"evidence" (the exact buyer/DM signal it's based on — quote or paraphrase), "source" (one of: buyer_trend, dm_pain).`,
    "No prose outside the JSON array.",
  ].join("\n");

  let ideas: GenIdea[] = [];
  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2200,
      system,
      messages: [{ role: "user", content: user }],
    });
    logAiUsage({ feature: "content-ideas", model: MODEL, usage: resp.usage });
    const text = resp.content.find((b) => b.type === "text")?.type === "text"
      ? (resp.content.find((b) => b.type === "text") as { text: string }).text
      : "";
    const jsonStr = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const start = jsonStr.indexOf("[");
    const end = jsonStr.lastIndexOf("]");
    ideas = JSON.parse(jsonStr.slice(start, end + 1));
  } catch (err) {
    return NextResponse.json(
      { error: `Idea generation failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  const rows = ideas
    .filter((i) => i && i.title)
    .slice(0, 8)
    .map((i) => ({
      client_key: slug,
      title: String(i.title).slice(0, 300),
      angle: i.angle ? String(i.angle).slice(0, 500) : null,
      hook: i.hook ? String(i.hook).slice(0, 500) : null,
      evidence: i.evidence ? String(i.evidence).slice(0, 800) : null,
      source: i.source === "buyer_trend" || i.source === "dm_pain" ? i.source : "dm_pain",
    }));

  if (rows.length) {
    const { error } = await sb.from("content_ideas").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, created: rows.length });
}
