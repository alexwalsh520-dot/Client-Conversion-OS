-- 117_coach_meetings_fathom.sql
-- Fathom link support on coach_meetings.
--
-- New columns:
--   fathom_link          — the Fathom recording URL for the meeting. Optional
--                          but highly encouraged; qualifies the meeting for the
--                          per-meeting score in the Sunday weekly report.
--   fathom_link_added_at — when the link was first set on this row. Meetings
--                          are eligible for the weekly score only if the link
--                          was added during that report's week window, per
--                          MAS's spec: "As long as it was added within that
--                          week, that's fine."
--
-- Uniqueness: no two meetings may share the same Fathom link. Enforced via a
-- partial unique index so multiple rows with NULL fathom_link remain valid
-- (Postgres already treats NULLs as distinct, but the partial predicate keeps
-- the index compact and the intent explicit).

BEGIN;

ALTER TABLE public.coach_meetings
  ADD COLUMN IF NOT EXISTS fathom_link TEXT,
  ADD COLUMN IF NOT EXISTS fathom_link_added_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS coach_meetings_fathom_link_unique
  ON public.coach_meetings (fathom_link)
  WHERE fathom_link IS NOT NULL;

COMMENT ON COLUMN public.coach_meetings.fathom_link IS
  'Fathom recording URL for this meeting. Optional; qualifies the meeting for the +5-per-meeting weekly score. Unique across all meetings.';
COMMENT ON COLUMN public.coach_meetings.fathom_link_added_at IS
  'When the fathom_link was first set on this row. The weekly meetings report only awards a score if this timestamp falls within its week window.';

COMMIT;
