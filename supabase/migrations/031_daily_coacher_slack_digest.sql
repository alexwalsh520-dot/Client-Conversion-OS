-- 031_daily_coacher_slack_digest.sql
-- Tables for the Daily Coacher Slack digest. Each morning at 1:30 PM PKT
-- (8:30 UTC), eligible coaches receive a private Slack DM with 5 suggested
-- clients + pre-generated drafts they can copy directly into Everfit.
--
-- Three tables:
--   1. daily_coacher_recipients — who gets the digest. Seeded with the
--      4 initial coaches (Stef, Farrukh, Waleed, Belkys). Admin-controlled
--      via Coach Performance toggle; coach-controlled via Snooze buttons
--      in the Slack message.
--   2. daily_coacher_pending_coaches — coaches detected as eligible but
--      not yet onboarded to Slack. Avoids re-pinging admin every day.
--   3. daily_coacher_digest_sends — per-suggestion engagement log.
--
-- See src/lib/daily-coacher/digest.ts for the selection algorithm and
-- src/app/api/cron/daily-coacher-digest/route.ts for the send pipeline.

BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_coacher_recipients (
  coach_name TEXT PRIMARY KEY,
  slack_email TEXT,
  slack_user_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  snoozed_until TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.daily_coacher_recipients (coach_name, slack_email, enabled) VALUES
  ('Stef',    'stefhughes.pt@gmail.com',           TRUE),
  ('Farrukh', 'ahmedfarrukh2007@gmail.com',        TRUE),
  ('Waleed',  'waleed.261998@gmail.com',           TRUE),
  ('Belkys',  'belkys.barrios.anamey@gmail.com',   TRUE)
ON CONFLICT (coach_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.daily_coacher_pending_coaches (
  coach_name TEXT PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_client_count INTEGER NOT NULL,
  admin_notified_at TIMESTAMPTZ,
  admin_last_pinged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.daily_coacher_digest_sends (
  id BIGSERIAL PRIMARY KEY,
  coach_name TEXT NOT NULL,
  slack_user_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  draft_excerpt TEXT,
  slack_message_ts TEXT,
  opened_in_ccos_at TIMESTAMPTZ,
  regenerated_at TIMESTAMPTZ,
  regenerate_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_daily_coacher_digest_sends_coach_sent
  ON public.daily_coacher_digest_sends (coach_name, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_coacher_digest_sends_client
  ON public.daily_coacher_digest_sends (client_id, sent_at DESC);

DROP TRIGGER IF EXISTS trg_daily_coacher_recipients_updated_at ON public.daily_coacher_recipients;
CREATE TRIGGER trg_daily_coacher_recipients_updated_at BEFORE UPDATE ON public.daily_coacher_recipients
  FOR EACH ROW EXECUTE FUNCTION public.sop_set_updated_at();

ALTER TABLE public.daily_coacher_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_coacher_pending_coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_coacher_digest_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.daily_coacher_recipients FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON public.daily_coacher_pending_coaches FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON public.daily_coacher_digest_sends FOR SELECT USING (true);

COMMIT;
