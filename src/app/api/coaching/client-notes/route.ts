import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { auth } from "@/auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientName = searchParams.get("name");

    if (!clientName) {
      return NextResponse.json({ error: "Client name required" }, { status: 400 });
    }

    const db = getServiceSupabase();

    // Get EOD check-in notes
    const { data: checkins, error } = await db
      .from("eod_client_checkins")
      .select("notes, checked_in, eod_id")
      .eq("client_name", clientName)
      .neq("notes", "");

    if (error) throw error;

    // Fetch the associated EOD reports for dates and coach names
    const eodIds = [...new Set((checkins || []).map((c) => c.eod_id))];
    let reportMap = new Map<number, { date: string; coachName: string }>();
    if (eodIds.length > 0) {
      const { data: reports } = await db
        .from("eod_reports")
        .select("id, date, submitted_by")
        .in("id", eodIds);

      reportMap = new Map(
        (reports || []).map((r) => [r.id, { date: r.date, coachName: r.submitted_by }])
      );
    }

    const eodNotes = (checkins || []).map((c) => {
      const report = reportMap.get(c.eod_id);
      return {
        date: report?.date || "",
        coachName: report?.coachName || "",
        notes: c.notes,
        checkedIn: c.checked_in,
        source: "eod" as const,
      };
    });

    // Get manual coach notes
    const { data: manualNotes } = await db
      .from("client_notes")
      .select("*")
      .eq("client_name", clientName)
      .order("created_at", { ascending: false });

    const manual = (manualNotes || []).map((n) => ({
      id: n.id,
      date: n.created_at ? new Date(n.created_at).toISOString().split("T")[0] : "",
      coachName: n.coach_name,
      notes: n.note,
      checkedIn: false,
      source: "manual" as const,
    }));

    // Merge and sort by date descending
    const allNotes = [...eodNotes, ...manual].sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ notes: allNotes });
  } catch (err) {
    console.error("Client notes error:", err);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { clientName, note } = body;

    if (!clientName || !note) {
      return NextResponse.json({ error: "clientName and note required" }, { status: 400 });
    }

    const db = getServiceSupabase();
    const { data, error } = await db
      .from("client_notes")
      .insert({
        client_name: clientName,
        coach_name: session.user.name || session.user.email || "Unknown",
        note,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Add note error:", err);
    return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const db = getServiceSupabase();
    const { error } = await db.from("client_notes").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete note error:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, note } = body;
    if (!id || !note) return NextResponse.json({ error: "id and note required" }, { status: 400 });

    const db = getServiceSupabase();
    const { error } = await db.from("client_notes").update({ note }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Update note error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
