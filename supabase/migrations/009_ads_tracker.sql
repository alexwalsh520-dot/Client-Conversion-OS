-- 009_ads_tracker.sql
-- Live Ads Tracker: Meta ad metrics + automated keyword attribution.

CREATE TABLE IF NOT EXISTS ads_meta_insights_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  client_name text NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text NOT NULL,
  ad_name text,
  keyword_raw text,
  keyword_normalized text,
  date date NOT NULL,
  spend_cents int NOT NULL DEFAULT 0,
  impressions int NOT NULL DEFAULT 0,
  link_clicks int NOT NULL DEFAULT 0,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (client_key, ad_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ads_meta_insights_client_date
  ON ads_meta_insights_daily (client_key, date DESC);

CREATE INDEX IF NOT EXISTS idx_ads_meta_insights_keyword_date
  ON ads_meta_insights_daily (keyword_normalized, date DESC);

CREATE TABLE IF NOT EXISTS ads_keyword_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('manychat', 'ghl')),
  event_type text NOT NULL,
  client_key text NOT NULL,
  keyword_raw text,
  keyword_normalized text,
  subscriber_id text,
  subscriber_name text,
  setter_name text,
  appointment_id text,
  contact_id text,
  contact_name text,
  value_cents int,
  event_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ads_keyword_events_appointment_id_key'
  ) THEN
    ALTER TABLE ads_keyword_events
      ADD CONSTRAINT ads_keyword_events_appointment_id_key UNIQUE (appointment_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ads_keyword_events_source_client_date
  ON ads_keyword_events (source, client_key, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_ads_keyword_events_keyword_date
  ON ads_keyword_events (keyword_normalized, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_ads_keyword_events_contact_name
  ON ads_keyword_events (contact_name);

CREATE TABLE IF NOT EXISTS ads_attribution_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  reason text NOT NULL,
  client_key text,
  keyword_normalized text,
  contact_name text,
  appointment_id text,
  payload jsonb,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_attribution_exceptions_open
  ON ads_attribution_exceptions (resolved_at, created_at DESC);

ALTER TABLE ghl_appointments
  ADD COLUMN IF NOT EXISTS keyword_raw text,
  ADD COLUMN IF NOT EXISTS keyword_normalized text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

ALTER TABLE manychat_tag_events
  ADD COLUMN IF NOT EXISTS keyword_raw text,
  ADD COLUMN IF NOT EXISTS keyword_normalized text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

ALTER TABLE ads_meta_insights_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_keyword_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_attribution_exceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_meta_insights_daily'
      AND policyname = 'Allow anon read ads meta insights'
  ) THEN
    CREATE POLICY "Allow anon read ads meta insights"
      ON ads_meta_insights_daily FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_keyword_events'
      AND policyname = 'Allow anon read ads keyword events'
  ) THEN
    CREATE POLICY "Allow anon read ads keyword events"
      ON ads_keyword_events FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_attribution_exceptions'
      AND policyname = 'Allow anon read ads attribution exceptions'
  ) THEN
    CREATE POLICY "Allow anon read ads attribution exceptions"
      ON ads_attribution_exceptions FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_meta_insights_daily'
      AND policyname = 'Allow service role manage ads meta insights'
  ) THEN
    CREATE POLICY "Allow service role manage ads meta insights"
      ON ads_meta_insights_daily USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_keyword_events'
      AND policyname = 'Allow service role manage ads keyword events'
  ) THEN
    CREATE POLICY "Allow service role manage ads keyword events"
      ON ads_keyword_events USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_attribution_exceptions'
      AND policyname = 'Allow service role manage ads attribution exceptions'
  ) THEN
    CREATE POLICY "Allow service role manage ads attribution exceptions"
      ON ads_attribution_exceptions USING (true) WITH CHECK (true);
  END IF;
END $$;
