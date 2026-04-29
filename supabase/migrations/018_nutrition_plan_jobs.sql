-- 018_nutrition_plan_jobs.sql
-- Phase B6a: queue table for the v2 nutrition generation pipeline.
--
-- The v2 pipeline takes 21–60s end-to-end (B3 picker dominates), which
-- exceeds the synchronous request budget for production-grade UX. The
-- API endpoint (POST /api/nutrition/generate-plan-v2) inserts a row here
-- and returns immediately; a cron-driven drainer worker
-- (/api/cron/nutrition-plan-drain) picks up pending jobs every minute
-- and runs the full pipeline. The UI polls
-- (GET /api/nutrition/generate-plan-v2/:jobId) until completion.
--
-- Mirrors the followup_jobs pattern from migration 011.

BEGIN;

CREATE TABLE IF NOT EXISTS public.nutrition_plan_jobs (
  id                     BIGSERIAL PRIMARY KEY,
  client_id              BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- State machine: pending | running | complete | failed | cancelled
  status                 TEXT NOT NULL DEFAULT 'pending',
  -- Granular per-stage label for UI progress display. Free-text by design
  -- so we can change the vocabulary without a migration. Examples:
  --   'loading_intake', 'calculating_macros',
  --   'picking_meals_day_3_of_7', 'auditing',
  --   'adapting_for_pdf', 'rendering_pdf', 'uploading', 'persisting'
  current_step           TEXT,

  -- POST request body, captured verbatim so the run is reproducible
  -- and the debug UI can show exactly what was submitted.
  inputs                 JSONB NOT NULL,

  -- Pipeline outputs (populated as stages complete)
  plan_id                BIGINT REFERENCES public.nutrition_meal_plans(id) ON DELETE SET NULL,
  pdf_path               TEXT,
  pdf_signed_url         TEXT,                 -- last 2-hour signed URL we issued
  audit_summary          JSONB,                -- copy of AuditResult for quick UI display

  -- Failure handling
  error_kind             TEXT,                 -- 'intake_invalid' | 'pick_error' | 'solver_infeasible' | 'audit_blocked' | 'storage_error' | 'db_error' | 'unexpected'
  error_details          JSONB,

  -- Telemetry
  attempts               INT NOT NULL DEFAULT 0,
  worker_started_at      TIMESTAMPTZ,
  worker_finished_at     TIMESTAMPTZ,
  generation_diagnostics JSONB,                -- B3 GenerationDiagnostics blob (LLM call counts, fallbacks, etc.)

  -- Cancellation tracking
  cancelled_at           TIMESTAMPTZ,

  -- Audit trail
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             TEXT                  -- session email or 'internal'
);

-- Validate the status enum-ish field at write time (NOT VALID so we
-- never reject existing rows on future migration replays).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nutrition_plan_jobs_status_check') THEN
    ALTER TABLE public.nutrition_plan_jobs
      ADD CONSTRAINT nutrition_plan_jobs_status_check
      CHECK (status IN ('pending','running','complete','failed','cancelled'))
      NOT VALID;
  END IF;
END $$;

-- Cron drainer query path: find oldest pending job(s) cheaply.
CREATE INDEX IF NOT EXISTS nutrition_plan_jobs_pending_idx
  ON public.nutrition_plan_jobs (created_at)
  WHERE status = 'pending';

-- UI listing path: most recent jobs for a given client.
CREATE INDEX IF NOT EXISTS nutrition_plan_jobs_client_idx
  ON public.nutrition_plan_jobs (client_id, created_at DESC);

-- Stale-job watchdog: jobs stuck in 'running' for too long (worker died mid-run).
CREATE INDEX IF NOT EXISTS nutrition_plan_jobs_running_idx
  ON public.nutrition_plan_jobs (worker_started_at)
  WHERE status = 'running';

-- Auto-update updated_at on every row write.
CREATE OR REPLACE FUNCTION public.nutrition_plan_jobs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nutrition_plan_jobs_updated_at_trg ON public.nutrition_plan_jobs;
CREATE TRIGGER nutrition_plan_jobs_updated_at_trg
  BEFORE UPDATE ON public.nutrition_plan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.nutrition_plan_jobs_set_updated_at();

-- Field comments for future devs.
COMMENT ON TABLE public.nutrition_plan_jobs IS
  'Queue for the v2 nutrition generator pipeline. Inserts come from POST /api/nutrition/generate-plan-v2; processed by /api/cron/nutrition-plan-drain.';
COMMENT ON COLUMN public.nutrition_plan_jobs.current_step IS
  'Granular pipeline-stage label for UI polling. Updated transiently as the worker progresses.';
COMMENT ON COLUMN public.nutrition_plan_jobs.inputs IS
  'Original POST body — build_type, allergy_flags, medical_flags, dietary_style, plan_complexity, distribution_template, custom day kinds, etc.';
COMMENT ON COLUMN public.nutrition_plan_jobs.audit_summary IS
  'Copy of B4 AuditResult for fast UI rendering. The full audit is also stored in nutrition_meal_plans.audit_results.';
COMMENT ON COLUMN public.nutrition_plan_jobs.error_kind IS
  'Structured failure category. Always populated when status=failed.';
COMMENT ON COLUMN public.nutrition_plan_jobs.cancelled_at IS
  'When the coach cancelled this job. NULL otherwise.';

COMMIT;

-- Post-migration verification queries (run manually after applying):
--   SELECT COUNT(*) FROM nutrition_plan_jobs;          -- Should be 0
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'nutrition_plan_jobs';
--   -- Expected: 4 indexes (pkey + 3 created above)
