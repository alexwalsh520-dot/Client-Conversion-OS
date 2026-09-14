-- Retentions feature (2026-09-15).
--
-- A "retention window" is derived state: active clients whose program end_date
-- is <= today + 14 days, INCLUDING any negative days_remaining (the client is
-- already past their end date but is still 'active' because the coach hasn't
-- explicitly closed them out). Once a client enters the window, they stay in
-- it until:
--   * marked as opportunity lost  -> outcome='opp_lost', clients.status='completed'
--   * retained for 4 weeks         -> outcome='retained_4wk',  end_date=MAX(end_date,today)+28
--   * retained for 12 weeks        -> outcome='retained_12wk', end_date=MAX(end_date,today)+84
--
-- retention_cycles: one row per time a client enters the retention window. A
-- cycle is "open" while outcome IS NULL. If the same client re-enters the
-- window later (e.g. a retained client whose new end_date approaches), a NEW
-- cycle is opened -- the previous cycle's notes stay attached to it as
-- history, but the new cycle starts clean.
--
-- retention_notes: notes attached to a cycle. Two sources:
--   'chat_batch' — pasted into the global chat box; the same batch_id fans
--                  out to every currently-open cycle in scope.
--   'manual'    — added on a single client card by the coach or by MAS.
-- Notes belong to the cycle, so as soon as a cycle closes, those notes stop
-- appearing on the "current" retention view. Next cycle starts empty.
--
-- Backfill: on migration apply, open a cycle for every currently-active
-- client whose end_date <= today+14. This matches MAS's ask to seed the
-- system with September clients + anything within 15 days of today.

BEGIN;

CREATE TABLE IF NOT EXISTS public.retention_cycles (
  id                  BIGSERIAL PRIMARY KEY,
  client_id           BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entered_window_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date_at_entry   DATE NOT NULL,
  outcome             TEXT CHECK (outcome IN ('opp_lost', 'retained_4wk', 'retained_12wk', 'left_window')),
  outcome_at          TIMESTAMPTZ,
  outcome_by          TEXT
);

-- Only one open cycle per client at a time. Partial index avoids duplicate
-- open cycles when the sync endpoint races or is called twice concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS retention_cycles_one_open_per_client
  ON public.retention_cycles (client_id)
  WHERE outcome IS NULL;

CREATE INDEX IF NOT EXISTS retention_cycles_client_id_idx
  ON public.retention_cycles (client_id);

CREATE INDEX IF NOT EXISTS retention_cycles_outcome_idx
  ON public.retention_cycles (outcome) WHERE outcome IS NOT NULL;

COMMENT ON TABLE public.retention_cycles IS
  'One row per time a client enters the retention window. Open while outcome IS NULL.';

CREATE TABLE IF NOT EXISTS public.retention_notes (
  id            BIGSERIAL PRIMARY KEY,
  cycle_id      BIGINT NOT NULL REFERENCES public.retention_cycles(id) ON DELETE CASCADE,
  note_text     TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('chat_batch', 'manual')),
  batch_id      UUID,
  author_email  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retention_notes_cycle_id_created_idx
  ON public.retention_notes (cycle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS retention_notes_batch_id_idx
  ON public.retention_notes (batch_id) WHERE batch_id IS NOT NULL;

COMMENT ON TABLE public.retention_notes IS
  'Notes attached to a retention cycle. Chat-box entries duplicate across all currently-open cycles via the same batch_id.';

-- ------------------------------------------------------------------
-- Backfill: open a cycle for every currently-eligible active client.
-- Uses ON CONFLICT DO NOTHING against the unique-open partial index
-- so this stays idempotent if the migration is ever re-run.
-- ------------------------------------------------------------------

INSERT INTO public.retention_cycles (client_id, end_date_at_entry, entered_window_at, outcome)
SELECT
  c.id,
  (c.end_date)::date,
  NOW(),
  NULL
FROM public.clients c
WHERE c.status = 'active'
  AND c.end_date IS NOT NULL
  AND (c.end_date)::date <= (CURRENT_DATE + INTERVAL '14 days')::date
ON CONFLICT DO NOTHING;

COMMIT;
