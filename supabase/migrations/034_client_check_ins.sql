-- 034_client_check_ins.sql
-- Bi-weekly client check-in form submissions.
--
-- The public form lives at /check-in (no auth). A client picks themselves
-- from a typeahead dropdown, answers 4 required linear-scale questions
-- (Q1: 0-10, Q2-Q4: 1-10) plus an optional paragraph (Q5), and submits.
-- Score is computed server-side at insert and stored alongside so the
-- admin UI never has to recalculate, and the LSF Slack alert can fire
-- on a single comparison.
--
-- Score formula: round( (q1 + q2 + q3 + q4) / 4 * 10 )  →  0..100
--
-- RLS posture mirrors testimonial_leads: enabled, no anon SELECT policy.
-- All reads/writes flow through service-role API routes that auth-check.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_check_ins (
  id BIGSERIAL PRIMARY KEY,
  -- FK to clients. ON DELETE SET NULL so we keep historical check-in data
  -- if a client row is later removed (rare, but the score history still
  -- has analytical value for coach performance).
  client_id BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Snapshot of client identity at submission time. Used when client_id
  -- is null (deleted client) and as a sanity-check against typos.
  client_name TEXT NOT NULL,
  client_email TEXT,
  -- Snapshot of coach at submission time so coach changes after the fact
  -- don't rewrite history for Coach Performance scoring.
  coach_name TEXT,
  -- The four numeric answers. Q1 is 0-10 ("how has your coaching been"),
  -- Q2-Q4 are 1-10. CHECK constraints reject malformed payloads even if
  -- the API layer is bypassed.
  q1_overall SMALLINT NOT NULL CHECK (q1_overall BETWEEN 0 AND 10),
  q2_strength SMALLINT NOT NULL CHECK (q2_strength BETWEEN 1 AND 10),
  q3_adherence SMALLINT NOT NULL CHECK (q3_adherence BETWEEN 1 AND 10),
  q4_progress SMALLINT NOT NULL CHECK (q4_progress BETWEEN 1 AND 10),
  -- Optional free-text. Capped at 4000 chars in the API but no DB limit.
  q5_open_response TEXT,
  -- Pre-computed 0..100 score = round((q1+q2+q3+q4)/4 * 10). Stored to
  -- keep the Coach Performance boost calc cheap and to simplify the
  -- low-score (<50) Slack trigger.
  score_0_100 SMALLINT NOT NULL CHECK (score_0_100 BETWEEN 0 AND 100),
  -- Captured for abuse forensics + IP rate limiting. Not shown in UI.
  ip_address TEXT,
  user_agent TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default ordering: most recent first (the Client Progress tab default sort)
CREATE INDEX IF NOT EXISTS idx_client_check_ins_submitted_at
  ON public.client_check_ins (submitted_at DESC);

-- Per-client lookups for detail-view + per-client 24h rate-limit check
CREATE INDEX IF NOT EXISTS idx_client_check_ins_client_id_submitted
  ON public.client_check_ins (client_id, submitted_at DESC);

-- Per-coach aggregation for Coach Performance boost
CREATE INDEX IF NOT EXISTS idx_client_check_ins_coach_name
  ON public.client_check_ins (coach_name);

-- IP rate-limiting lookup (3 per hour per IP, mirroring testimonial_leads)
CREATE INDEX IF NOT EXISTS idx_client_check_ins_ip_recent
  ON public.client_check_ins (ip_address, submitted_at DESC);

COMMENT ON TABLE public.client_check_ins IS
  'Public-form bi-weekly client self-check-in submissions. RLS-locked: no anon SELECT. Coaches paste the /check-in URL to clients via Everfit.';

COMMENT ON COLUMN public.client_check_ins.score_0_100 IS
  'Program Effectiveness Score, computed server-side at insert as round((q1+q2+q3+q4)/4 * 10). Single-form scores < 50 trigger a Slack DM to Saeed.';

COMMENT ON COLUMN public.client_check_ins.coach_name IS
  'Snapshot of clients.coach_name at submission time. Coach Performance boost averages over this column, so reassigning a client later does not retroactively credit a different coach.';

-- Row Level Security: anon CANNOT read submissions (sensitive client
-- self-reported data). Service role bypasses RLS for the API routes.
ALTER TABLE public.client_check_ins ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policy = no anon access of any kind.

COMMIT;
