-- 026_daily_coacher_tables.sql
-- Schema foundation for the Daily Coacher feature: AI-generated draft
-- messages per client, surfaced inside the existing /coaching section.
-- See docs/daily-coacher-build-plan.md for the full spec.
--
-- Phase 1 of 8. This migration only adds storage; no API or UI wiring.
--
-- Additive only:
--   - New columns on `clients` for the persistent summary + cached
--     onboarding-call transcript.
--   - New table `daily_coacher_live_messages` (rolling 20-message
--     context window per client; we store all and query the latest 20).
--   - New table `tips_library` (curated coach-approved tips the AI
--     selects from when generating draft messages).
-- Existing tables and policies are untouched.

BEGIN;

-- ============================================================
-- clients: persistent summary + onboarding-call transcript cache
-- ============================================================
-- The summary is the AI-generated context blob that's always the
-- primary input to every topic generation. Regenerated lazily when
-- any input is newer than `daily_coacher_summary_updated_at`, or
-- on explicit "Refresh summary" click.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS daily_coacher_summary TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS daily_coacher_summary_updated_at TIMESTAMPTZ;

-- Onboarding Fathom transcript is fetched once per `onboarding_fathom_link`
-- value and cached on the client row. Refetched only when the link changes
-- (compared via `onboarding_fathom_link_fetched_for`). Avoids re-hitting
-- the Fathom API on every summary regen.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_transcript_cached TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_transcript_fetched_at TIMESTAMPTZ;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_fathom_link_fetched_for TEXT;

COMMENT ON COLUMN public.clients.daily_coacher_summary IS
  'Daily Coacher: persistent AI-generated client summary. Primary context for every topic generation. Regenerated lazily when any input (intake/notes/meetings/Fathom transcript) is newer than daily_coacher_summary_updated_at.';

COMMENT ON COLUMN public.clients.onboarding_transcript_cached IS
  'Daily Coacher: cached text of the onboarding Fathom call transcript. Refetched from Fathom API only when onboarding_fathom_link differs from onboarding_fathom_link_fetched_for.';

-- ============================================================
-- daily_coacher_live_messages: rolling client/coach exchange context
-- ============================================================
-- Coach pastes recent message exchanges with the client; latest 20 feed
-- into topic generation as live context. Storing all (no FIFO delete) —
-- the "rolling 20" is a query LIMIT, not a destructive write. Lets us
-- re-window later without losing history.
CREATE TABLE IF NOT EXISTS public.daily_coacher_live_messages (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('coach', 'client')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_coacher_live_messages_client_created
  ON public.daily_coacher_live_messages (client_id, created_at DESC);

COMMENT ON TABLE public.daily_coacher_live_messages IS
  'Daily Coacher: rolling context window of recent client/coach message exchanges, pasted by the coach. Read latest 20 per client via ORDER BY created_at DESC LIMIT 20. Storing all rows (no FIFO delete) so we can re-window later.';

-- ============================================================
-- tips_library: curated coach-approved tips for AI draft generation
-- ============================================================
-- The AI selects 1–3 relevant tips per generation based on topic +
-- client context tags. CCOS owns the library; tips improve by editing
-- the table, not by re-prompting. `approved` defaults to false so
-- new tips don't go live in the UI until reviewed.
CREATE TABLE IF NOT EXISTS public.tips_library (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  tip_text TEXT NOT NULL,
  applies_to_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  weight INTEGER NOT NULL DEFAULT 1,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tips_library_topic_approved
  ON public.tips_library (topic, approved);

COMMENT ON TABLE public.tips_library IS
  'Daily Coacher: curated tips the AI selects from when drafting messages. One row per tip. `approved=false` keeps a tip out of generation until it has been reviewed. `applies_to_tags` is a JSON array of free-form tags (e.g. ["beginner", "fat-loss", "vegetarian"]) used to narrow tip selection.';

COMMENT ON COLUMN public.tips_library.weight IS
  'Higher weight = more likely to be selected when multiple tips match the topic+tags filter. Default 1.';

-- ============================================================
-- Row Level Security
-- ============================================================
-- Match the existing CCOS pattern: anon key can SELECT, writes go
-- through the service role (which bypasses RLS). No write policies
-- needed.

ALTER TABLE public.daily_coacher_live_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tips_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"
  ON public.daily_coacher_live_messages FOR SELECT USING (true);

CREATE POLICY "Allow public read"
  ON public.tips_library FOR SELECT USING (true);

COMMIT;
