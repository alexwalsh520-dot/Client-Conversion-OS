-- Super Doc analytics tracking
-- Paste this into Supabase SQL Editor after the original Super Doc tables migration.

ALTER TABLE super_doc_leads
  ADD COLUMN IF NOT EXISTS max_scroll_percent integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS video_play_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_watch_seconds numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_watch_percent integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_video_event_at timestamptz;

CREATE TABLE IF NOT EXISTS super_doc_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_slug text NOT NULL REFERENCES super_doc_leads(slug) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_super_doc_events_lead_slug ON super_doc_events(lead_slug);
CREATE INDEX IF NOT EXISTS idx_super_doc_events_type ON super_doc_events(event_type);
CREATE INDEX IF NOT EXISTS idx_super_doc_events_created_at ON super_doc_events(created_at DESC);

ALTER TABLE super_doc_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_full_super_doc_events" ON super_doc_events;
CREATE POLICY "service_full_super_doc_events"
  ON super_doc_events
  FOR ALL
  USING (true)
  WITH CHECK (true);
