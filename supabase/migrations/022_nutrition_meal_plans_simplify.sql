-- 022_nutrition_meal_plans_simplify.sql
-- Phase B6c — rip out v2 in-app generation. Coaches now paste intake
-- into Claude.ai and upload the resulting PDF directly. The complex
-- coach-review affordances (handoff prompt, correction lineage,
-- manual_completion) no longer apply.
--
-- Forward-only. Existing PDFs untouched (pdf_path stays canonical).
-- Adds:
--   uploaded_pdf_path : mirrors pdf_path for coach-uploaded plans;
--                       presence flags "this row was a manual upload"
--                       for analytics + UI badge.
--   uploaded_by       : coach email (NextAuth session user)
-- Drops:
--   coach_review_recommended, complexity_reasons, coach_handoff_prompt,
--   parent_plan_id, manual_completion (B6a-pivot Option 4 / B6b columns)
-- Drops table:
--   nutrition_plan_jobs (queue for the dead worker)

BEGIN;

ALTER TABLE public.nutrition_meal_plans
  DROP COLUMN IF EXISTS coach_review_recommended,
  DROP COLUMN IF EXISTS complexity_reasons,
  DROP COLUMN IF EXISTS coach_handoff_prompt,
  DROP COLUMN IF EXISTS parent_plan_id,
  DROP COLUMN IF EXISTS manual_completion;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS uploaded_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

DROP INDEX IF EXISTS idx_nmp_coach_review_recommended;
DROP INDEX IF EXISTS idx_nmp_parent_plan_id;
DROP INDEX IF EXISTS idx_nmp_manual_completion;

CREATE INDEX IF NOT EXISTS idx_nmp_uploaded_pdf_path
  ON public.nutrition_meal_plans (client_id, created_at DESC)
  WHERE uploaded_pdf_path IS NOT NULL;

COMMENT ON COLUMN public.nutrition_meal_plans.uploaded_pdf_path IS
  'Mirrors pdf_path for coach-uploaded plans (B6c flow). Presence flags this row as a manual upload — coach pasted intake into Claude.ai, got a PDF back, uploaded it here. NULL for v1 auto-generated plans.';

COMMENT ON COLUMN public.nutrition_meal_plans.uploaded_by IS
  'Coach email (NextAuth session user) who uploaded the PDF. NULL for v1 auto-generated plans.';

DROP TABLE IF EXISTS public.nutrition_plan_jobs;

COMMIT;
