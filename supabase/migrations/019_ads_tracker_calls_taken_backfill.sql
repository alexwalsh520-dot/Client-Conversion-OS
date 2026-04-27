-- 019_ads_tracker_calls_taken_backfill.sql
-- Preserve historical 45-min calls taken from spreadsheet/comment backfills.

ALTER TABLE ads_keyword_backfill_daily
  ADD COLUMN IF NOT EXISTS calls_taken int NOT NULL DEFAULT 0;

