import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

const SETTER_CLIENT_MAP: Record<string, string> = {
  amara: "tyson",
  kelechi: "tyson",
  gideon: "keith",
  debbie: "tyson",
};

// POST — setter submits a transcript (public, no auth)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { setterName, transcript } = body;

    if (!setterName || !transcript?.trim()) {
      return NextResponse.json(
        { error: "setterName and transcript are required" },
        { status: 400 }
      );
    }

    const client = SETTER_CLIENT_MAP[setterName.toLowerCase()];
    if (!client) {
      return NextResponse.json(
        { error: `Unknown setter: ${setterName}` },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("dm_transcripts")
      .insert({
        setter_name: setterName,
        client,
        transcript: transcript.trim(),
      })
      .select("id, submitted_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, id: data.id, submittedAt: data.submitted_at });
  } catch (err) {
    console.error("Transcript save error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save transcript" },
      { status: 500 }
    );
  }
}

// GET — fetch transcripts for dashboard (behind auth middleware)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const client = searchParams.get("client");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const setter = searchParams.get("setter");

    if (!client) {
      return NextResponse.json({ error: "client param required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    let query = supabase
      .from("dm_transcripts")
      .select("id, setter_name, client, transcript, submitted_at, reviewed, review_result, reviewed_at")
      .eq("client", client)
      .order("submitted_at", { ascending: false });

    if (dateFrom) {
      query = query.gte("submitted_at", `${dateFrom}T00:00:00Z`);
    }
    if (dateTo) {
      query = query.lte("submitted_at", `${dateTo}T23:59:59Z`);
    }
    if (setter) {
      query = query.eq("setter_name", setter);
    }

    const { data, error } = await query.limit(100);
    if (error) throw error;

    return NextResponse.json({ transcripts: data ?? [] });
  } catch (err) {
    console.error("Transcript fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch transcripts" },
      { status: 500 }
    );
  }
}

// PATCH — save review result for a transcript
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, reviewResult } = body;

    if (!id || !reviewResult) {
      return NextResponse.json(
        { error: "id and reviewResult are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    const { error } = await supabase
      .from("dm_transcripts")
      .update({
        reviewed: true,
        review_result: reviewResult,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Transcript update error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update transcript" },
      { status: 500 }
    );
  }
}
