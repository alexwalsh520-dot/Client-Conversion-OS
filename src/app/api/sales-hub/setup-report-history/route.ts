import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Temporary setup endpoint — creates report_history table if it doesn't exist
// DELETE THIS FILE after first successful run
export async function POST() {
  try {
    const sb = getServiceSupabase();

    // Try to create the table via raw SQL using rpc
    const { error: rpcError } = await sb.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS report_history (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          type text NOT NULL,
          subject text NOT NULL DEFAULT 'all',
          date_from text,
          date_to text,
          content text NOT NULL,
          pdf_base64 text,
          created_at timestamptz DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_report_history_created ON report_history(created_at DESC);
      `,
    });

    // If rpc doesn't exist, try inserting a test row to see if table exists
    if (rpcError) {
      // Table might already exist — test by selecting
      const { error: selectError } = await sb
        .from("report_history")
        .select("id")
        .limit(1);

      if (selectError) {
        return NextResponse.json({
          success: false,
          message: "Table does not exist and could not be created via API. Please run the SQL manually in Supabase dashboard.",
          sql: `CREATE TABLE IF NOT EXISTS report_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL,
  subject text NOT NULL DEFAULT 'all',
  date_from text,
  date_to text,
  content text NOT NULL,
  pdf_base64 text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_history_created ON report_history(created_at DESC);`,
          error: selectError.message,
        });
      }

      return NextResponse.json({ success: true, message: "Table already exists" });
    }

    return NextResponse.json({ success: true, message: "Table created successfully" });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Setup failed" },
      { status: 500 }
    );
  }
}
