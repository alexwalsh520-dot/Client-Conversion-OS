-- 027_onboarding_backlog_table.sql
-- Standalone tracker for Nicole's onboarding backlog. Mirrors the columns
-- of her existing Google Sheet 1-for-1. No joins to clients — it's a
-- personal working log, edited freely, imported once from the sheet.

BEGIN;

CREATE TABLE IF NOT EXISTS public.onboarding_backlog (
  id BIGSERIAL PRIMARY KEY,
  onboarder TEXT,
  onboardee TEXT,
  email TEXT,
  closer TEXT,
  amount_paid TEXT,
  pif_status TEXT,
  reschedule_email TEXT,
  reminder_email TEXT,
  closer_reachout TEXT,
  comments TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_onboarding_backlog_sort_order
  ON public.onboarding_backlog (sort_order);

COMMENT ON TABLE public.onboarding_backlog IS
  'Nicole''s standalone onboarding backlog. Mirrors her Google Sheet. Not linked to clients table.';

COMMIT;
