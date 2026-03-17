-- Manychat Tag Events table — stores webhook events from Manychat flows
-- These events power the DM metrics dashboard (new leads, leads engaged, etc.)
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS manychat_tag_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  subscriber_name TEXT,
  tag_name TEXT NOT NULL,           -- 'new_lead', 'lead_engaged', 'call_link_sent', 'sub_link_sent'
  client TEXT NOT NULL,             -- 'tyson' or 'keith'
  setter_name TEXT,                 -- 'amara', 'kelechi', 'gideon', 'debbie'
  event_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for dashboard metric queries (filter by client + date + tag)
CREATE INDEX IF NOT EXISTS idx_manychat_events_client_date
  ON manychat_tag_events (client, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_manychat_events_tag
  ON manychat_tag_events (tag_name, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_manychat_events_setter
  ON manychat_tag_events (setter_name, event_at DESC);

-- Composite index for the exact query pattern used by getMetrics()
CREATE INDEX IF NOT EXISTS idx_manychat_events_lookup
  ON manychat_tag_events (client, event_at, tag_name, setter_name);

-- RLS policies
ALTER TABLE manychat_tag_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read" ON manychat_tag_events
  FOR SELECT USING (true);

CREATE POLICY "Allow service role insert" ON manychat_tag_events
  FOR INSERT WITH CHECK (true);
