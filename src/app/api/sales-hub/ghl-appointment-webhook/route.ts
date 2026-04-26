import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  displayKeyword,
  extractKeywordFromPayload,
  normalizeKeyword,
} from "@/lib/ads-tracker/normalize";

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

function readString(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function deriveClient(calendarName: string | null | undefined): string | null {
  if (!calendarName) return null;
  const upper = calendarName.toUpperCase();
  if (upper.includes("TS")) return "tyson";
  if (upper.includes("KH")) return "keith";
  return null;
}

function missingColumn(error: { message?: string } | null, column: string) {
  return Boolean(error?.message?.toLowerCase().includes(column.toLowerCase()));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const root = body as Record<string, unknown>;
    const calendar = (root.calendar || {}) as Record<string, unknown>;
    const user = (root.user || {}) as Record<string, unknown>;

    const event_type =
      readString(root, ["event_type", "eventType"]) ||
      readString(calendar, ["status", "appoinmentStatus", "appointmentStatus"]);
    const appointment_id =
      readString(root, ["appointment_id", "appointmentId"]) ||
      readString(calendar, ["appointmentId", "appointment_id"]);
    const calendar_id =
      readString(root, ["calendar_id", "calendarId"]) ||
      readString(calendar, ["id", "calendarId", "calendar_id"]);
    const calendar_name =
      readString(root, ["calendar_name", "calendarName"]) ||
      readString(calendar, ["calendarName", "name"]);
    const contact_id = readString(root, ["contact_id", "contactId", "id"]);
    const contact_name =
      readString(root, ["contact_name", "contactName", "full_name", "fullName"]) ||
      [readString(root, ["first_name", "firstName"]), readString(root, ["last_name", "lastName"])]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null;
    const contact_phone = readString(root, ["contact_phone", "contactPhone", "phone"]);
    const contact_email = readString(root, ["contact_email", "contactEmail", "email"]);
    const start_time =
      readString(root, ["start_time", "startTime"]) ||
      readString(calendar, ["startTime", "start_time"]);
    const end_time =
      readString(root, ["end_time", "endTime"]) ||
      readString(calendar, ["endTime", "end_time"]);
    const event_at =
      readString(root, ["event_at", "eventAt", "created_at", "createdAt", "date_added", "dateAdded"]) ||
      readString(calendar, ["event_at", "eventAt", "created_at", "createdAt", "date_added", "dateAdded"]) ||
      new Date().toISOString();
    const assigned_user_id =
      readString(root, ["assigned_user_id", "assignedUserId"]) ||
      readString(calendar, ["created_by_user_id", "assigned_user_id"]) ||
      readString(user, ["id", "userId"]);
    const status =
      readString(root, ["status"]) ||
      readString(calendar, ["status", "appoinmentStatus", "appointmentStatus"]);

    // Validate required fields
    if (!appointment_id) {
      console.error("[ghl-appointment-webhook] Missing appointment_id", {
        topLevelKeys: Object.keys(root),
        calendarKeys: Object.keys(calendar),
      });
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
    const keywordNormalized = normalizeKeyword(extractKeywordFromPayload(body));
    const keywordRaw = keywordNormalized ? displayKeyword(keywordNormalized) : null;

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
          keyword_raw: keywordRaw,
          keyword_normalized: keywordNormalized,
          raw_payload: body,
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

    if (client && keywordNormalized) {
      const { error: keywordError } = await supabase
        .from("ads_keyword_events")
        .upsert(
          {
            source: "ghl",
            source_event_id: `ghl:${appointment_id}`,
            event_type: "booked_call",
            client_key: client,
            keyword_raw: keywordRaw,
            keyword_normalized: keywordNormalized,
            appointment_id,
            contact_id: contact_id || null,
            contact_name: contact_name || null,
            event_at,
            raw_payload: body,
          },
          { onConflict: "appointment_id" }
        );

      if (keywordError) {
        if (missingColumn(keywordError, "source_event_id")) {
          const { error: fallbackError } = await supabase
            .from("ads_keyword_events")
            .upsert(
              {
                source: "ghl",
                event_type: "booked_call",
                client_key: client,
                keyword_raw: keywordRaw,
                keyword_normalized: keywordNormalized,
                appointment_id,
                contact_id: contact_id || null,
                contact_name: contact_name || null,
                event_at,
                raw_payload: body,
              },
              { onConflict: "appointment_id" }
            );

          if (fallbackError) {
            console.error("[ghl-appointment-webhook] keyword event fallback insert error:", fallbackError);
          }
        } else {
          console.error("[ghl-appointment-webhook] keyword event insert error:", keywordError);
        }
      }
    } else {
      const { error: exceptionError } = await supabase.from("ads_attribution_exceptions").insert({
        source: "ghl",
        reason: !client ? "missing_client" : "missing_keyword",
        client_key: client,
        keyword_normalized: keywordNormalized,
        contact_name: contact_name || null,
        appointment_id,
        payload: body,
      });

      if (exceptionError) {
        console.error("[ghl-appointment-webhook] attribution exception insert error:", exceptionError);
      }
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
