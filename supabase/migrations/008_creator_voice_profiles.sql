-- Creator voices for personalized ElevenLabs DM notes.

CREATE TABLE IF NOT EXISTS creator_voice_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  creator_name TEXT NOT NULL,
  client_key TEXT,
  elevenlabs_voice_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  sample_count INTEGER NOT NULL DEFAULT 0,
  sample_filenames JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_voice_profiles_creator_name
  ON creator_voice_profiles (creator_name);

CREATE INDEX IF NOT EXISTS idx_creator_voice_profiles_client_key
  ON creator_voice_profiles (client_key);

ALTER TABLE creator_voice_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'creator_voice_profiles'
      AND policyname = 'Allow service role manage creator voice profiles'
  ) THEN
    CREATE POLICY "Allow service role manage creator voice profiles"
      ON creator_voice_profiles
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

