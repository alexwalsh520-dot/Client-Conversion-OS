import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientName = searchParams.get("name");

    if (!clientName) {
      return NextResponse.json({ error: "Client name required" }, { status: 400 });
    }

    const db = getServiceSupabase();

    // Get all check-in notes for this client with the EOD report date and coach
    const { data: checkins, error } = await db
      .from("eod_client_checkins")
      .select("notes, checked_in, eod_id")
      .eq("client_name", clientName)
      .neq("notes", "");

    if (error) throw error;
    if (!checkins?.length) return NextResponse.json({ notes: [] });

    // Fetch the associated EOD reports for dates and coach names
    const eodIds = [...new Set(checkins.map((c) => c.eod_id))];
    const { data: reports } = await db
      .from("eod_reports")
      .select("id, date, submitted_by")
      .in("id", eodIds);

    const reportMap = new Map(
      (reports || []).map((r) => [r.id, { date: r.date, coachName: r.submitted_by }])
    );

    const notes = checkins
      .map((c) => {
        const report = reportMap.get(c.eod_id);
        return {
          date: report?.date || "",
          coachName: report?.coachName || "",
          notes: c.notes,
          checkedIn: c.checked_in,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ notes });
  } catch (err) {
    console.error("Client notes error:", err);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}
