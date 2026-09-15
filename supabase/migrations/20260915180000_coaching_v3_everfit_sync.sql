-- Coaching V3 Everfit sync tables (2026-09-15).
--
-- Design intent (see MAS + Alex "subtract not add" spec, 2026-09-15): a fast
-- daily JSON upload for ~300 clients that only carries the numbers Coaching V3
-- actually renders at a glance. Message text and detailed context stay in the
-- existing everfit_inbox_* tables (populated by the Chrome extension sync); the
-- V3 sync is a lightweight overlay that keeps the "who needs a human today"
-- signals fresh without paying to scrape 7 days of message bodies.
--
-- Two tables:
--   * everfit_v3_snapshots — one row per upload. Holds the raw JSON blob so
--     we can audit what a given day's Codex run looked like and re-derive
--     state if the parser changes. Small (~45KB per snapshot for 300 clients).
--   * everfit_v3_client_state — one row per Everfit client id, upserted from
--     the latest snapshot. Coaching V3 reads from here at render time.
--
-- Matching to CCOS clients: on ingest we try to link each Everfit row to a
-- clients.id by (coach + name), case-insensitive trimmed. We store both the
-- link and the raw everfit_id so an unmatched row still survives and can be
-- reconciled later (e.g. a rename).

BEGIN;

CREATE TABLE IF NOT EXISTS public.everfit_v3_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  captured_at    TIMESTAMPTZ NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by    TEXT        NOT NULL,
  clients_count  INTEGER     NOT NULL DEFAULT 0,
  matched_count  INTEGER     NOT NULL DEFAULT 0,
  document       JSONB       NOT NULL,
  source_hash    TEXT        NOT NULL
);

-- Same JSON uploaded twice does not create a second snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS everfit_v3_snapshots_source_hash_key
  ON public.everfit_v3_snapshots (source_hash);

CREATE INDEX IF NOT EXISTS everfit_v3_snapshots_uploaded_at_idx
  ON public.everfit_v3_snapshots (uploaded_at DESC);

COMMENT ON TABLE public.everfit_v3_snapshots IS
  'Audit trail of Coaching V3 Everfit sync uploads. document JSONB holds the raw payload; upserts to everfit_v3_client_state happen on insert.';

CREATE TABLE IF NOT EXISTS public.everfit_v3_client_state (
  everfit_id              TEXT PRIMARY KEY,
  name                    TEXT        NOT NULL,
  coach_name              TEXT,
  client_id               BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
  workouts_completed_7d   INTEGER,
  workouts_assigned_7d    INTEGER,
  client_replies_7d       INTEGER,
  activity_7d             INTEGER,
  last_client_message_at  TIMESTAMPTZ,
  last_coach_message_at   TIMESTAMPTZ,
  summary                 TEXT,
  captured_at             TIMESTAMPTZ NOT NULL,
  snapshot_id             BIGINT REFERENCES public.everfit_v3_snapshots(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS everfit_v3_client_state_client_id_idx
  ON public.everfit_v3_client_state (client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS everfit_v3_client_state_coach_name_idx
  ON public.everfit_v3_client_state (coach_name);

COMMENT ON TABLE public.everfit_v3_client_state IS
  'Latest lightweight Everfit signals per client, upserted from V3 sync snapshots. Coaching V3 reads directly from this table.';

COMMIT;
