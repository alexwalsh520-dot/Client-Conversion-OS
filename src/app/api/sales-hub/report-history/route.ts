import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

/* ── GET — list report history ───────────────────────────────────── */

export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

    let query = sb
      .from("report_history")
      .select("id, type, subject, date_from, date_to, content, pdf_base64, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (type && type !== "all") {
      query = query.eq("type", type);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reports: data || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch report history" },
      { status: 500 }
    );
  }
}

/* ── POST — save a report ────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const body = await req.json();

    const { type, subject, date_from, date_to, content, pdf_base64 } = body as {
      type: string;
      subject?: string;
      date_from?: string;
      date_to?: string;
      content: string;
      pdf_base64?: string;
    };

    if (!type || !content) {
      return NextResponse.json({ error: "type and content are required" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("report_history")
      .insert({
        type,
        subject: subject || "all",
        date_from: date_from || null,
        date_to: date_to || null,
        content,
        pdf_base64: pdf_base64 || null,
      })
      .select("id, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data.id, created_at: data.created_at });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save report" },
      { status: 500 }
    );
  }
}
