-- Coaching V3: weekly sheet reports (2026-09-15, evening).
--
-- The V3 sync source is moving from a Codex-generated JSON to a weekly
-- Google Sheet MAS's assistant maintains ("Admin Everfit Client Reports").
-- The sheet has one tab per coach, structured as:
--   Sr | Client Name | End Date | Week 9/14 | Percentage % | Notes |
--     Week 9/07 | Percentage % | Notes | ... (older weeks to the right)
--
-- New tables:
--   * everfit_v3_sheet_snapshots — one row per sheet pull. Holds the raw
--     parsed payload for audit and re-derivation.
--   * everfit_v3_weekly_reports — one row per (client, week). Stores the
--     workout percentage and the assistant's note for that week.
--
-- The existing everfit_v3_client_state stays as the "latest state" table,
-- fed from the LATEST week's row per client on every pull.

BEGIN;

CREATE TABLE IF NOT EXISTS public.everfit_v3_sheet_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  pulled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pulled_by      TEXT        NOT NULL,
  spreadsheet_id TEXT        NOT NULL,
  tabs_read      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  rows_ingested  INTEGER     NOT NULL DEFAULT 0,
  clients_seen   INTEGER     NOT NULL DEFAULT 0,
  errors         JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS everfit_v3_sheet_snapshots_pulled_at_idx
  ON public.everfit_v3_sheet_snapshots (pulled_at DESC);

CREATE TABLE IF NOT EXISTS public.everfit_v3_weekly_reports (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name     TEXT        NOT NULL,
  coach_name      TEXT        NOT NULL,
  end_date        DATE,
  week_label      TEXT        NOT NULL,      -- e.g. "9/14"
  week_ending_at  DATE        NOT NULL,      -- parsed from week_label
  workout_pct     NUMERIC(5,2),              -- 0..100 or NULL
  note            TEXT,
  snapshot_id     BIGINT REFERENCES public.everfit_v3_sheet_snapshots(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (client_name, coach, week). Upserts overwrite pct/note when the
-- same week is uploaded again (say, corrections). Kept keyed on client_name
-- rather than client_id so unmatched sheet rows still land and can be
-- reconciled later.
CREATE UNIQUE INDEX IF NOT EXISTS everfit_v3_weekly_reports_unique
  ON public.everfit_v3_weekly_reports (LOWER(TRIM(client_name)), LOWER(TRIM(coach_name)), week_label);

CREATE INDEX IF NOT EXISTS everfit_v3_weekly_reports_client_id_idx
  ON public.everfit_v3_weekly_reports (client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS everfit_v3_weekly_reports_coach_week_idx
  ON public.everfit_v3_weekly_reports (coach_name, week_ending_at DESC);

COMMENT ON TABLE public.everfit_v3_weekly_reports IS
  'Per-client per-week rows parsed from the Admin Everfit Client Reports Google Sheet. Workout percentage and assistant note. The latest week per client feeds everfit_v3_client_state at pull time.';

COMMIT;
