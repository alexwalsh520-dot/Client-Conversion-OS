import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// DIAL OUTCOMES (build 3 lane 1, approved attribution sprint, 8/22).
// Daily pull of recent outbound dials from GoHighLevel: duration, status,
// and voicemail-vs-human read from the call transcript. Turns "did they
// pick up" into a stored fact. Writes ONLY to ghl_dial_outcomes.

const GHL_BASE = "https://services.leadconnectorhq.com";
const WINDOW_HOURS = 36;
const VOICEMAIL_RE =
  /leave a message|not available|voicemail|after the tone|mailbox|is not able to take your call|record your message/i;

function ghlHeaders(version: string): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GHL_ATTRIBUTION_API_KEY || ""}`,
    Version: version,
  };
}

async function ghlGet(path: string, version: string): Promise<unknown | null> {
  const res = await fetch(`${GHL_BASE}${path}`, { headers: ghlHeaders(version) });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

type CallRow = {
  message_id: string;
  conversation_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  direction: string | null;
  call_status: string | null;
  duration_sec: number | null;
  called_at: string | null;
  voicemail: boolean | null;
  transcript_snippet: string | null;
  raw: unknown;
};

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loc = process.env.GHL_LOCATION_ID || "";
  if (!loc || !process.env.GHL_ATTRIBUTION_API_KEY) {
    return NextResponse.json({ error: "missing GHL env" }, { status: 500 });
  }

  const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
  const search = (await ghlGet(
    `/conversations/search?locationId=${loc}&limit=100&lastMessageType=TYPE_CALL`,
    "2021-04-15",
  )) as { conversations?: Array<Record<string, unknown>> } | null;

  const convs = (search?.conversations || []).filter(
    (c) => Number(c.lastMessageDate) >= cutoff,
  );

  const rows: CallRow[] = [];
  let transcriptsChecked = 0;

  for (const conv of convs.slice(0, 60)) {
    const convId = String(conv.id);
    const msgRes = (await ghlGet(`/conversations/${convId}/messages?limit=20`, "2021-04-15")) as
      | { messages?: { messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> }
      | null;
    const inner = msgRes?.messages;
    const msgs: Array<Record<string, unknown>> = Array.isArray(inner)
      ? inner
      : ((inner as { messages?: Array<Record<string, unknown>> })?.messages ?? []);

    for (const m of msgs) {
      if (m.messageType !== "TYPE_CALL") continue;
      const added = Date.parse(String(m.dateAdded || ""));
      if (!Number.isFinite(added) || added < cutoff) continue;
      const meta = (m.meta as { call?: { duration?: number; status?: string } }) || {};

      let voicemail: boolean | null = null;
      let snippet: string | null = null;
      if (transcriptsChecked < 150) {
        transcriptsChecked += 1;
        const tr = (await ghlGet(
          `/conversations/locations/${loc}/messages/${String(m.id)}/transcription`,
          "2021-04-15",
        )) as Array<{ transcript?: string }> | null;
        if (Array.isArray(tr) && tr.length > 0) {
          const text = tr.map((s) => s.transcript || "").join(" ").trim();
          snippet = text.slice(0, 400) || null;
          voicemail = VOICEMAIL_RE.test(text);
        }
      }

      rows.push({
        message_id: String(m.id),
        conversation_id: convId,
        contact_id: (conv.contactId as string) || null,
        contact_name: (conv.contactName as string) || (conv.fullName as string) || null,
        contact_email: (conv.email as string) || null,
        contact_phone: (conv.phone as string) || null,
        direction: (m.direction as string) || null,
        call_status: meta.call?.status || (m.status as string) || null,
        duration_sec: typeof meta.call?.duration === "number" ? meta.call.duration : null,
        called_at: Number.isFinite(added) ? new Date(added).toISOString() : null,
        voicemail,
        transcript_snippet: snippet,
        raw: { meta: m.meta ?? null, tags: conv.tags ?? null },
      });
    }
  }

  let stored = 0;
  if (rows.length > 0) {
    const db = getServiceSupabase();
    const { error } = await db
      .from("ghl_dial_outcomes")
      .upsert(rows, { onConflict: "message_id" });
    if (error) return NextResponse.json({ error: error.message, found: rows.length }, { status: 500 });
    stored = rows.length;
  }

  return NextResponse.json({
    ok: true,
    conversationsScanned: convs.length,
    callsFound: rows.length,
    stored,
    voicemails: rows.filter((r) => r.voicemail === true).length,
    humans: rows.filter((r) => r.voicemail === false).length,
  });
}
