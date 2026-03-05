-- DM Transcripts table for setter daily submissions
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS dm_transcripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setter_name TEXT NOT NULL,
  client TEXT NOT NULL,          -- 'tyson' or 'keith'
  transcript TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed BOOLEAN DEFAULT FALSE,
  review_result TEXT,
  reviewed_at TIMESTAMPTZ
);

-- Index for dashboard queries (filter by client + date)
CREATE INDEX IF NOT EXISTS idx_dm_transcripts_client_date
  ON dm_transcripts (client, submitted_at DESC);

-- Index for setter lookups
CREATE INDEX IF NOT EXISTS idx_dm_transcripts_setter
  ON dm_transcripts (setter_name, submitted_at DESC);

-- RLS: allow anon read (dashboard uses anon key behind auth middleware)
ALTER TABLE dm_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read" ON dm_transcripts
  FOR SELECT USING (true);

CREATE POLICY "Allow service role insert" ON dm_transcripts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service role update" ON dm_transcripts
  FOR UPDATE USING (true);
