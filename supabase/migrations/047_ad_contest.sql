-- 047_ad_contest.sql
-- Ads Leaderboard — customer ad creation contest.
--
-- Coaching clients compete to make the best-performing video ad. Each contestant
-- works through a public, tokenized flow (/ads-leaderboard/compete/<token>):
--   intake form -> AI-generated "Sonnet" script -> record + upload video ->
--   CapCut edit guide -> submit.
--
-- Submitted videos are stored in the SAME Cloudflare R2 bucket Studio 2 +
-- testimonials use, under a dedicated `ad-contest/` key prefix (never mixed
-- with studio-2/ or testimonials/). Progress is DB-backed (not localStorage) so
-- a contestant always resumes exactly where they left off via their token link.
--
-- When a contest ad is launched on Meta, an admin links the row to a live ad
-- (ad_id + client_key); the leaderboard then pulls budget / spend / ROAS from
-- ads_meta_insights_daily + attribution for that ad_id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ad_contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Unguessable token that forms the contestant-facing resume link. One per entry.
  token TEXT NOT NULL UNIQUE,

  -- Link back to the real coaching client (nullable: an invite can be created
  -- before the client is matched). Denormalized name kept for display/Slack.
  client_id BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT,
  -- Which creator/coach roster this contestant rolls up to (tyson/lucy/...).
  creator_key TEXT,

  -- Who is competing (captured in the intake step).
  contestant_name TEXT,
  contestant_email TEXT,

  -- Lifecycle of the contestant flow. `step` is the resume cursor (wizard index).
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'intake_done', 'script_ready', 'recording', 'submitted', 'live')),
  step INT NOT NULL DEFAULT 0,

  -- Intake answers (the questions that feed the script) + the generated script.
  intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  script TEXT,
  script_meta JSONB,

  -- Uploaded video (R2 object under the ad-contest/ prefix). NULL until submit.
  r2_key TEXT,
  video_url TEXT,
  content_type TEXT,
  file_size BIGINT,
  submitted_at TIMESTAMPTZ,

  -- Live-ad linkage. Set by an admin once the ad is launched on Meta, so the
  -- leaderboard can join to ads_meta_insights_daily (spend) + attribution (ROAS).
  ad_id TEXT,
  ad_account_id TEXT,

  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_contest_status
  ON public.ad_contest_entries (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_contest_client
  ON public.ad_contest_entries (client_id);

CREATE INDEX IF NOT EXISTS idx_ad_contest_ad_id
  ON public.ad_contest_entries (ad_id);

COMMENT ON TABLE public.ad_contest_entries IS
  'Ads Leaderboard contest entries. Public tokenized flow (intake -> Sonnet script -> record/upload -> submit). Videos live in R2 under ad-contest/. When launched, ad_id links to ads_meta_insights_daily for leaderboard metrics.';

-- RLS on, no anon policies: the public flow goes through service-role API routes
-- that validate the token; admin views go through admin-authed service-role
-- routes. Service role bypasses RLS (matches video_testimonials).
ALTER TABLE public.ad_contest_entries ENABLE ROW LEVEL SECURITY;

COMMIT;
