-- 029_daily_coacher_scoring.sql
-- Infrastructure for the Daily Coacher Usage Score that surfaces on the
-- Coach Performance tab.
--
-- Two pieces:
--   1. Table `daily_coacher_tip_uses` — records each time a coach copies
--      a generated draft to the clipboard. Generation alone doesn't count;
--      the Copy button being pressed is the credit-eligible event.
--   2. Trigger on `clients` — auto-inserts a `client_notes` row attributed
--      to "Admin" when a client's coach assignment changes between two
--      named coaches. The auto-note naturally counts toward the new
--      coach's score (because the score formula counts client_notes rows).
--
-- The score formula itself lives in app code (src/lib/data.ts /
-- coach-scores). It joins this table + client_notes + coach_meetings to
-- compute per-client and per-coach scores.

BEGIN;

-- ============================================================
-- daily_coacher_tip_uses: one row per Copy-button press
-- ============================================================
CREATE TABLE IF NOT EXISTS public.daily_coacher_tip_uses (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  -- Whoever was logged in when Copy happened. Used for audit only;
  -- score attribution always flows to the client's assigned coach
  -- (clients.coach_name), not this column.
  copied_by_coach TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_coacher_tip_uses_client
  ON public.daily_coacher_tip_uses (client_id);

COMMENT ON TABLE public.daily_coacher_tip_uses IS
  'Daily Coacher: one row per Copy-button press in the DraftPanel. Drives the Daily Coacher Usage Score on the Coach Performance tab. Generation events alone do NOT log here; only successful copy-to-clipboard does.';

COMMENT ON COLUMN public.daily_coacher_tip_uses.copied_by_coach IS
  'Audit field: the logged-in coach when the Copy happened. Score attribution flows to the client''s assigned coach (clients.coach_name), not this field.';

-- ============================================================
-- Trigger: auto-note on coach reassignment
-- ============================================================
-- Fires only when both old and new coach are non-empty and different.
-- Skips initial assignment (NULL → name) and unassignment (name → NULL).
-- The auto-note inserted here counts toward the new coach's score
-- naturally because client_notes rows feed the score formula.

CREATE OR REPLACE FUNCTION public.daily_coacher_log_coach_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.coach_name IS NOT NULL
     AND NEW.coach_name IS NOT NULL
     AND OLD.coach_name <> ''
     AND NEW.coach_name <> ''
     AND OLD.coach_name <> NEW.coach_name
  THEN
    INSERT INTO public.client_notes (client_name, coach_name, note)
    VALUES (
      NEW.name,
      'Admin',
      'Coach reassigned from ' || OLD.coach_name || ' to ' || NEW.coach_name
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_coacher_log_coach_change ON public.clients;

CREATE TRIGGER trg_daily_coacher_log_coach_change
AFTER UPDATE OF coach_name ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.daily_coacher_log_coach_change();

COMMENT ON FUNCTION public.daily_coacher_log_coach_change IS
  'Daily Coacher: auto-creates a client_notes row when a client''s coach is reassigned between two named coaches. Note is attributed to "Admin" and counts toward the new coach''s Daily Coacher Usage Score automatically.';

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.daily_coacher_tip_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"
  ON public.daily_coacher_tip_uses FOR SELECT USING (true);

COMMIT;
