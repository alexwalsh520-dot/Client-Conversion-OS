import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { creatorKeyFromText } from "@/lib/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FATHOM = "https://api.fathom.ai/external/v1/meetings";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// Fathom transcript = [{speaker:{display_name}, text, timestamp}]. Flatten to readable text.
function flattenTranscript(t: unknown): string {
  if (!Array.isArray(t)) return "";
  const out: string[] = [];
  for (const seg of t) {
    if (typeof seg === "string") { out.push(seg); continue; }
    const s = seg as { speaker?: { display_name?: string }; text?: string };
    if (s.text) out.push(`${s.speaker?.display_name ? s.speaker.display_name + ": " : ""}${s.text}`);
  }
  return out.join("\n").slice(0, 80000);
}

// "Strategy Session - Evan Carlson <>  Austin (TS)" -> prospect "Evan Carlson"
function prospectFromTitle(title: string): string | null {
  const m = title.split(/<>|—|-\s/)[1] || title.split("-")[1];
  const cleaned = (m || "").replace(/\(.*?\)/g, "").trim();
  return cleaned || null;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.FATHOM_API_KEY?.trim();
  if (!key) return NextResponse.json({ ok: false, error: "FATHOM_API_KEY not set" }, { status: 200 });

  const url = new URL(req.url);
  const maxPages = Math.min(Number(url.searchParams.get("pages") || 8), 40);
  const sb = getServiceSupabase();

  let cursor: string | null = null;
  let stored = 0, mapped = 0, pages = 0;
  const byCreator: Record<string, number> = {};

  for (let p = 0; p < maxPages; p++) {
    const u = new URL(FATHOM);
    u.searchParams.set("include_transcript", "true");
    u.searchParams.set("include_summary", "true");
    u.searchParams.set("limit", "10");
    if (cursor) u.searchParams.set("cursor", cursor);

    const res = await fetch(u.toString(), { headers: { "X-Api-Key": key }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, error: `Fathom ${res.status}: ${(await res.text()).slice(0, 200)}`, stored }, { status: 200 });
    const json = await res.json();
    const items = json.items || [];
    pages++;

    const rows = items.map((it: Record<string, unknown>) => {
      const title = String(it.title || it.meeting_title || "");
      const creator = creatorKeyFromText(title); // (TS)->tyson, (AR)->antwan via matchTokens
      if (creator) { mapped++; byCreator[creator] = (byCreator[creator] || 0) + 1; }
      const summary = it.default_summary;
      return {
        fathom_id: String(it.recording_id || ""),
        title,
        recorded_at: (it.recording_start_time || it.scheduled_start_time || it.created_at) as string | null,
        attendees: (it.calendar_invitees as unknown) ?? null,
        prospect_name: prospectFromTitle(title),
        client_key: creator,
        transcript: flattenTranscript(it.transcript),
        summary: typeof summary === "string" ? summary : summary ? JSON.stringify(summary).slice(0, 8000) : null,
        raw: { ...it, transcript: undefined }, // keep metadata, drop the bulky transcript copy
      };
    }).filter((r: { fathom_id: string }) => r.fathom_id);

    if (rows.length) {
      const { error } = await sb.from("fathom_calls").upsert(rows, { onConflict: "fathom_id", ignoreDuplicates: false });
      if (error) return NextResponse.json({ ok: false, error: error.message, stored }, { status: 200 });
      stored += rows.length;
    }
    cursor = json.next_cursor || null;
    if (!cursor) break;
  }

  return NextResponse.json({ ok: true, stored, mapped_to_creator: mapped, byCreator, pages, more: !!cursor, cursor });
}
