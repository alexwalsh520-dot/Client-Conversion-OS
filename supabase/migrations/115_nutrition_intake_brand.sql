-- 115_nutrition_intake_brand.sql
-- Whitelabel brand identifier on nutrition intake submissions.
--
-- CCOS is the shared backend for multiple influencer coaching programs
-- (Tyson's The Forge, Recruit Ready Fitness, etc.). The intake form
-- lives at cc-intake-form.vercel.app and now supports a ?brand= query
-- parameter that swaps the visual identity per program. Every
-- submission carries a brand slug through to this column so we can
-- report on intake volume per brand and, later, route per-brand GHL
-- workflows off it.
--
-- Nullable — legacy rows (all pre-2026-08-24) and any submission via
-- the bare URL stay NULL, and the neutral confirmation-email flow
-- continues to fire off the base `ccos-intake-submitted` tag.

BEGIN;

ALTER TABLE public.nutrition_intake_forms
  ADD COLUMN IF NOT EXISTS brand TEXT;

COMMENT ON COLUMN public.nutrition_intake_forms.brand IS
  'Whitelabel brand slug (forge, rrf, ...) or NULL for default/legacy submissions.';

COMMIT;
