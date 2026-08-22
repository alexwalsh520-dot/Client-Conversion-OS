import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { postToSlack, getSalesManagerChannel } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// THE ALARM (build 2 of the approved attribution sprint, 8/22).
// Once a day: sales-calendar bookings created yesterday that still have no
// person attached go to #a-sales-manager (Alex + Matt only, per Alex's
// standing rule — never the whole team). Silent when there is nothing to
// report. Read-only: changes no data.

function etDayRange(daysAgo: number): { fromIso: string; toIso: string; label: string } {
  const now = new Date();
  const etNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const day = new Date(`${etNow}T00:00:00-04:00`);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  const from = new Date(day);
  const to = new Date(day);
  to.setUTCDate(to.getUTCDate() + 1);
  return { fromIso: from.toISOString(), toIso: to.toISOString(), label: from.toISOString().slice(0, 10) };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const { fromIso, toIso, label } = etDayRange(1);

  const { data: cals, error: calErr } = await db
    .schema("warehouse").from("registry_calendars")
    .select("calendar_id, calendar_name")
    .eq("lane", "dm_sales")
    .not("calendar_id", "is", null);
  if (calErr) return NextResponse.json({ error: calErr.message }, { status: 500 });
  const calIds = (cals || []).map((c) => c.calendar_id as string);
  const calNames = new Map((cals || []).map((c) => [c.calendar_id as string, c.calendar_name as string]));
  if (calIds.length === 0) return NextResponse.json({ ok: true, note: "no dm_sales calendars registered" });

  const { data: bookings, error: bookErr } = await db
    .from("ghl_appointments")
    .select("contact_id, contact_name, calendar_id, start_time")
    .in("calendar_id", calIds)
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  if (bookErr) return NextResponse.json({ error: bookErr.message }, { status: 500 });

  const rows = bookings || [];
  const contactIds = [...new Set(rows.map((b) => b.contact_id).filter(Boolean))] as string[];
  const linked = new Set<string>();
  if (contactIds.length > 0) {
    const { data: links } = await db
      .from("manychat_contact_links")
      .select("ghl_contact_id")
      .in("ghl_contact_id", contactIds);
    for (const l of links || []) linked.add(l.ghl_contact_id as string);
  }

  const missing = rows.filter((b) => b.contact_id && !linked.has(b.contact_id as string));

  // Second check (Alex + Matt agreement, 8/22): a taken sales call with no
  // recording link pasted in the tracker is an evidence gap. The pasted
  // Fathom link is the show-up proof while recordings stay on personal
  // accounts, so the gap list goes to #a-sales-manager beside the
  // identity list. Read-only, names only, no nagging of setters.
  const { data: takenRows } = await db
    .from("sales_tracker_rows")
    .select("prospect_name, closer, recording_link, date")
    .eq("call_taken_status", "yes")
    .gte("date", label)
    .lt("date", new Date(new Date(`${label}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10));
  const noLink = (takenRows || []).filter(
    (r) => !r.recording_link || !String(r.recording_link).trim(),
  );

  const summary = {
    ok: true,
    day: label,
    bookings: rows.length,
    missingIdentity: missing.length,
    takenCalls: (takenRows || []).length,
    takenWithoutRecordingLink: noLink.length,
  };
  if (missing.length === 0 && noLink.length === 0) return NextResponse.json(summary);

  const parts: string[] = [];
  if (missing.length > 0) {
    const lines = missing.slice(0, 15).map((b) => {
      const cal = calNames.get(b.calendar_id as string) || b.calendar_id;
      return `• ${b.contact_name || "Unnamed"} (${cal})`;
    });
    parts.push(
      `${missing.length} of ${rows.length} sales-calendar bookings have no person attached yet. They are on the review list.\n${lines.join("\n")}` +
        (missing.length > 15 ? `\n…and ${missing.length - 15} more` : ""),
    );
  }
  if (noLink.length > 0) {
    const lines = noLink.slice(0, 15).map(
      (r) => `• ${r.prospect_name || "Unnamed"}${r.closer ? ` (${r.closer})` : ""}`,
    );
    parts.push(
      `${noLink.length} of ${(takenRows || []).length} taken calls have no recording link pasted:\n${lines.join("\n")}`,
    );
  }
  const msg = `Attribution alarm for ${label}:\n${parts.join("\n\n")}`;

  try {
    await postToSlack(getSalesManagerChannel(), msg);
    return NextResponse.json({ ...summary, slacked: true });
  } catch (err) {
    return NextResponse.json({ ...summary, slacked: false, slackError: String(err) }, { status: 500 });
  }
}
