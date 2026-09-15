-- Follow-up to 20260915200000. Supabase's client-side upsert with the option
-- { onConflict: "client_name,coach_name,week_label" } needs a plain-column
-- unique constraint on those columns, not a functional expression index. The
-- original migration used LOWER(TRIM(...)) which yields "there is no unique
-- or exclusion constraint matching the ON CONFLICT specification" at runtime.
--
-- Fix: replace the functional index with a plain UNIQUE constraint. The sheet
-- is self-consistent in spelling within one tab, so case-sensitive uniqueness
-- is fine in practice.

BEGIN;

DROP INDEX IF EXISTS public.everfit_v3_weekly_reports_unique;

ALTER TABLE public.everfit_v3_weekly_reports
  DROP CONSTRAINT IF EXISTS everfit_v3_weekly_reports_uniq;

ALTER TABLE public.everfit_v3_weekly_reports
  ADD CONSTRAINT everfit_v3_weekly_reports_uniq
  UNIQUE (client_name, coach_name, week_label);

COMMIT;
