import { NextResponse } from "next/server";

/**
 * Auto-creates required Supabase tables using the REST SQL endpoint.
 * POST /api/setup/init-tables
 */

const TABLES_SQL = `
-- Manychat tag events table
CREATE TABLE IF NOT EXISTS manychat_tag_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  subscriber_name TEXT,
  tag_name TEXT NOT NULL,
  client TEXT NOT NULL,
  setter_name TEXT,
  event_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manychat_events_client_date
  ON manychat_tag_events (client, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_manychat_events_tag
  ON manychat_tag_events (tag_name, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_manychat_events_setter
  ON manychat_tag_events (setter_name, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_manychat_events_lookup
  ON manychat_tag_events (client, event_at, tag_name, setter_name);

ALTER TABLE manychat_tag_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'manychat_tag_events' AND policyname = 'Allow anon read') THEN
    CREATE POLICY "Allow anon read" ON manychat_tag_events FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'manychat_tag_events' AND policyname = 'Allow service role insert') THEN
    CREATE POLICY "Allow service role insert" ON manychat_tag_events FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Manychat contact links table
CREATE TABLE IF NOT EXISTS manychat_contact_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  ghl_contact_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_manychat_contact_links_client_subscriber
  ON manychat_contact_links (client, subscriber_id);

ALTER TABLE manychat_contact_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'manychat_contact_links' AND policyname = 'Allow service role manage manychat contact links') THEN
    CREATE POLICY "Allow service role manage manychat contact links" ON manychat_contact_links USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Report history table
CREATE TABLE IF NOT EXISTS report_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  subject TEXT,
  date_from TEXT,
  date_to TEXT,
  content TEXT,
  pdf_base64 TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE report_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'report_history' AND policyname = 'Allow anon read') THEN
    CREATE POLICY "Allow anon read" ON report_history FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'report_history' AND policyname = 'Allow service role insert') THEN
    CREATE POLICY "Allow service role insert" ON report_history FOR INSERT WITH CHECK (true);
  END IF;
END $$;
`;

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const results: Record<string, unknown> = {};

  // Method 1: Try the Supabase SQL endpoint (pg-meta)
  try {
    const sqlUrl = `${supabaseUrl}/rest/v1/rpc/`;
    // First try executing via a raw SQL RPC if available
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: TABLES_SQL }),
    });

    if (rpcRes.ok) {
      results.method = "rpc_exec_sql";
      results.status = "success";
      return NextResponse.json(results);
    }
    results.rpc_status = rpcRes.status;
  } catch (err) {
    results.rpc_error = String(err);
  }

  // Method 2: Try the pg endpoint directly
  try {
    const pgRes = await fetch(`${supabaseUrl}/pg`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: TABLES_SQL }),
    });

    if (pgRes.ok) {
      results.method = "pg_endpoint";
      results.status = "success";
      return NextResponse.json(results);
    }
    results.pg_status = pgRes.status;
  } catch (err) {
    results.pg_error = String(err);
  }

  // Method 3: Try individual table creation via PostgREST
  // This won't work for CREATE TABLE but let's verify tables exist
  try {
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/manychat_tag_events?limit=0`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );

    if (checkRes.ok) {
      results.manychat_tag_events = "EXISTS";
    } else if (checkRes.status === 404) {
      results.manychat_tag_events = "DOES NOT EXIST — run the SQL manually";
      results.sql = TABLES_SQL;
    } else {
      results.manychat_tag_events = `CHECK FAILED (${checkRes.status})`;
    }
  } catch (err) {
    results.check_error = String(err);
  }

  // Check report_history
  try {
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/report_history?limit=0`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    results.report_history = checkRes.ok ? "EXISTS" : `MISSING (${checkRes.status})`;
  } catch {
    results.report_history = "CHECK FAILED";
  }

  results.note = "Auto-creation failed. Copy the SQL from the response and run it in Supabase SQL Editor.";
  return NextResponse.json(results);
}

export async function GET() {
  return NextResponse.json({
    description: "POST to this endpoint to auto-create required database tables",
    tables: ["manychat_tag_events", "manychat_contact_links", "report_history"],
  });
}
