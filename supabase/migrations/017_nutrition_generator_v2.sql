-- 017_nutrition_generator_v2.sql
-- Nutrition Generator v2.0 — architectural overhaul support columns.
--
-- Scope:
--   Adds columns to the existing `nutrition_meal_plans` table so the new
--   four-layer generator (build spec → distribution → restrictions → MILP solver)
--   can record its inputs, outputs, version chain, and audit results.
--
-- Guarantees (per Plan A):
--   [X] Forward-only. No DROP, no RENAME, no destructive ops.
--   [X] Every new column is nullable OR has a safe default.
--   [X] Existing rows backfill cleanly:
--         version_number        → default 1
--         superseded_by_plan_id → default NULL (every existing row is a head)
--         allergy_flags         → default '{}'
--         medical_flags         → default '{}'
--         confirmed_by_coach    → default false
--         all other new cols    → NULL
--   [X] CHECK constraints use NOT VALID so they never reject existing rows.
--   [X] No foreign-key drops. New self-FK on superseded_by_plan_id is added
--       only if it doesn't exist (DO block).
--   [X] Idempotent: ADD COLUMN IF NOT EXISTS throughout.
--
-- Out of scope (per "do not migrate old plans"):
--   - No rewrite of plan_data JSONB on existing rows.
--   - No attempt to infer build_type / distribution_template from old plans.
--   - Old `version` column left untouched. New code writes both `version`
--     and `version_number` in lockstep during transition; later migration
--     can drop `version` once no readers remain.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Append-only version chain
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS superseded_by_plan_id BIGINT NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS reason_for_generation TEXT NULL;

-- Self-referential FK added separately so we can guard with IF NOT EXISTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nmp_superseded_by_fk'
      AND conrelid = 'public.nutrition_meal_plans'::regclass
  ) THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_superseded_by_fk
      FOREIGN KEY (superseded_by_plan_id)
      REFERENCES public.nutrition_meal_plans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Build + distribution + restriction metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS build_type TEXT NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS distribution_template TEXT NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS allergy_flags TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS medical_flags TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS dietary_style TEXT NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS plan_complexity TEXT NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS solver_bias TEXT NULL;

-- ---------------------------------------------------------------------------
-- 3. Solver + audit outputs
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS solver_feasibility TEXT NULL;
  -- 'feasible' | 'infeasible' | 'warn'

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS solver_messages JSONB NULL;
  -- array of structured messages: [{severity, code, message, ...}]

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS audit_results JSONB NULL;
  -- results of the 8 post-solver safety checks

-- ---------------------------------------------------------------------------
-- 4. Coach confirmation gate (v1 lock before v2+ pre-population)
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS confirmed_by_coach BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT NULL;

-- ---------------------------------------------------------------------------
-- 5. Rest-day targets (Endurance only; other builds leave NULL)
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS rest_day_calories INTEGER NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS rest_day_protein_g INTEGER NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS rest_day_carbs_g INTEGER NULL;

ALTER TABLE public.nutrition_meal_plans
  ADD COLUMN IF NOT EXISTS rest_day_fat_g INTEGER NULL;

-- ---------------------------------------------------------------------------
-- 6. Input weight snapshot (for audit / prior-state diff on v2+)
-- ---------------------------------------------------------------------------
-- NOTE: `weight_kg` already exists on the table. Adding a second column
-- for explicit "weight used at generation time" is redundant; we reuse
-- the existing column. Noted here for future reviewers.

