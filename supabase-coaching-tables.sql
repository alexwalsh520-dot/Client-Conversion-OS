-- CCOS Coaching Section - Additional Tables
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ============================================================
-- Table 1: clients (master client roster)
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  coach_name TEXT,
  program TEXT,
  offer TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'active',
  payment_platform TEXT,
  sales_fathom_link TEXT,
  onboarding_fathom_link TEXT,
  amount_paid NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table 2: coach_milestones (trust pilot, video, retention, referral)
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_milestones (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  coach_name TEXT NOT NULL,
  trust_pilot_prompted_date DATE,
  trust_pilot_completed BOOLEAN DEFAULT FALSE,
  trust_pilot_completion_date DATE,
  video_testimonial_prompted_date DATE,
  video_testimonial_completed BOOLEAN DEFAULT FALSE,
  video_testimonial_completion_date DATE,
  retention_prompted_date DATE,
  retention_completed BOOLEAN DEFAULT FALSE,
  retention_completion_date DATE,
  referral_prompted_date DATE,
  referral_completed BOOLEAN DEFAULT FALSE,
  referral_completion_date DATE
);

-- ============================================================
-- Table 3: program_pauses (client pause tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS program_pauses (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  coach_name TEXT,
  pause_start_date DATE,
  pause_days INTEGER DEFAULT 0,
  reason TEXT,
  approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table 4: coach_meetings (meeting log)
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_meetings (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  coach_name TEXT NOT NULL,
  meeting_date DATE,
  duration_minutes INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table 5: eod_reports (end-of-day reports)
-- ============================================================
CREATE TABLE IF NOT EXISTS eod_reports (
  id BIGSERIAL PRIMARY KEY,
  submitted_by TEXT NOT NULL,
  role TEXT NOT NULL,
  date DATE NOT NULL,
  active_client_count INTEGER DEFAULT 0,
  new_clients INTEGER DEFAULT 0,
  accounts_deactivated INTEGER DEFAULT 0,
  community_engagement TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  questions_for_management TEXT DEFAULT '',
  hours_logged NUMERIC DEFAULT 0,
  feeling_today TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table 6: eod_client_checkins (per-client checkins within EOD)
-- ============================================================
CREATE TABLE IF NOT EXISTS eod_client_checkins (
  id BIGSERIAL PRIMARY KEY,
  eod_id BIGINT REFERENCES eod_reports(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  checked_in BOOLEAN DEFAULT FALSE,
  notes TEXT DEFAULT ''
);

-- ============================================================
-- Table 7: finances (payments, refunds, retention revenue)
-- ============================================================
CREATE TABLE IF NOT EXISTS finances (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  coach_name TEXT,
  amount_paid NUMERIC DEFAULT 0,
  refund_amount NUMERIC DEFAULT 0,
  refund_reason TEXT DEFAULT '',
  refund_date DATE,
  retention_revenue NUMERIC DEFAULT 0,
  retention_date DATE
);

-- ============================================================
-- Row Level Security
-- ============================================================

-- Enable RLS on all new tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE eod_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE eod_client_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE finances ENABLE ROW LEVEL SECURITY;

-- Allow anon key to read all tables (matches existing pattern)
CREATE POLICY "Allow public read" ON clients FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON coach_milestones FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON program_pauses FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON coach_meetings FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON eod_reports FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON eod_client_checkins FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON finances FOR SELECT USING (true);

-- Service role key bypasses RLS for writes (no write policies needed for anon)

-- ============================================================
-- Done! Coaching tables are ready.
-- ============================================================
