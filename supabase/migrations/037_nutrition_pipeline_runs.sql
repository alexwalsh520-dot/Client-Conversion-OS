-- 037_nutrition_pipeline_runs.sql
-- Async job table for the auto meal-plan pipeline.
--
-- The pipeline is async because a single plan takes ~4 minutes
-- (Sonnet 4.5 generating ~15k tokens of meal plan + HTML→PDF render).
-- Sync request/response would time out the browser, and we want a
-- consistent shape for both the admin "test this client now"
-- trigger and the daily cron sweep that processes pending tasks.
--
-- Lifecycle:
--   queued  → row inserted, work not yet started
--   running → worker has claimed the row (set started_at)
--   done    → PDF rendered + uploaded to nutrition-auto-plans bucket;
--             signed_url + storage_path populated; Slack DM sent
--   failed  → error_message populated; Slack DM may or may not have
--             been sent depending on where it failed
--
-- The `signed_url` is the cached download URL we generate when the
-- run completes; it expires (see signed_url_expires_at) so plan
-- links posted to Slack don't stay valid forever.

BEGIN;

CREATE TABLE IF NOT EXISTS public.nutrition_pipeline_runs (
  id BIGSERIAL PRIMARY KEY,
  -- FK to clients; ON DELETE SET NULL so we keep audit history even
  -- if a client is later removed.
  client_id BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  -- 'admin_test' = manual trigger (DM Saeed when done)
  -- 'cron_auto'  = daily sweep (upload to CCOS, mark task done, post nutritiontalk)
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('admin_test', 'cron_auto')),
  triggered_by TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  storage_path TEXT,
  signed_url TEXT,
  signed_url_expires_at TIMESTAMPTZ,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_message TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nutrition_pipeline_runs_status
  ON public.nutrition_pipeline_runs (status, queued_at);

CREATE INDEX IF NOT EXISTS idx_nutrition_pipeline_runs_client_id
  ON public.nutrition_pipeline_runs (client_id, queued_at DESC);

COMMENT ON TABLE public.nutrition_pipeline_runs IS
  'Auto meal-plan pipeline jobs. Created by the admin test endpoint or the daily cron sweep. Worker picks up queued rows, runs gather→Claude→render→upload, updates status to done with storage_path + signed_url. Slack DM lands when done.';

-- Private bucket for generated PDFs. Access is via signed URLs only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('nutrition-auto-plans', 'nutrition-auto-plans', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
