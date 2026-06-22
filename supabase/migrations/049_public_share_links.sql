-- 049_public_share_links.sql
-- Public, no-login share links — a tokenized read-only window into ONE creator's
-- live Ads tab. The operator mints a link per creator and pastes it (e.g. Slack);
-- the creator opens it and can ONLY ever see their own ads.
--
-- Security model:
--   * The token is the only credential. It maps to exactly one client_key.
--   * The public API (/api/public/ads/[token]) derives the creator SOLELY from
--     this row server-side and hard-filters every query to that one client_key.
--     It never accepts a client/scope param from the request, so a tampered URL
--     can never widen scope to another creator.
--   * Revoked links return "not available" with no data.
--
-- RLS posture mirrors factory_items / ad_variations / ad_contest_entries:
--   RLS ON, no anon policies. All reads/writes go through service-role API
--   routes (service role bypasses RLS — single-user internal app). The anon key
--   gets NOTHING here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.public_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Long, unguessable, url-safe token (>=32 chars). The only credential.
  token TEXT UNIQUE NOT NULL,
  -- What this link exposes. Today only 'ads'; reusable for future surfaces.
  kind TEXT NOT NULL DEFAULT 'ads',
  -- The single creator this link is locked to (e.g. 'antwan'). Scope boundary.
  client_key TEXT NOT NULL,
  -- Human label for the operator, e.g. "Antwan creator ads view".
  label TEXT,
  -- Soft kill switch — revoked links show "not available", never data.
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_share_links_token
  ON public.public_share_links (token);

COMMENT ON TABLE public.public_share_links IS
  'Tokenized no-login share links. token -> one client_key. Public Ads view is hard-scoped to that creator server-side; anon gets nothing (RLS on, service-role only).';

ALTER TABLE public.public_share_links ENABLE ROW LEVEL SECURITY;

-- Seed Antwan's creator-facing ads view.
INSERT INTO public.public_share_links (token, kind, client_key, label)
VALUES (
  'V2ukDPsUD9oUMIZ-poa88KmpWOGqCXOkW1Sbw7_0FpY',
  'ads',
  'antwan',
  'Antwan creator ads view'
)
ON CONFLICT (token) DO NOTHING;

COMMIT;
