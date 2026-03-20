-- Migration: Add columns and constraints for coach tracker Google Sheets sync
-- Adds sales_person + comments columns to clients table
-- Adds unique constraints needed for upsert-on-conflict during sync

-- ============================================================
-- 1. New columns on clients table
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sales_person TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS comments TEXT;

-- ============================================================
-- 2. Unique constraint on clients(name, coach_name) for sync upsert
--    This allows the sync to match sheet rows to DB rows by name+coach
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS clients_name_coach_uniq
  ON clients (name, coach_name);

-- ============================================================
-- 3. Unique constraint on coach_milestones(client_name, coach_name)
--    for milestone sync upsert from coach tracker sheets
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS milestones_client_coach_uniq
  ON coach_milestones (client_name, coach_name);

-- ============================================================
-- 4. Change milestone date columns from DATE to TEXT
--    Coaches often write dates without year (e.g. "Feb 2" → "02/02")
-- ============================================================
ALTER TABLE coach_milestones
  ALTER COLUMN trust_pilot_prompted_date TYPE TEXT USING trust_pilot_prompted_date::TEXT,
  ALTER COLUMN trust_pilot_completion_date TYPE TEXT USING trust_pilot_completion_date::TEXT,
  ALTER COLUMN video_testimonial_prompted_date TYPE TEXT USING video_testimonial_prompted_date::TEXT,
  ALTER COLUMN video_testimonial_completion_date TYPE TEXT USING video_testimonial_completion_date::TEXT,
  ALTER COLUMN retention_prompted_date TYPE TEXT USING retention_prompted_date::TEXT,
  ALTER COLUMN retention_completion_date TYPE TEXT USING retention_completion_date::TEXT,
  ALTER COLUMN referral_prompted_date TYPE TEXT USING referral_prompted_date::TEXT,
  ALTER COLUMN referral_completion_date TYPE TEXT USING referral_completion_date::TEXT;
