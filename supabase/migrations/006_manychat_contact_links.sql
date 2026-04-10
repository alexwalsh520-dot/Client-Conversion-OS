-- Stable mapping from ManyChat subscriber IDs to GHL contact IDs.
-- This keeps DM events updating the same GHL contact instead of creating duplicates.

CREATE TABLE IF NOT EXISTS manychat_contact_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  ghl_contact_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_manychat_contact_links_client_subscriber
  ON manychat_contact_links (client, subscriber_id);

ALTER TABLE manychat_contact_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manychat_contact_links'
      AND policyname = 'Allow service role manage manychat contact links'
  ) THEN
    CREATE POLICY "Allow service role manage manychat contact links"
      ON manychat_contact_links
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
