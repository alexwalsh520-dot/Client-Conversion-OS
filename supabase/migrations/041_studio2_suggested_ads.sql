CREATE TABLE IF NOT EXISTS studio2_suggested_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  client_key TEXT,
  title TEXT NOT NULL DEFAULT 'Suggested ad',
  summary TEXT NOT NULL DEFAULT '',
  offer_type TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'opened', 'used', 'dismissed', 'failed')),
  score NUMERIC NOT NULL DEFAULT 0,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning JSONB NOT NULL DEFAULT '{}'::jsonb,
  copy_text TEXT NOT NULL DEFAULT '',
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url TEXT,
  project_id UUID REFERENCES studio2_projects(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio2_suggested_ads_status_score
  ON studio2_suggested_ads (status, score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_studio2_suggested_ads_client
  ON studio2_suggested_ads (client_key, status, score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_studio2_suggested_ads_project
  ON studio2_suggested_ads (project_id);

ALTER TABLE studio2_suggested_ads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'studio2_suggested_ads'
      AND policyname = 'Allow service role manage studio2 suggested ads'
  ) THEN
    CREATE POLICY "Allow service role manage studio2 suggested ads"
      ON studio2_suggested_ads
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
