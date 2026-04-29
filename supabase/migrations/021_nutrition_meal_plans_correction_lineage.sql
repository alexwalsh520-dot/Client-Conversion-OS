-- 021_nutrition_meal_plans_correction_lineage.sql
-- Phase B6b — coach UI affordances:
--   parent_plan_id     : self-FK so a coach-corrected version (via the
--                        Claude.ai roundtrip) can be linked to its
--                        predecessor for analytics + history rendering.
--   manual_completion  : true iff the coach used "Handle manually & mark
--                        Done" from State 4 (system couldn't generate a
--                        valid plan; coach is delivering their own). UI
--                        shows a "manual" badge on these rows in the Done
--                        column. Captures audit trail of automated-path
--                        failures.
--
-- Forward-only, all defaults safe.

BEGIN;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS parent_plan_id BIGINT
    REFERENCES public.nutrition_meal_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_completion BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_nmp_parent_plan_id
  ON public.nutrition_meal_plans (parent_plan_id)
  WHERE parent_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nmp_manual_completion
  ON public.nutrition_meal_plans (manual_completion)
  WHERE manual_completion = true;

COMMENT ON COLUMN public.nutrition_meal_plans.parent_plan_id IS
  'When this row is a coach-corrected version of an earlier plan (via the Claude.ai handoff loop), points to the original plan_id. NULL for first-generation plans.';

COMMENT ON COLUMN public.nutrition_meal_plans.manual_completion IS
  'True iff the coach used "Handle manually & mark Done" from State 4 — i.e., the automated pipeline could not produce a valid plan and the coach delivered their own outside the system. Used for analytics on automated-path failure rate.';

COMMIT;
