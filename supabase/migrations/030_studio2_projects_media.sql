CREATE TABLE IF NOT EXISTS studio2_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio2_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_id UUID REFERENCES studio2_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  copy_text TEXT,
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio2_media (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES studio2_projects(id) ON DELETE SET NULL,
  folder_id UUID REFERENCES studio2_folders(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio2_projects_updated
  ON studio2_projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio2_projects_folder
  ON studio2_projects (folder_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio2_media_project
  ON studio2_media (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio2_media_folder
  ON studio2_media (folder_id, created_at DESC);

ALTER TABLE studio2_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio2_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio2_media ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'studio2_folders' AND policyname = 'Allow service role manage studio2 folders') THEN
    CREATE POLICY "Allow service role manage studio2 folders" ON studio2_folders TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'studio2_projects' AND policyname = 'Allow service role manage studio2 projects') THEN
    CREATE POLICY "Allow service role manage studio2 projects" ON studio2_projects TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'studio2_media' AND policyname = 'Allow service role manage studio2 media') THEN
    CREATE POLICY "Allow service role manage studio2 media" ON studio2_media TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
