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

// The coach paradigm — sharpen ideas, never script. Built into every session.
const COACH_SYSTEM = (name: string, ctx: string) =>
  `You are an elite short-form content coach for ${name}, a 1:1 fitness coach. Your ONE job: help ${name} come up with NEW Instagram reel ideas and angles that pull in MORE of the people who actually buy 1:1 coaching — the audience we then retarget with ads. Content is the top of the funnel; better content = better, cheaper leads.

HOW YOU COACH:
- Ground every idea in the REAL data below (who's actually showing up, their pain, objections, desires, and what's already worked in ${name}'s content). Reference it specifically.
- Lead with pain and real buyer psychology, but stay ENTERTAINING and native to Instagram.
- NEVER hand a word-for-word script. NEVER be dogmatic or formulaic. Give the hook idea, the angle, the emotional beat, the "why this pulls the right person" — and leave the exact wording and creative execution to ${name}. Protect their voice and creative freedom.
- Be concise and concrete. Offer a few sharp options, not an essay. Push back honestly if an idea would attract the wrong (non-buying) audience.

REAL CONTEXT FOR ${name.toUpperCase()}:
${ctx}`;

interface Msg { role: "user" | "assistant"; content: string }

export async function POST(req: NextRequest) {
  const s = await auth();
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const slug = (body?.creator || "").toLowerCase();
  const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  if (!messages.length) return NextResponse.json({ error: "No messages" }, { status: 400 });

  const sb = getServiceSupabase();
  const [{ data: audience }, { data: voc }, { data: reels }] = await Promise.all([
    sb.from("content_audience_read").select("summary, metrics").eq("client_key", slug).maybeSingle(),
    sb.from("content_voc").select("bucket, quote, attribution").eq("client_key", slug).order("sort_order").limit(40),
    sb.from("creator_content").select("caption, transcript, like_count, comment_count").eq("client_key", slug)
      .order("like_count", { ascending: false, nullsFirst: false }).limit(15),
  ]);

  const vocByBucket: Record<string, string[]> = {};
  for (const q of voc || []) (vocByBucket[q.bucket] ||= []).push(`"${q.quote}"${q.attribution ? ` — ${q.attribution}` : ""}`);
  const vocText = Object.entries(vocByBucket).map(([b, qs]) => `${b.toUpperCase()}:\n${qs.slice(0, 8).join("\n")}`).join("\n\n");

  const topReels = (reels || [])
    .map((r) => `• (${r.like_count || 0} likes) ${(r.caption || "").replace(/\n/g, " ").slice(0, 140)}${r.transcript ? ` | said: ${r.transcript.slice(0, 200)}` : ""}`)
    .join("\n");

  const ctx = [
    audience?.summary ? `WHO'S SHOWING UP / LEAD QUALITY:\n${audience.summary}` : "WHO'S SHOWING UP: (not analyzed yet — tell the user to run the audience read)",
    vocText ? `VERBATIM PROSPECT QUOTES:\n${vocText}` : "VERBATIM QUOTES: (none yet)",
    topReels ? `TOP-PERFORMING CONTENT (by likes):\n${topReels}` : "TOP CONTENT: (no reels pulled yet)",
  ].join("\n\n");

  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL, max_tokens: 1500, system: COACH_SYSTEM(NAMES[slug] || slug, ctx),
      messages: messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
    });
    logAiUsage({ feature: "content-coach", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    return NextResponse.json({ reply: tb?.text || "(no response)" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "coach failed" }, { status: 500 });
  }
}
