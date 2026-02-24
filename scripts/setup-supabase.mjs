#!/usr/bin/env node
// Setup Supabase tables for CCOS using the SQL endpoint
// Run: node scripts/setup-supabase.mjs

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Use the PostgREST SQL endpoint via pg_net or just run the full SQL at once
// Supabase supports running SQL via the /rest/v1/rpc endpoint with a custom function
// But the easiest way is to use the Supabase REST /sql endpoint if available,
// or fall back to creating tables via the Supabase Management API

// Alternative: Use the Supabase JS client to attempt creates via a raw query
// using the pg_meta endpoint

const SQL = `
-- Table 1: coaching_feedback
CREATE TABLE IF NOT EXISTS coaching_feedback (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ,
  client_name TEXT NOT NULL,
  coach_rating INTEGER,
  workout_completion TEXT,
  missed_reason TEXT DEFAULT '',
  sleep_rating INTEGER,
  nutrition_rating INTEGER,
  energy_rating INTEGER,
  nps_score INTEGER,
  feedback TEXT DEFAULT '',
  wins TEXT DEFAULT '',
  coach_name TEXT NOT NULL,
  date DATE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_name, date, coach_name)
);

-- Table 2: onboarding_tracker
CREATE TABLE IF NOT EXISTS onboarding_tracker (
  id BIGSERIAL PRIMARY KEY,
  onboarder TEXT NOT NULL,
  client TEXT NOT NULL,
  email TEXT,
  closer TEXT,
  amount_paid NUMERIC DEFAULT 0,
  pif TEXT,
  reschedule_email_sent BOOLEAN DEFAULT FALSE,
  reminder_email BOOLEAN DEFAULT FALSE,
  reach_out_closer BOOLEAN DEFAULT FALSE,
  comments TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client, email)
);

-- Table 3: sales_closer_stats
CREATE TABLE IF NOT EXISTS sales_closer_stats (
  id BIGSERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  closer_name TEXT NOT NULL,
  calls_booked INTEGER DEFAULT 0,
  calls_taken INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  cash_collected NUMERIC DEFAULT 0,
  aov NUMERIC DEFAULT 0,
  close_rate NUMERIC DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month, closer_name)
);

-- Table 4: sales_setter_stats
CREATE TABLE IF NOT EXISTS sales_setter_stats (
  id BIGSERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  setter_name TEXT NOT NULL,
  messages_handled INTEGER DEFAULT 0,
  calls_booked INTEGER DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  source TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month, setter_name)
);

-- Table 5: ads_daily
CREATE TABLE IF NOT EXISTS ads_daily (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  date DATE NOT NULL,
  ad_spend NUMERIC DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  cpi NUMERIC DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  cpc NUMERIC DEFAULT 0,
  messages INTEGER DEFAULT 0,
  cost_per_message NUMERIC DEFAULT 0,
  calls_60_booked INTEGER DEFAULT 0,
  cost_per_60_booked NUMERIC DEFAULT 0,
  calls_60_taken INTEGER DEFAULT 0,
  show_up_60_pct NUMERIC DEFAULT 0,
  new_clients INTEGER DEFAULT 0,
  close_rate NUMERIC DEFAULT 0,
  msg_conversion_rate NUMERIC DEFAULT 0,
  contracted_revenue NUMERIC DEFAULT 0,
  collected_revenue NUMERIC DEFAULT 0,
  cost_per_client NUMERIC DEFAULT 0,
  contracted_roi NUMERIC DEFAULT 0,
  collected_roi NUMERIC DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, date)
);

-- Table 6: sync_log
CREATE TABLE IF NOT EXISTS sync_log (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  sheets_synced TEXT[],
  rows_upserted INTEGER DEFAULT 0,
  error TEXT
);

-- Enable RLS on all tables
ALTER TABLE coaching_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_closer_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_setter_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- RLS policies (idempotent using DO blocks)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'coaching_feedback') THEN
    CREATE POLICY "Allow public read" ON coaching_feedback FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'onboarding_tracker') THEN
    CREATE POLICY "Allow public read" ON onboarding_tracker FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'sales_closer_stats') THEN
    CREATE POLICY "Allow public read" ON sales_closer_stats FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'sales_setter_stats') THEN
    CREATE POLICY "Allow public read" ON sales_setter_stats FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'ads_daily') THEN
    CREATE POLICY "Allow public read" ON ads_daily FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'sync_log') THEN
    CREATE POLICY "Allow public read" ON sync_log FOR SELECT USING (true);
  END IF;
END $$;
`;

async function main() {
  console.log("🔧 Setting up Supabase tables for CCOS...\n");

  // Use the Supabase pg/query endpoint (available via service role key)
  // This is at /pg/query for the new Supabase versions
  // Or we can use the supabase-js query method

  // Try the direct PostgreSQL REST approach
  const pgUrl = `${url}/rest/v1/rpc/`;

  // Actually the best approach for Supabase free tier is to use the
  // Supabase client's internal pg endpoint
  // Let's try: POST to /pg with the SQL

  // Method: Use fetch to the Supabase SQL endpoint
  const sqlEndpoint = `${url}/pg`;

  try {
    const response = await fetch(sqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "apikey": key,
      },
      body: JSON.stringify({ query: SQL }),
    });

    if (response.ok) {
      console.log("✅ All tables created successfully!");
      return;
    }

    const text = await response.text();
    console.log(`Response ${response.status}: ${text.substring(0, 200)}`);
  } catch (e) {
    console.log(`pg endpoint not available: ${e.message}`);
  }

  // Try the /query endpoint instead
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${key}`,
        "apikey": key,
      },
    });
    console.log(`REST API status: ${response.status}`);
  } catch (e) {
    console.log(`REST API test: ${e.message}`);
  }

  console.log("\n📋 The automated approach didn't work.");
  console.log("Please create the tables manually:\n");
  console.log("1. Go to: https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new");
  console.log("2. Copy and paste the contents of supabase-setup.sql");
  console.log("3. Click 'Run'\n");
  console.log("The SQL file is at: ./supabase-setup.sql");
}

main().catch(console.error);
