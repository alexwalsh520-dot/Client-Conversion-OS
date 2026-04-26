-- 018_ads_tracker_keyword_backfill.sql
-- Historical keyword-level Ads Tracker backfill from April 2026 spreadsheet comments.

CREATE TABLE IF NOT EXISTS ads_keyword_backfill_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'april_2026_sheet_comments',
  client_key text NOT NULL,
  client_name text NOT NULL,
  date date NOT NULL,
  keyword_raw text NOT NULL,
  keyword_normalized text NOT NULL,
  messages int NOT NULL DEFAULT 0,
  booked_calls int NOT NULL DEFAULT 0,
  new_clients int NOT NULL DEFAULT 0,
  contracted_revenue_cents int NOT NULL DEFAULT 0,
  collected_revenue_cents int NOT NULL DEFAULT 0,
  source_workbook text,
  source_sheet text,
  source_row int,
  raw_payload jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, client_key, date, keyword_normalized)
);

CREATE INDEX IF NOT EXISTS idx_ads_keyword_backfill_client_date
  ON ads_keyword_backfill_daily (client_key, date DESC);

CREATE INDEX IF NOT EXISTS idx_ads_keyword_backfill_keyword_date
  ON ads_keyword_backfill_daily (keyword_normalized, date DESC);

CREATE TABLE IF NOT EXISTS ads_keyword_backfill_reconciliation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'april_2026_sheet_comments',
  client_key text NOT NULL,
  date date NOT NULL,
  cell text NOT NULL,
  metric text NOT NULL,
  cell_value numeric,
  parsed_total numeric,
  difference numeric,
  raw_comment text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, client_key, date, cell, metric)
);

CREATE INDEX IF NOT EXISTS idx_ads_keyword_backfill_issues_open
  ON ads_keyword_backfill_reconciliation_issues (resolved_at, date DESC);

ALTER TABLE ads_keyword_backfill_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_keyword_backfill_reconciliation_issues ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_keyword_backfill_daily'
      AND policyname = 'Allow anon read ads keyword backfill'
  ) THEN
    CREATE POLICY "Allow anon read ads keyword backfill"
      ON ads_keyword_backfill_daily FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_keyword_backfill_daily'
      AND policyname = 'Allow service role manage ads keyword backfill'
  ) THEN
    CREATE POLICY "Allow service role manage ads keyword backfill"
      ON ads_keyword_backfill_daily USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_keyword_backfill_reconciliation_issues'
      AND policyname = 'Allow anon read ads keyword backfill issues'
  ) THEN
    CREATE POLICY "Allow anon read ads keyword backfill issues"
      ON ads_keyword_backfill_reconciliation_issues FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_keyword_backfill_reconciliation_issues'
      AND policyname = 'Allow service role manage ads keyword backfill issues'
  ) THEN
    CREATE POLICY "Allow service role manage ads keyword backfill issues"
      ON ads_keyword_backfill_reconciliation_issues USING (true) WITH CHECK (true);
  END IF;
END $$;
