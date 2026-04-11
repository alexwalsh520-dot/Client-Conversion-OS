-- Stores every synced GHL conversation message for future AI review and funnel analysis.

CREATE TABLE IF NOT EXISTS dm_conversation_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  setter_name TEXT,
  contact_id TEXT,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  direction TEXT,
  channel TEXT,
  message_type TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_conversation_messages_client_sent
  ON dm_conversation_messages (client, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_conversation_messages_conversation
  ON dm_conversation_messages (conversation_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_conversation_messages_subscriber
  ON dm_conversation_messages (subscriber_id, sent_at DESC);

ALTER TABLE dm_conversation_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dm_conversation_messages'
      AND policyname = 'Allow service role manage dm conversation messages'
  ) THEN
    CREATE POLICY "Allow service role manage dm conversation messages"
      ON dm_conversation_messages
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Stores current AI stage state for each live DM conversation.

CREATE TABLE IF NOT EXISTS dm_conversation_stage_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  setter_name TEXT,
  contact_id TEXT,
  conversation_id TEXT NOT NULL UNIQUE,
  goal_clear BOOLEAN DEFAULT FALSE,
  gap_clear BOOLEAN DEFAULT FALSE,
  stakes_clear BOOLEAN DEFAULT FALSE,
  qualified BOOLEAN DEFAULT FALSE,
  booking_readiness_score INTEGER DEFAULT 0,
  ai_confidence NUMERIC DEFAULT 0,
  stage_evidence JSONB,
  raw_classification JSONB,
  analysis_version TEXT,
  latest_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_conversation_stage_state_client_updated
  ON dm_conversation_stage_state (client, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_conversation_stage_state_subscriber
  ON dm_conversation_stage_state (subscriber_id, updated_at DESC);

ALTER TABLE dm_conversation_stage_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dm_conversation_stage_state'
      AND policyname = 'Allow service role manage dm conversation stage state'
  ) THEN
    CREATE POLICY "Allow service role manage dm conversation stage state"
      ON dm_conversation_stage_state
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
