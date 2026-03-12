import { NextResponse } from "next/server";

// Temporary setup endpoint — creates report_history table via direct PostgreSQL REST API
// DELETE THIS FILE after first successful run
export async function POST() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { success: false, error: "Supabase env vars not configured" },
        { status: 500 }
      );
    }

    // Use Supabase's raw SQL endpoint (PostgREST doesn't support DDL,
    // but the service role key lets us use the pg-meta REST API)
    // Try the /rest/v1/rpc approach with a simple function first

    // Approach: Use the Supabase SQL API endpoint directly
    // This hits the pg-meta API at /pg/query
    const sqlStatements = [
      `CREATE TABLE IF NOT EXISTS report_history (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        type text NOT NULL,
        subject text NOT NULL DEFAULT 'all',
        date_from text,
        date_to text,
        content text NOT NULL,
        pdf_base64 text,
        created_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_report_history_created ON report_history(created_at DESC)`,
    ];

    // Extract the project ref from the URL (e.g., https://abcdef.supabase.co -> abcdef)
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

    // Try the Supabase Management API SQL endpoint
    const mgmtRes = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sqlStatements.join(";\n") + ";" }),
      }
    );

    if (mgmtRes.ok) {
      return NextResponse.json({ success: true, message: "Table created via Management API" });
    }

    // Fallback: try using PostgREST's /rpc endpoint to call a custom function
    // This won't work if the function doesn't exist, but worth trying
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ sql: sqlStatements.join(";\n") + ";" }),
    });

    if (rpcRes.ok) {
      return NextResponse.json({ success: true, message: "Table created via RPC" });
    }

    // Last resort: try to use the pg endpoint directly
    // Some Supabase instances expose /pg/query
    const pgRes = await fetch(`${supabaseUrl}/pg/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sqlStatements.join(";\n") + ";" }),
    });

    if (pgRes.ok) {
      return NextResponse.json({ success: true, message: "Table created via pg endpoint" });
    }

    // If all else fails, return the SQL for manual execution
    const mgmtBody = await mgmtRes.text().catch(() => "no body");

    return NextResponse.json({
      success: false,
      message: "Could not auto-create table. Returning SQL for manual execution.",
      projectRef,
      mgmtStatus: mgmtRes.status,
      mgmtBody: mgmtBody.substring(0, 500),
      sql: sqlStatements.join(";\n") + ";",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Setup failed" },
      { status: 500 }
    );
  }
}

// Also support GET for easy browser testing
export async function GET() {
  return POST();
}
