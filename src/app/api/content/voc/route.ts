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
const ALIASES: Record<string, string[]> = { tyson: ["tyson", "tyson_sonnek"], antwan: ["antwan", "antwan_rarcus"] };
const BUCKETS = ["avatar", "pain", "objection", "desire", "lead_quality"];

export async function POST(req: NextRequest) {
  const s = await auth();
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = (new URL(req.url).searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const sb = getServiceSupabase();

  // Sources: real prospect words (DMs), call notes/objections (buyers + non-buyers), Fathom transcripts.
  const { data: subs } = await sb.from("ads_keyword_events").select("subscriber_id").eq("client_key", slug).not("subscriber_id", "is", null);
  const subIds = [...new Set((subs || []).map((x) => x.subscriber_id))].slice(0, 5000);

  let calls: string[] = [];
  if (subIds.length) {
    const { data } = await sb.from("sales_tracker_rows")
      .select("outcome, objection, call_notes, offer, collected_revenue_cents, prospect_name, manychat_subscriber_id")
      .in("manychat_subscriber_id", subIds).order("date", { ascending: false }).limit(60);
    calls = (data || []).map((r) => {
      const won = (r.collected_revenue_cents || 0) > 0 ? "BOUGHT" : "did not buy";
      return [`[${won}] ${r.prospect_name || "prospect"}`, r.objection && `objection: ${r.objection}`, r.outcome && `outcome: ${r.outcome}`, r.call_notes && `notes: ${r.call_notes}`].filter(Boolean).join(" | ");
    }).filter((x) => x.length > 12);
  }

  const { data: dms } = await sb.from("dm_transcripts").select("transcript").in("client", ALIASES[slug] || [slug]).order("submitted_at", { ascending: false }).limit(50);
  const dmText = (dms || []).map((d) => (d.transcript || "").slice(0, 1500)).filter((x) => x.trim());

  const { data: fath } = await sb.from("fathom_calls").select("transcript, prospect_name").eq("client_key", slug).order("recorded_at", { ascending: false }).limit(20);
  const callTranscripts = (fath || []).map((f) => (f.transcript || "").slice(0, 4000)).filter((x) => x.trim());

  if (!calls.length && !dmText.length && !callTranscripts.length) {
    return NextResponse.json({ error: `No DMs, call notes, or call transcripts found for ${slug} yet.` }, { status: 422 });
  }

  const system =
    "You analyze a fitness coach's real prospect conversations to tell the creator WHO is actually showing up and what they say — so they can make content that attracts more of the RIGHT buyers. " +
    "Extract VERBATIM quotes (the prospect's actual words, lightly trimmed). Never invent quotes. Be a sharp, honest market researcher. Return STRICT JSON only.";

  const user = [
    `Creator: ${slug}.`,
    "=== CALL SUMMARIES (sheet: who bought / objections / notes) ===",
    calls.length ? calls.slice(0, 60).join("\n") : "(none)",
    "=== DM CONVERSATIONS (verbatim) ===",
    dmText.length ? dmText.join("\n---\n") : "(none)",
    "=== SALES CALL TRANSCRIPTS (verbatim) ===",
    callTranscripts.length ? callTranscripts.join("\n---\n") : "(none)",
    "",
    "Return STRICT JSON:",
    `{"audience_summary": "3-5 sentences: who is actually showing up, their lead quality (are these strong buyers or tire-kickers?), and notable behaviors/indicators",`,
    `"metrics": {"strong_signals": ["..."], "weak_signals": ["..."]},`,
    `"quotes": [{"bucket": one of ${JSON.stringify(BUCKETS)}, "quote": "verbatim words", "attribution": "who (e.g. DM lead, buyer on call, lost call)", "source": "dm|call"}]}`,
    "Give 4-8 quotes per bucket where the data supports it. avatar = quotes that reveal WHO they are; lead_quality = quotes signaling strong intent or tire-kicking. No prose outside the JSON.",
  ].join("\n");

  let parsed: { audience_summary?: string; metrics?: unknown; quotes?: Array<{ bucket: string; quote: string; attribution?: string; source?: string }> };
  try {
    const client = new Anthropic();
    const resp = await client.messages.create({ model: MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: user }] });
    logAiUsage({ feature: "content-voc", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    const raw = (tb?.text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch (e) {
    return NextResponse.json({ error: `VOC extraction failed: ${e instanceof Error ? e.message : "unknown"}` }, { status: 500 });
  }

  const batch = `${Date.now()}`;
  const rows = (parsed.quotes || [])
    .filter((q) => q && q.quote && BUCKETS.includes(q.bucket))
    .slice(0, 60)
    .map((q, i) => ({
      client_key: slug, bucket: q.bucket, quote: String(q.quote).slice(0, 600),
      attribution: q.attribution ? String(q.attribution).slice(0, 120) : null,
      source: q.source === "call" ? "call" : "dm", sort_order: i, batch_id: batch,
    }));

  // Regenerate: clear old, insert fresh, update the audience read.
  await sb.from("content_voc").delete().eq("client_key", slug);
  if (rows.length) {
    const { error } = await sb.from("content_voc").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await sb.from("content_audience_read").upsert(
    { client_key: slug, summary: parsed.audience_summary || null, metrics: parsed.metrics || null, updated_at: new Date().toISOString() },
    { onConflict: "client_key" }
  );

  return NextResponse.json({ ok: true, quotes: rows.length, sources: { calls: calls.length, dms: dmText.length, transcripts: callTranscripts.length } });
}
