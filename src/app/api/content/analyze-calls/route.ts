import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";

// The fixed scoring paradigm (compute-once per call). Factors + max points sum to 100.
const SYSTEM = `You analyze a fitness-coaching sales call transcript against a FIXED framework and return structured JSON. Score consistently and ground every score in a VERBATIM quote + its timestamp. Never invent quotes.

LEAD QUALITY = sum of 7 factors (0-100):
- authority (max 15): is the prospect the sole decision-maker who can transact now?
- desire_clarity (max 15): specific, emotionally-anchored goal + timeline?
- icp_fit (max 10): match to the coach's ideal client (goal-driven, right life stage, can execute)?
- pain_severity (max 15): how acute + quantified + enduring is the pain?
- self_efficacy (max 15): does the prospect believe THEY can execute (ownership language, past wins)?
- solution_belief (max 15): do they trust this coach + offer (not skeptical, not asking for proof)?
- urgency (max 15): real deadline/trigger + momentum language?
BAND: 85+ = exceptional, 70-84 = strong, 50-69 = moderate, <50 = weak.

BUYING SIGNALS: verbatim quotes that show buyer mentality, each tagged one of: ownership, commitment, internal_locus, urgency, identity.
OBJECTIONS: each real objection — {type (price|spouse|time|trust|fit|logistics|none), timestamp, quote, handling (what the rep did), resolved (true/false)}. If none, return [].
REP_PERFORMANCE: {did_well:[short bullets], improve:[short bullets]}.
Return STRICT JSON only, no prose outside it.`;

interface Analysis {
  lead_quality_score: number; band: string; outcome: string;
  factors: Record<string, { score: number; max: number; quote: string; timestamp: string; reasoning: string }>;
  buying_signals: Array<{ quote: string; tag: string; note?: string }>;
  objections: Array<{ type: string; timestamp: string; quote: string; handling: string; resolved: boolean }>;
  rep_performance: { did_well: string[]; improve: string[] };
  verdict: string; summary: string;
}

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const creator = (url.searchParams.get("creator") || "").toLowerCase() || null;
  const limit = Math.min(Number(url.searchParams.get("limit") || 6), 12);

  const sb = getServiceSupabase();
  // Calls with a transcript but no analysis yet (compute-once).
  const { data: analyzed } = await sb.from("call_analysis").select("fathom_call_id");
  const done = new Set((analyzed || []).map((a) => a.fathom_call_id));
  let q = sb.from("fathom_calls").select("fathom_id, client_key, prospect_name, title, transcript")
    .not("transcript", "is", null).order("recorded_at", { ascending: false }).limit(200);
  if (creator) q = q.eq("client_key", creator);
  const { data: calls } = await q;
  const todo = (calls || []).filter((c) => !done.has(c.fathom_id) && (c.transcript || "").length > 400).slice(0, limit);

  if (!todo.length) return NextResponse.json({ ok: true, analyzed: 0, note: "All caught up." });

  const client = new Anthropic();
  let count = 0, failed = 0;
  for (const c of todo) {
    try {
      const resp = await client.messages.create({
        model: MODEL, max_tokens: 2500, system: SYSTEM,
        messages: [{ role: "user", content: `Call: ${c.title}\nProspect: ${c.prospect_name || "unknown"}\n\nTRANSCRIPT:\n${(c.transcript || "").slice(0, 70000)}` }],
      });
      logAiUsage({ feature: "call-analysis", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      const raw = (tb?.text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const a = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Analysis;
      await sb.from("call_analysis").upsert({
        fathom_call_id: c.fathom_id, client_key: c.client_key, prospect_name: c.prospect_name,
        outcome: a.outcome || null, lead_quality_score: a.lead_quality_score ?? null, band: a.band || null,
        factors: a.factors || null, buying_signals: a.buying_signals || null, objections: a.objections || null,
        rep_performance: a.rep_performance || null, verdict: a.verdict || null, summary: a.summary || null,
        model: MODEL, analyzed_at: new Date().toISOString(),
      }, { onConflict: "fathom_call_id" });
      count++;
    } catch { failed++; }
  }
  return NextResponse.json({ ok: true, analyzed: count, failed, remaining: (calls || []).filter((c) => !done.has(c.fathom_id)).length - count });
}
