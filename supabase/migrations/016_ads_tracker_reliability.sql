-- 016_ads_tracker_reliability.sql
-- Reliability hardening for Ads Tracker ingestion.

ALTER TABLE ads_meta_insights_daily
  ADD COLUMN IF NOT EXISTS account_timezone text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_ads_meta_insights_ad_date
  ON ads_meta_insights_daily (ad_id, date DESC);

ALTER TABLE ads_keyword_events
  ADD COLUMN IF NOT EXISTS source_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_keyword_events_source_event_id
  ON ads_keyword_events (source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ads_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'success', 'error')),
  date_from date,
  date_to date,
  rows_fetched int NOT NULL DEFAULT 0,
  rows_upserted int NOT NULL DEFAULT 0,
  accounts jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ads_sync_runs_source_started
  ON ads_sync_runs (source, started_at DESC);

ALTER TABLE ads_sync_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_sync_runs'
      AND policyname = 'Allow anon read ads sync runs'
  ) THEN
    CREATE POLICY "Allow anon read ads sync runs"
      ON ads_sync_runs FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_sync_runs'
      AND policyname = 'Allow service role manage ads sync runs'
  ) THEN
    CREATE POLICY "Allow service role manage ads sync runs"
      ON ads_sync_runs USING (true) WITH CHECK (true);
  END IF;
END $$;
