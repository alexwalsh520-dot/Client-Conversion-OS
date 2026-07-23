import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { externalKeyOk } from "@/lib/external/auth";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import { getCurrentPlaybook } from "@/lib/buyer-dna/playbook";
import { getMessagingDoc } from "@/lib/buyer-dna/messaging-doc";
import { redactMoneyDeep } from "@/lib/redact-money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything the external content worker needs to write a creator's carousels + playbook, in one pull:
// recent calls, recent inbound DMs, the creator's own messaging doc, the locked ICP, the current
// playbook, and the last 14 days of carousel topics/openers (so the worker doesn't repeat itself).
// Auth: X-External-Key ONLY. Scoped strictly to the requested creator, server-side.
//
// House redaction: research/ICP text is passed through redactMoneyDeep (no concrete dollar figures
// leave the building); raw call transcripts pass as stored, matching internal generation.

// The DM store keys conversations by a "<first>_<last>" client slug, not the registry key.
const DM_CLIENTS: Record<string, string[]> = {
  tyson: ["tyson", "tyson_sonnek"],
  jake: ["jake", "jake_divljak"],
  antwan: ["antwan", "antwan_rarcus"],
};

const CALL_CAP = 15;
const DM_CAP = 500;

export async function GET(req: NextRequest) {
  if (!externalKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const creator = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown or inactive creator" }, { status: 400 });
  }
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const sb = getServiceSupabase();
  const dmClients = DM_CLIENTS[creator] || [creator];

  const [callsRes, dmsRes, doc, icpRow, playbookRow, carouselsRes] = await Promise.all([
    sb.from("fathom_calls")
      .select("title, recorded_at, transcript")
      .eq("client_key", creator)
      .gte("recorded_at", sinceIso)
      .order("recorded_at", { ascending: false })
      .limit(CALL_CAP),
    sb.from("dm_conversation_messages")
      .select("body, sent_at, direction")
      .in("client", dmClients)
      .eq("direction", "inbound")
      .gte("sent_at", sinceIso)
      .order("sent_at", { ascending: false })
      .limit(DM_CAP),
    getMessagingDoc(sb, creator),
    getCurrentIcp(sb, creator),
    getCurrentPlaybook(sb, creator),
    sb.from("content_carousels")
      .select("for_date, topic, slides")
      .eq("client_key", creator)
      .gte("for_date", since14)
      .order("for_date", { ascending: false }),
  ]);

  const calls = (callsRes.data || []).map((c) => ({
    title: (c as { title: string | null }).title,
    date: (c as { recorded_at: string | null }).recorded_at,
    transcript: (c as { transcript: string | null }).transcript, // raw, as stored
  }));

  const inbound_dms = (dmsRes.data || [])
    .map((m) => ({ text: (m as { body: string | null }).body || "", at: (m as { sent_at: string | null }).sent_at }))
    .filter((m) => m.text.trim());

  const recent_carousels = (carouselsRes.data || []).map((r) => {
    const slides = (r as { slides: { text?: string }[] | null }).slides;
    const opener = Array.isArray(slides) && slides[0] && typeof slides[0].text === "string" ? slides[0].text : "";
    return { for_date: (r as { for_date: string }).for_date, topic: (r as { topic: string | null }).topic, slide1: opener };
  });

  // Redact concrete money from the ICP (research-grounded, so it can quote prices/finances).
  const icp = icpRow ? redactMoneyDeep((icpRow as { icp: unknown }).icp) : null;
  const icp_version = icpRow ? (icpRow as { version: number }).version : null;

  return NextResponse.json({
    creator,
    generated_at: new Date().toISOString(),
    window_days: days,
    messaging_doc: doc ? { version: doc.version, title: doc.title, text: doc.doc_text } : null,
    icp,
    icp_version,
    playbook: playbookRow ? (playbookRow as { playbook: unknown }).playbook : null,
    playbook_version: playbookRow ? (playbookRow as { version: number }).version : null,
    calls,
    inbound_dms,
    recent_carousels, // last 14 days topics + slide-1 openers — novelty guard for the worker
  });
}
