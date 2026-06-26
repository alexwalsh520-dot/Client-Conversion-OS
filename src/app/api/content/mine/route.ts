import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";
const ALIASES: Record<string, string[]> = { tyson: ["tyson", "tyson_sonnek"], antwan: ["antwan", "antwan_rarcus"] };
const BUCKETS = ["pain", "objection", "desire", "avatar"];

const EXTRACT_SYS =
  "You mine a fitness coach's real prospect conversation for CONTENT fuel. Pull the PROSPECT's VERBATIM words (not the coach's) that reveal: pain (what hurts / frustrates them), objection (what makes them hesitate to commit), desire (what they actually want), avatar (who they are — life stage, identity, situation). Only real quotes, lightly trimmed, never invented. Return STRICT JSON: {\"quotes\":[{\"bucket\":one of pain|objection|desire|avatar,\"quote\":\"...\",\"attribution\":\"short who/context\"}]}. 4-10 quotes max, the most content-useful ones. No prose outside JSON.";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

async function extract(client: Anthropic, label: string, text: string) {
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1500, system: EXTRACT_SYS,
    messages: [{ role: "user", content: `${label}\n\n${text.slice(0, 70000)}` }],
  });
  logAiUsage({ feature: "content-mine", model: MODEL, usage: resp.usage });
  const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
  const raw = (tb?.text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { quotes?: Array<{ bucket: string; quote: string; attribution?: string }> };
  return (parsed.quotes || []).filter((q) => q?.quote && BUCKETS.includes(q.bucket));
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const limit = Math.min(Number(url.searchParams.get("limit") || 6), 12);

  const sb = getServiceSupabase();
  const { data: minedRows } = await sb.from("content_mined").select("source, source_id");
  const mined = new Set((minedRows || []).map((m) => `${m.source}:${m.source_id}`));

  // Un-mined calls + DM transcripts for this creator.
  const { data: calls } = await sb.from("fathom_calls").select("fathom_id, title, transcript").eq("client_key", slug).not("transcript", "is", null).order("recorded_at", { ascending: false }).limit(150);
  const { data: dms } = await sb.from("dm_transcripts").select("id, transcript").in("client", ALIASES[slug] || [slug]).order("submitted_at", { ascending: false }).limit(150);

  const work: Array<{ source: string; id: string; label: string; text: string }> = [];
  for (const c of calls || []) if (!mined.has(`call:${c.fathom_id}`) && (c.transcript || "").length > 400) work.push({ source: "call", id: c.fathom_id as string, label: `Sales call: ${c.title}`, text: c.transcript as string });
  for (const d of dms || []) if (!mined.has(`dm:${d.id}`) && (d.transcript || "").length > 120) work.push({ source: "dm", id: d.id as string, label: "DM conversation", text: d.transcript as string });
  const batch = work.slice(0, limit);

  const client = new Anthropic();
  let minedCount = 0, quotesAdded = 0, failed = 0;
  for (const w of batch) {
    try {
      const quotes = await extract(client, w.label, w.text);
      if (quotes.length) {
        await sb.from("content_voc").insert(quotes.map((q) => ({
          client_key: slug, bucket: q.bucket, quote: String(q.quote).slice(0, 600),
          attribution: q.attribution ? String(q.attribution).slice(0, 120) : (w.source === "call" ? "sales call" : "DM lead"),
          source: w.source, source_id: w.id,
        })));
        quotesAdded += quotes.length;
      }
      await sb.from("content_mined").insert({ source: w.source, source_id: w.id, client_key: slug, quotes: quotes.length });
      minedCount++;
    } catch { failed++; }
  }

  // Recompute the audience read from the accumulated (already-distilled) quotes — cheap.
  let audienceUpdated = false;
  const { data: allQuotes } = await sb.from("content_voc").select("bucket, quote").eq("client_key", slug).limit(200);
  if ((allQuotes || []).length >= 5) {
    try {
      const byB: Record<string, string[]> = {};
      for (const q of allQuotes!) (byB[q.bucket] ||= []).push(q.quote);
      const digest = Object.entries(byB).map(([b, qs]) => `${b.toUpperCase()}:\n${qs.slice(0, 40).map((x) => `- ${x}`).join("\n")}`).join("\n\n");
      const resp = await client.messages.create({
        model: MODEL, max_tokens: 700,
        system: "Summarize, for a fitness creator, WHO is actually showing up in their funnel and how good these leads are (strong buyers vs tire-kickers) and the 1-2 content themes that would attract more of the right people. 3-5 sentences, plain, direct. Return STRICT JSON {\"audience_summary\":\"...\",\"metrics\":{\"strong_signals\":[\"...\"],\"weak_signals\":[\"...\"]}}.",
        messages: [{ role: "user", content: digest.slice(0, 12000) }],
      });
      logAiUsage({ feature: "content-audience-read", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      const raw = (tb?.text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const a = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      await sb.from("content_audience_read").upsert({ client_key: slug, summary: a.audience_summary || null, metrics: a.metrics || null, updated_at: new Date().toISOString() }, { onConflict: "client_key" });
      audienceUpdated = true;
    } catch { /* leave prior read */ }
  }

  const remaining = work.length - batch.length;
  return NextResponse.json({ ok: true, mined: minedCount, quotes_added: quotesAdded, failed, remaining, audience_updated: audienceUpdated, note: remaining ? `Run again — ${remaining} sources left.` : "All sources mined." });
}
