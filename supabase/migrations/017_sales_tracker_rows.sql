-- 017_sales_tracker_rows.sql
-- Row-level sales tracker mirror for Ads Tracker attribution.

CREATE TABLE IF NOT EXISTS sales_tracker_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'google_sheets',
  sheet_id text,
  sheet_tab text,
  sheet_row_key text NOT NULL,
  date date NOT NULL,
  call_number text,
  prospect_name text NOT NULL,
  prospect_name_normalized text,
  call_taken boolean NOT NULL DEFAULT false,
  call_taken_status text,
  call_length text,
  recorded boolean,
  outcome text,
  closer text,
  objection text,
  program_length text,
  contracted_revenue_cents bigint NOT NULL DEFAULT 0,
  collected_revenue_cents bigint NOT NULL DEFAULT 0,
  payment_method text,
  setter text,
  call_notes text,
  recording_link text,
  offer text,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, sheet_row_key)
);

ALTER TABLE sales_tracker_rows
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'google_sheets',
  ADD COLUMN IF NOT EXISTS sheet_id text,
  ADD COLUMN IF NOT EXISTS sheet_tab text,
  ADD COLUMN IF NOT EXISTS sheet_row_key text,
  ADD COLUMN IF NOT EXISTS date date,
  ADD COLUMN IF NOT EXISTS call_number text,
  ADD COLUMN IF NOT EXISTS prospect_name text,
  ADD COLUMN IF NOT EXISTS prospect_name_normalized text,
  ADD COLUMN IF NOT EXISTS call_taken boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_taken_status text,
  ADD COLUMN IF NOT EXISTS call_length text,
  ADD COLUMN IF NOT EXISTS recorded boolean,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS closer text,
  ADD COLUMN IF NOT EXISTS objection text,
  ADD COLUMN IF NOT EXISTS program_length text,
  ADD COLUMN IF NOT EXISTS contracted_revenue_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_revenue_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS setter text,
  ADD COLUMN IF NOT EXISTS call_notes text,
  ADD COLUMN IF NOT EXISTS recording_link text,
  ADD COLUMN IF NOT EXISTS offer text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tracker_rows_source_key
  ON sales_tracker_rows (source, sheet_row_key);

CREATE INDEX IF NOT EXISTS idx_sales_tracker_rows_date
  ON sales_tracker_rows (date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_tracker_rows_name
  ON sales_tracker_rows (prospect_name_normalized);

CREATE INDEX IF NOT EXISTS idx_sales_tracker_rows_offer
  ON sales_tracker_rows (offer);

CREATE INDEX IF NOT EXISTS idx_sales_tracker_rows_outcome
  ON sales_tracker_rows (outcome);

ALTER TABLE sales_tracker_rows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_tracker_rows'
      AND policyname = 'Allow anon read sales tracker rows'
  ) THEN
    CREATE POLICY "Allow anon read sales tracker rows"
      ON sales_tracker_rows FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_tracker_rows'
      AND policyname = 'Allow service role manage sales tracker rows'
  ) THEN
    CREATE POLICY "Allow service role manage sales tracker rows"
      ON sales_tracker_rows USING (true) WITH CHECK (true);
  END IF;
END $$;
