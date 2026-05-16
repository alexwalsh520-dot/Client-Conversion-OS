-- 032_marketing_brain.sql
-- Durable storage for the Marketing Brain closed loop.
--
-- The app can run before this migration by using app_settings as a fallback,
-- but these tables are the intended long-term home for sync runs, editable
-- rules, generated campaign briefs, and OCR results from image ads.

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_brain_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  mode TEXT NOT NULL DEFAULT 'manual',
  input_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  snapshot JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_marketing_brain_runs_started
  ON public.marketing_brain_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_brain_rules (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('scoring', 'copy', 'filtering', 'strategy')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  text TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'User taught rule',
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_marketing_brain_rules_active
  ON public.marketing_brain_rules (active, category);

CREATE TABLE IF NOT EXISTS public.marketing_brain_ad_ocr (
  ad_id TEXT PRIMARY KEY,
  image_url TEXT,
  extracted_text TEXT NOT NULL,
  confidence NUMERIC,
  raw_result JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.marketing_brain_fathom_calls (
  meeting_id TEXT PRIMARY KEY,
  title TEXT,
  share_url TEXT,
  transcript TEXT,
  summary TEXT,
  recorded_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_brain_fathom_recorded
  ON public.marketing_brain_fathom_calls (recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_brain_campaign_briefs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved')) DEFAULT 'draft',
  title TEXT NOT NULL,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  pushed_to_campaign_launcher_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.marketing_brain_verdict_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.marketing_brain_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_brain_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_brain_ad_ocr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_brain_fathom_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_brain_campaign_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_brain_verdict_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_brain_runs'
      AND policyname = 'Allow service role manage marketing brain runs'
  ) THEN
    CREATE POLICY "Allow service role manage marketing brain runs"
      ON public.marketing_brain_runs USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_brain_rules'
      AND policyname = 'Allow service role manage marketing brain rules'
  ) THEN
    CREATE POLICY "Allow service role manage marketing brain rules"
      ON public.marketing_brain_rules USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_brain_ad_ocr'
      AND policyname = 'Allow service role manage marketing brain ad ocr'
  ) THEN
    CREATE POLICY "Allow service role manage marketing brain ad ocr"
      ON public.marketing_brain_ad_ocr USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_brain_fathom_calls'
      AND policyname = 'Allow service role manage marketing brain fathom calls'
  ) THEN
    CREATE POLICY "Allow service role manage marketing brain fathom calls"
      ON public.marketing_brain_fathom_calls USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_brain_campaign_briefs'
      AND policyname = 'Allow service role manage marketing brain campaign briefs'
  ) THEN
    CREATE POLICY "Allow service role manage marketing brain campaign briefs"
      ON public.marketing_brain_campaign_briefs USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_brain_verdict_actions'
      AND policyname = 'Allow service role manage marketing brain verdict actions'
  ) THEN
    CREATE POLICY "Allow service role manage marketing brain verdict actions"
      ON public.marketing_brain_verdict_actions USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
