import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * GHL Appointment Webhook — receives appointment events from GoHighLevel workflows.
 *
 * GHL workflow fires on appointment booked, rescheduled, cancelled, etc.
 * We upsert each event into Supabase so we can query today's schedule and history.
 */

const CLOSER_MAP: Record<string, string> = {
  Rvct5f3Mr1IY4yT575Lj: "WILL",
  BF7iGUWE21SefwMNkzo5: "BROZ",
  sXMfoQQdUn31JmQCPDJx: "AUSTIN",
};

const VALID_EVENTS = ["booked", "rescheduled", "cancelled", "noshow", "confirmed"];

function deriveClient(calendarName: string | null | undefined): string | null {
  if (!calendarName) return null;
  const upper = calendarName.toUpperCase();
  if (upper.includes("TS")) return "tyson";
  if (upper.includes("KH")) return "keith";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      event_type,
      appointment_id,
      calendar_id,
      calendar_name,
      contact_id,
      contact_name,
      contact_phone,
      contact_email,
      start_time,
      end_time,
      assigned_user_id,
      status,
    } = body;

    // Validate required fields
    if (!appointment_id) {
      return NextResponse.json(
        { error: "Missing required field: appointment_id" },
        { status: 400 }
      );
    }

    if (event_type && !VALID_EVENTS.includes(event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type: ${event_type}. Must be one of: ${VALID_EVENTS.join(", ")}` },
        { status: 400 }
      );
    }

    const closer_name = assigned_user_id ? (CLOSER_MAP[assigned_user_id] || null) : null;
    const client = deriveClient(calendar_name);

    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("ghl_appointments")
      .upsert(
        {
          appointment_id,
          calendar_id: calendar_id || null,
          calendar_name: calendar_name || null,
          contact_id: contact_id || null,
          contact_name: contact_name || null,
          contact_phone: contact_phone || null,
          contact_email: contact_email || null,
          start_time: start_time || null,
          end_time: end_time || null,
          assigned_user_id: assigned_user_id || null,
          closer_name,
          status: status || null,
          event_type: event_type || null,
          client,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "appointment_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[ghl-appointment-webhook] Supabase upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, appointment: data });
  } catch (err) {
    console.error("[ghl-appointment-webhook] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sales-hub/ghl-appointment-webhook?date=2026-03-29&closer=WILL
 *
 * Returns appointments for the given date, optionally filtered by closer name.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const closer = searchParams.get("closer");

    if (!date) {
      return NextResponse.json(
        { error: "Missing required query param: date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const supabase = getServiceSupabase();

    let query = supabase
      .from("ghl_appointments")
      .select("*")
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd)
      .order("start_time", { ascending: true });

    if (closer) {
      query = query.eq("closer_name", closer.toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      console.error("[ghl-appointment-webhook] Supabase query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ appointments: data });
  } catch (err) {
    console.error("[ghl-appointment-webhook] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