-- ---------------------------------------------------------------------------
-- 7. Value validation (CHECK constraints as NOT VALID — don't reject legacy rows)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nmp_build_type_check') THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_build_type_check
      CHECK (build_type IS NULL OR build_type IN (
        'recomp','shred','bulk','lean_gain','endurance','maintain'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nmp_distribution_template_check') THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_distribution_template_check
      CHECK (distribution_template IS NULL OR distribution_template IN (
        'standard_3_meal',
        'lunch_centered_3_meal',
        'standard_4_meal',
        'athlete_5_meal',
        'bodybuilder_6_meal',
        'endurance_5_meal_training_day',
        'endurance_3_meal_rest_day'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nmp_dietary_style_check') THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_dietary_style_check
      CHECK (dietary_style IS NULL OR dietary_style IN (
        'omnivore','vegetarian','pescatarian','vegan'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nmp_plan_complexity_check') THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_plan_complexity_check
      CHECK (plan_complexity IS NULL OR plan_complexity IN (
        'beginner','intermediate','advanced'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nmp_solver_bias_check') THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_solver_bias_check
      CHECK (solver_bias IS NULL OR solver_bias IN (
        'volume','neutral','density'
      )) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nmp_solver_feasibility_check') THEN
    ALTER TABLE public.nutrition_meal_plans
      ADD CONSTRAINT nmp_solver_feasibility_check
      CHECK (solver_feasibility IS NULL OR solver_feasibility IN (
        'feasible','infeasible','warn'
      )) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Indexes for common lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nmp_client_version_number
  ON public.nutrition_meal_plans (client_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_nmp_superseded_by
  ON public.nutrition_meal_plans (superseded_by_plan_id)
  WHERE superseded_by_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nmp_head_of_chain
  ON public.nutrition_meal_plans (client_id)
  WHERE superseded_by_plan_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_nmp_confirmed
  ON public.nutrition_meal_plans (client_id, confirmed_by_coach)
  WHERE confirmed_by_coach = true;

-- ---------------------------------------------------------------------------
-- 9. Documentation
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.nutrition_meal_plans.version_number IS
  'Append-only per-client version counter. v2 generator writes this; legacy `version` column kept for transition.';
COMMENT ON COLUMN public.nutrition_meal_plans.superseded_by_plan_id IS
  'Points to the newer plan that replaces this one. NULL = active head of chain.';
COMMENT ON COLUMN public.nutrition_meal_plans.reason_for_generation IS
  'Free-text coach note: why this version was created (e.g. "weight check-in", "allergy update", "client feedback").';
COMMENT ON COLUMN public.nutrition_meal_plans.build_type IS
  'One of: recomp|shred|bulk|lean_gain|endurance|maintain. Matches src/lib/nutrition/v2/builds/*.';
COMMENT ON COLUMN public.nutrition_meal_plans.distribution_template IS
  'One of 7 meal distribution templates. Matches src/lib/nutrition/v2/distributions/*.';
COMMENT ON COLUMN public.nutrition_meal_plans.allergy_flags IS
  'Array of allergy/intolerance slugs. See src/lib/nutrition/v2/allergies/*.';
COMMENT ON COLUMN public.nutrition_meal_plans.medical_flags IS
  'Array of medical flag slugs. Some require coach acknowledgement before generation. See src/lib/nutrition/v2/medical/*.';
COMMENT ON COLUMN public.nutrition_meal_plans.dietary_style IS
  'omnivore|vegetarian|pescatarian|vegan.';
COMMENT ON COLUMN public.nutrition_meal_plans.plan_complexity IS
  'beginner(5)|intermediate(7)|advanced(10) ingredients/meal cap. Enforced by MILP solver.';
COMMENT ON COLUMN public.nutrition_meal_plans.solver_bias IS
  'MILP tiebreaker: volume|neutral|density.';
COMMENT ON COLUMN public.nutrition_meal_plans.solver_feasibility IS
  'Solver outcome: feasible|infeasible|warn. Drives UI banner.';
COMMENT ON COLUMN public.nutrition_meal_plans.solver_messages IS
  'Structured messages (infeasibility reasons, binding constraints, recommendations).';
COMMENT ON COLUMN public.nutrition_meal_plans.audit_results IS
  'Post-solver safety audit: array of 8 deterministic check results.';
COMMENT ON COLUMN public.nutrition_meal_plans.confirmed_by_coach IS
  'v1 must be confirmed before v2+ can pre-populate from prior state.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-migration verification (run manually after applying):
--
--   -- Every existing row should have version_number = 1 and no supersedor:
--   SELECT COUNT(*) AS legacy_rows
--     FROM public.nutrition_meal_plans
--     WHERE version_number = 1 AND superseded_by_plan_id IS NULL;
--
--   -- No CHECK constraint violations on existing rows (all new cols are NULL):
--   SELECT COUNT(*) FROM public.nutrition_meal_plans
--     WHERE build_type IS NOT NULL OR distribution_template IS NOT NULL;
--   -- Expected: 0 until v2 generator starts writing.
--
--   -- Index sanity:
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'nutrition_meal_plans'
--       AND indexname LIKE 'idx_nmp_%';
-- ---------------------------------------------------------------------------
