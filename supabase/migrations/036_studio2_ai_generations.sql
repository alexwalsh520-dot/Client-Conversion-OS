CREATE TABLE IF NOT EXISTS studio2_ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES studio2_projects(id) ON DELETE SET NULL,
  creative_id TEXT,
  folder_id UUID REFERENCES studio2_folders(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'higgsfield',
  model TEXT NOT NULL DEFAULT 'gpt_image_2',
  job_id TEXT UNIQUE,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result_url TEXT,
  r2_key TEXT,
  media_id UUID REFERENCES studio2_media(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio2_ai_generations_project
  ON studio2_ai_generations (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_studio2_ai_generations_job
  ON studio2_ai_generations (job_id);

ALTER TABLE studio2_ai_generations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'studio2_ai_generations'
      AND policyname = 'Allow service role manage studio2 ai generations'
  ) THEN
    CREATE POLICY "Allow service role manage studio2 ai generations"
      ON studio2_ai_generations
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
