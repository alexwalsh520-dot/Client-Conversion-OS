-- CCOS Supabase Schema Setup
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ============================================================
-- Table 1: coaching_feedback (from Weekly Survey Google Sheet)
-- ============================================================
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

-- ============================================================
-- Table 2: onboarding_tracker (from Onboarding Google Sheet)
-- ============================================================
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

-- ============================================================
-- Table 3: sales_closer_stats (from Sales Tracker - closer section)
-- ============================================================
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

-- ============================================================
-- Table 4: sales_setter_stats (from Sales Tracker - setter section)
-- ============================================================
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

-- ============================================================
-- Table 5: ads_daily (from Tyson + Keith Ads Tracker sheets)
-- ============================================================
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

-- ============================================================
-- Table 6: sync_log (tracks sync operations)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_log (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  sheets_synced TEXT[],
  rows_upserted INTEGER DEFAULT 0,
  error TEXT
);

-- ============================================================
-- Row Level Security
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE coaching_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_closer_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_setter_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- Allow anon key to read all tables
CREATE POLICY "Allow public read" ON coaching_feedback FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON onboarding_tracker FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON sales_closer_stats FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON sales_setter_stats FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON ads_daily FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON sync_log FOR SELECT USING (true);

-- Service role key bypasses RLS for writes (no write policies needed for anon)

-- ============================================================
-- Done! Tables are ready for the CCOS sync pipeline.
-- ============================================================
