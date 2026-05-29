ALTER TABLE studio2_media
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE INDEX IF NOT EXISTS idx_studio2_media_kind_folder
  ON studio2_media (kind, folder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS studio2_copy_transcriptions (
  source_ad_id TEXT PRIMARY KEY,
  client_key TEXT,
  ad_name TEXT,
  campaign_name TEXT,
  image_url TEXT NOT NULL,
  extracted_copy TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio2_copy_transcriptions_client
  ON studio2_copy_transcriptions (client_key, updated_at DESC);

ALTER TABLE studio2_copy_transcriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'studio2_copy_transcriptions'
      AND policyname = 'Allow service role manage studio2 copy transcriptions'
  ) THEN
    CREATE POLICY "Allow service role manage studio2 copy transcriptions"
      ON studio2_copy_transcriptions
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
