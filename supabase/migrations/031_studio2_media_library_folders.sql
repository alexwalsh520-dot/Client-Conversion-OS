ALTER TABLE studio2_folders
  ADD COLUMN IF NOT EXISTS folder_type TEXT NOT NULL DEFAULT 'design';

ALTER TABLE studio2_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES studio2_folders(id) ON DELETE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'studio2_folders_folder_type_check'
  ) THEN
    ALTER TABLE studio2_folders
      ADD CONSTRAINT studio2_folders_folder_type_check
      CHECK (folder_type IN ('design', 'media'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_studio2_folders_type_parent
  ON studio2_folders (folder_type, parent_id, name);
