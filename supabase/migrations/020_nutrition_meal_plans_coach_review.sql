-- 020_nutrition_meal_plans_coach_review.sql
-- Phase B6a-pivot Option 4: ship-the-80% with coach-assisted correction loop.
--
-- After macro-verifier + audit pass and the plan is set to ship, we run a
-- complexity detector that flags plans worth a human pass (high-cal builds,
-- macro retry fired, audit warnings, near-block sodium/anchor-frequency).
-- The coach UI surfaces a "Coach review recommended" affordance for these
-- plans and exposes a pre-rendered correction prompt the coach pastes into
-- Claude.ai.
--
-- Forward-only, all defaults safe. Existing rows get coach_review_recommended
-- = false (handled by DEFAULT) and NULL for the JSON / text columns.

BEGIN;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS coach_review_recommended BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complexity_reasons JSONB,
  ADD COLUMN IF NOT EXISTS coach_handoff_prompt TEXT;

CREATE INDEX IF NOT EXISTS idx_nmp_coach_review_recommended
  ON public.nutrition_meal_plans (coach_review_recommended)
  WHERE coach_review_recommended = true;

COMMENT ON COLUMN public.nutrition_meal_plans.coach_review_recommended IS
  'True when the complexity detector flagged this plan for human review. UI surfaces a "Coach review recommended" affordance.';

COMMENT ON COLUMN public.nutrition_meal_plans.complexity_reasons IS
  'Array of complexity reason codes (e.g. ["macro_retry_required","high_cal_build","sodium_near_ceiling"]). Reasons evolve over time; treat as opaque tags for analytics.';

COMMENT ON COLUMN public.nutrition_meal_plans.coach_handoff_prompt IS
  'Pre-rendered markdown prompt the coach can paste into Claude.ai to iterate on this plan. Always populated at plan-creation time so the coach UI can display it without re-rendering.';

COMMIT;
