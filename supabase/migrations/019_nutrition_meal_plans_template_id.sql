-- 019_nutrition_meal_plans_template_id.sql
-- Phase B6a-pivot: track which deterministic meal template produced each plan.
--
-- Replacing the LLM picker (B3) with hand-authored templates means each plan
-- maps to a specific template id (e.g. "recomp_omnivore_a"). Storing this on
-- the plan row gives us:
--   - Variant rotation observability (alternation between A/B/C/...)
--   - Coach-side debugging ("this plan came from template X")
--   - Future analytics on which templates produce best client outcomes
--
-- Forward-only, nullable. Existing legacy v1 rows and any v2 rows generated
-- before the pivot stay NULL.

BEGIN;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_nmp_template_id
  ON public.nutrition_meal_plans (template_id)
  WHERE template_id IS NOT NULL;

COMMENT ON COLUMN public.nutrition_meal_plans.template_id IS
  'Identifier of the meal template that produced this plan (e.g. "recomp_omnivore_a"). NULL for legacy v1 plans and v2 plans generated before B6a-pivot.';

COMMIT;
