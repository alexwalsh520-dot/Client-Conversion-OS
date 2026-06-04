-- Meta/Instagram connections for live response-time tracking.
-- ManyChat gives CCOS the lead assignment. Instagram webhooks give CCOS the
-- exact inbound/outbound message timestamps.

CREATE TABLE IF NOT EXISTS instagram_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_slug TEXT NOT NULL,
  client_key TEXT NOT NULL UNIQUE,
  client_label TEXT NOT NULL,
  instagram_user_id TEXT,
  instagram_username TEXT,
  facebook_page_id TEXT,
  facebook_page_name TEXT,
  oauth_mode TEXT,
  granted_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  subscription_status TEXT DEFAULT 'pending',
  subscription_error TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  last_webhook_at TIMESTAMPTZ,
  connected_by TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instagram_connections_instagram_user
  ON instagram_connections (instagram_user_id);

CREATE INDEX IF NOT EXISTS idx_instagram_connections_client_slug
  ON instagram_connections (client_slug);

ALTER TABLE instagram_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'instagram_connections'
      AND policyname = 'Allow service role manage instagram connections'
  ) THEN
    CREATE POLICY "Allow service role manage instagram connections"
      ON instagram_connections
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Links ManyChat contacts to Instagram DM identities.
CREATE TABLE IF NOT EXISTS instagram_lead_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client TEXT NOT NULL,
  manychat_subscriber_id TEXT,
  instagram_user_id TEXT,
  instagram_handle TEXT,
  lead_name TEXT,
  confidence TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'unknown',
  last_manychat_event_at TIMESTAMPTZ,
  last_instagram_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instagram_lead_links_client_manychat
  ON instagram_lead_links (client, manychat_subscriber_id);

CREATE INDEX IF NOT EXISTS idx_instagram_lead_links_client_instagram
  ON instagram_lead_links (client, instagram_user_id);

CREATE INDEX IF NOT EXISTS idx_instagram_lead_links_client_handle
  ON instagram_lead_links (client, instagram_handle);

ALTER TABLE instagram_lead_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'instagram_lead_links'
      AND policyname = 'Allow service role manage instagram lead links'
  ) THEN
    CREATE POLICY "Allow service role manage instagram lead links"
      ON instagram_lead_links
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
