import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MANUAL BUYER-CALL INTAKE.
//
// Jake's sales calls do not run through our Fathom — 448 recordings since December and not one of
// them is a call with a buyer of his. No title matcher can fix that, so the only honest path is an
// explicit one: an operator pastes a transcript and SAYS whose buyer it is.
//
// client_key is taken from the request, never inferred from the title. That is the whole point:
// title matching is what attributed six internal calls to Jake and poisoned his buyer pool. Rows
// land in fathom_calls exactly like a synced call, so mining, dossiers and buyer-voice pick them up
// with no further wiring.
//
// Session auth only. Never CRON_SECRET, never a share token — attaching buyer material is a human
// act by someone who knows which call this was.

const MANUAL_PREFIX = "manual:";

async function operator(): Promise<boolean> {
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function POST(req: NextRequest) {
  if (!(await operator())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  const transcript = String(body?.transcript || "").trim();
  const prospect = String(body?.prospect_name || "").trim();
  const recordedAt = String(body?.recorded_at || "").trim();
  const title = String(body?.title || "").trim();

  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  if (transcript.length < 200) {
    return NextResponse.json({ error: "Transcript looks too short to be a real call (need 200+ characters)" }, { status: 400 });
  }
  if (!prospect) return NextResponse.json({ error: "prospect_name is required — it is what makes this a buyer call rather than an internal one" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)) return NextResponse.json({ error: "recorded_at must be YYYY-MM-DD" }, { status: 400 });

  const sb = getServiceSupabase();
  // Deterministic id from creator + date + prospect, so re-submitting the same call updates it
  // rather than creating a duplicate buyer.
  const slugPart = prospect.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const fathomId = `${MANUAL_PREFIX}${creator}:${recordedAt}:${slugPart}`;

  const { error } = await sb.from("fathom_calls").upsert(
    {
      fathom_id: fathomId,
      title: title || `${prospect} (manual upload)`,
      client_key: creator, // EXPLICIT. Never derived from the title.
      prospect_name: prospect,
      recorded_at: new Date(`${recordedAt}T12:00:00Z`).toISOString(),
      transcript,
      raw: { source: "manual-upload", uploaded_at: new Date().toISOString() },
    },
    { onConflict: "fathom_id", ignoreDuplicates: false },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });

  return NextResponse.json({ ok: true, creator, fathom_id: fathomId, chars: transcript.length });
}

// Remove a manually-attached call. Scoped to manual: ids only — a synced Fathom recording is history
// and is never deletable through this route.
export async function DELETE(req: NextRequest) {
  if (!(await operator())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("fathom_id") || "";
  if (!id.startsWith(MANUAL_PREFIX)) {
    return NextResponse.json({ error: "Only manually-attached calls can be removed here" }, { status: 400 });
  }
  const sb = getServiceSupabase();
  // Drop anything mined from it too, so removing a call removes what it produced.
  await sb.from("content_voc").delete().eq("source_id", id);
  await sb.from("content_mined").delete().eq("source_id", id);
  const { error } = await sb.from("fathom_calls").delete().eq("fathom_id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  return NextResponse.json({ ok: true, removed: id });
}
