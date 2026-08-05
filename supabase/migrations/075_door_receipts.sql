-- 075_door_receipts.sql
-- TRUTH LAYER, Brick 2: ANSWER RECEIPTS + DOOR PLUMBING.
--
-- Brick 1 gave the door registries to resolve names against. Brick 2 makes the
-- door's ANSWER carry its own proof: what it covered, what it left out, how
-- fresh it was, and how certain it is. Plus a persistent record of every
-- question the door refused, which becomes the certification backlog.
--
-- The concrete failure this kills: an AI reported "100% attribution coverage"
-- because its hand-written query silently excluded 26 unassigned wins worth
-- $31,395. With a coverage block on the answer itself, the answer would have
-- said "40 of 66 wins classified; 26 awaiting review, $31,395" and no reader
-- would have had to trust the AI that carried it.
--
-- Four things here:
--   1. door_miss_log             every refusal, so misses become a backlog
--   2. door_ask_log              every answered ask, so usage is a record
--   3. door_freshness_thresholds when a source counts as stale (ops-tunable)
--   4. door_coverage_block()     the ONE tested coverage read every money
--                                answer shares
--
-- Additive only. Nothing existing is altered or dropped.
-- Idempotent: safe to run twice.
--
-- RLS posture mirrors the other internal tables (registry_*, factory_items):
-- RLS ON, no anon policies. Reads and writes go through service-role paths.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. THE MISS LOG. Every question the door refused.
--
-- This is not an error table. A refusal is the door working correctly. The
-- log exists because the SAME refused question asked twenty times is the
-- clearest possible signal of what to certify next, and that signal was being
-- thrown away every time the response was returned.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.door_miss_log (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the caller asked for, exactly as it arrived.
  asked    TEXT,
  params   JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Who asked: utari, mcp, app, accuracy, test, or an unknown caller.
  caller   TEXT,
  -- The written reason, the same sentence the caller received.
  reason   TEXT,
  -- The nearest allowed questions the door offered instead.
  nearest  JSONB NOT NULL DEFAULT '[]'::JSONB,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.door_miss_log IS
  'TRUTH LAYER Brick 2. One row per refused question. The certification backlog: what callers keep asking that the door cannot yet answer.';
COMMENT ON COLUMN public.door_miss_log.asked IS
  'The question key or free text the caller sent, echoed exactly. Never normalized on write; describeMisses groups on read.';

ALTER TABLE public.door_miss_log ENABLE ROW LEVEL SECURITY;

-- The two reads this table gets: newest first, and grouped by what was asked.
CREATE INDEX IF NOT EXISTS door_miss_log_asked_at_idx
  ON public.door_miss_log (asked_at DESC);
CREATE INDEX IF NOT EXISTS door_miss_log_asked_idx
  ON public.door_miss_log (LOWER(TRIM(asked)));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE ASK LOG. Every question the door ANSWERED.
--
-- The usage record the scorecard and the weekly miss-log review read. Without
-- it, "which certified questions actually get used" is a guess, and a question
-- nobody asks is a maintenance cost nobody is paying attention to.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.door_ask_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key TEXT,
  params       JSONB NOT NULL DEFAULT '{}'::JSONB,
  caller       TEXT,
  -- FALSE covers a question that IS on the list but failed or was refused on
  -- its parameters. Those are also written here, so the ask log is the
  -- complete picture of what the door was put through.
  ok           BOOLEAN NOT NULL,
  ms           INT,
  asked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.door_ask_log IS
  'TRUTH LAYER Brick 2. One row per ask that named a real question, answered or not. The usage record behind the scorecard.';

ALTER TABLE public.door_ask_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS door_ask_log_asked_at_idx
  ON public.door_ask_log (asked_at DESC);
CREATE INDEX IF NOT EXISTS door_ask_log_question_idx
  ON public.door_ask_log (question_key, asked_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. FRESHNESS THRESHOLDS. When a source counts as stale.
--
-- These are OPERATIONAL values, not signed definitions. They are how often a
-- pipe is expected to run, which changes when a cron changes. They live in a
-- table precisely so tuning one never needs a code change, a deploy, or an
-- owner signature. A signed definition is a promise about meaning; this is a
-- setting about cadence, and conflating the two would cheapen the registry.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.door_freshness_thresholds (
  source          TEXT PRIMARY KEY,
  threshold_hours INT  NOT NULL CHECK (threshold_hours > 0),
  note            TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.door_freshness_thresholds IS
  'TRUTH LAYER Brick 2. How old a source may be before an answer calls it stale. Operational cadence values, deliberately NOT signed definitions, so ops can tune them without a deploy.';

ALTER TABLE public.door_freshness_thresholds ENABLE ROW LEVEL SECURITY;

-- Seed. ON CONFLICT DO NOTHING on purpose: a value an operator has already
-- tuned is never stamped back to the default by re-running this migration.
INSERT INTO public.door_freshness_thresholds (source, threshold_hours, note) VALUES
  ('warehouse.answers',        26, 'the saved window answers; the tab rebuilds them through the day, and a full day plus a margin means a whole cycle was missed'),
  ('adsv2_sale_facts',          4, 'the stamped sale facts, rewritten on roughly a three hour sync cadence'),
  ('adsv2_dm_facts',            4, 'the stamped DM facts, rewritten on roughly a three hour sync cadence'),
  ('adsv2_booking_facts',       4, 'the stamped booking facts, rewritten on roughly a three hour sync cadence'),
  ('ads_meta_insights_daily',   6, 'the last time Meta spend landed'),
  ('sales_tracker_rows',       24, 'the sales tracker sync; a day old is normal, more than a day is not'),
  ('dm_conversation_messages',  6, 'the raw DM capture'),
  ('warehouse.ads',             6, 'the merged ads table, refreshed hourly'),
  ('warehouse.people',          6, 'the merged people table, refreshed hourly'),
  ('warehouse.ad_changes',     26, 'the ad change log; a quiet day genuinely has no changes, so this is deliberately loose'),
  ('warehouse.definitions',   168, 'the definitions are rewritten from the code registry and change rarely by design'),
  ('warehouse.accuracy_checks', 26, 'the daily accuracy run')
ON CONFLICT (source) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. THE COVERAGE BLOCK. One tested read, shared by every money answer.
--
-- The four buckets are signed (registry_definitions: certainty_buckets v1,
-- coverage v1). This function is the ONLY implementation of them, so a bucket
-- can never mean one thing in one answer and something else in another.
--
-- ── THE THING THAT MAKES THIS FUNCTION WORTH HAVING ──────────────────────
-- Every awaiting-review win in this database carries client_key = NULL. That
-- is correct: nobody has looked at the row yet, so the engine refuses to guess
-- whose it is. But it means a coverage read filtered to "tyson" would find
-- ZERO awaiting-review wins and report 100% coverage, every single time.
-- That is EXACTLY the false 100% this brick exists to kill, rebuilt inside the
-- fix meant to prevent it.
--
-- So: the classified buckets are filtered to the clients asked about, and the
-- awaiting-review bucket ALWAYS includes the client-less pool for the window.
-- Those wins have no creator on them precisely because they are unclassified,
-- and they are the gap whoever is asking needs to see. The note on the answer
-- says so in plain words rather than leaving the reader to work it out.
--
-- ── BUCKET PRIORITY ──────────────────────────────────────────────────────
-- Rows can satisfy more than one rule, so priority is fixed and explicit:
--   1. AWAITING REVIEW  nobody has looked; this is the honest gap
--   2. ORGANIC          is_organic, OR the keyword is in the organic registry
--   3. AD               a keyword and not organic
--   4. MISC CHAT        no keyword, and the team's own callType label
-- Organic is tested BEFORE ad on purpose: a marked organic keyword whose
-- is_organic flag has not been set would otherwise be counted as an ad sale
-- and quietly enter ad ROAS, which organic_keywords v1 forbids.
--
-- Awaiting review beats misc chat, per the Brick 2 spec, so the overlap can
-- never flatter coverage. The overlap is COUNTED and returned rather than
-- resolved here: fixing it belongs to the labeler, not to a read path.
--
-- SECURITY DEFINER because the app reaches these tables through functions
-- only. STABLE because it reads and never writes. One pass, index-backed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS adsv2_sale_facts_win_day_idx
  ON public.adsv2_sale_facts (sale_et_day)
  WHERE is_win;

CREATE OR REPLACE FUNCTION public.door_coverage_block(
  p_clients TEXT[],
  p_from    DATE,
  p_to      DATE
)
RETURNS TABLE (
  window_wins_total          INT,
  window_cash_usd_cents      BIGINT,
  ad_wins                    INT,
  ad_cash_usd_cents          BIGINT,
  organic_wins               INT,
  organic_cash_usd_cents     BIGINT,
  misc_chat_wins             INT,
  misc_chat_cash_usd_cents   BIGINT,
  awaiting_wins              INT,
  awaiting_cash_usd_cents    BIGINT,
  unassigned_awaiting_wins   INT,
  misc_chat_awaiting_overlap INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT s.*
      FROM public.adsv2_sale_facts s
     WHERE s.is_win
       AND s.sale_et_day BETWEEN p_from AND p_to
       AND (
             s.client_key = ANY (p_clients)
             -- The unassigned pool. Always in, never filtered away by a
             -- client narrowing, because these are the wins nobody has
             -- claimed and hiding them is how a false 100% gets reported.
             OR (s.awaiting_review AND s.client_key IS NULL)
           )
  ),
  bucketed AS (
    SELECT s.collected_usd_cents AS cash,
           (s.call_type = 'Miscellaneous Chat')          AS is_misc,
           (s.awaiting_review AND s.client_key IS NULL)  AS is_unassigned,
           CASE
             WHEN s.awaiting_review THEN 'awaiting_review'
             WHEN s.is_organic
               OR EXISTS (
                    SELECT 1
                      FROM public.registry_keywords k
                     WHERE k.type = 'organic'
                       AND k.keyword_normalized = s.keyword_normalized
                       AND k.client_key         = s.client_key
                  )
               THEN 'organic'
             WHEN s.keyword_normalized IS NOT NULL THEN 'ad'
             WHEN s.call_type = 'Miscellaneous Chat'     THEN 'misc_chat'
             -- A win that fits no rule is NOT silently dropped: it is folded
             -- into the gap, because an unexplained win is the definition of
             -- one nobody has classified. Coverage may understate itself;
             -- it may never overstate itself.
             ELSE 'awaiting_review'
           END AS bucket
      FROM scoped s
  )
  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(cash), 0)::BIGINT,
    COUNT(*) FILTER (WHERE bucket = 'ad')::INT,
    COALESCE(SUM(cash) FILTER (WHERE bucket = 'ad'), 0)::BIGINT,
    COUNT(*) FILTER (WHERE bucket = 'organic')::INT,
    COALESCE(SUM(cash) FILTER (WHERE bucket = 'organic'), 0)::BIGINT,
    COUNT(*) FILTER (WHERE bucket = 'misc_chat')::INT,
    COALESCE(SUM(cash) FILTER (WHERE bucket = 'misc_chat'), 0)::BIGINT,
    COUNT(*) FILTER (WHERE bucket = 'awaiting_review')::INT,
    COALESCE(SUM(cash) FILTER (WHERE bucket = 'awaiting_review'), 0)::BIGINT,
    COUNT(*) FILTER (WHERE is_unassigned)::INT,
    COUNT(*) FILTER (WHERE bucket = 'awaiting_review' AND is_misc)::INT
  FROM bucketed;
$$;

COMMENT ON FUNCTION public.door_coverage_block(TEXT[], DATE, DATE) IS
  'TRUTH LAYER Brick 2. The one implementation of the four signed certainty buckets. Classified buckets are scoped to the clients asked about; the awaiting-review bucket always includes the client-less unassigned pool, because those wins are the gap and filtering them out is how a false 100% coverage gets reported.';

REVOKE ALL ON FUNCTION public.door_coverage_block(TEXT[], DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.door_coverage_block(TEXT[], DATE, DATE) TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- The miss backlog, grouped. "What should we certify next" is one call.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.door_miss_backlog(p_limit INT DEFAULT 50)
RETURNS TABLE (
  asked        TEXT,
  times_asked  INT,
  callers      TEXT[],
  last_asked_at TIMESTAMPTZ,
  last_reason  TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT LOWER(TRIM(m.asked))                         AS asked,
         COUNT(*)::INT                                AS times_asked,
         ARRAY_AGG(DISTINCT m.caller)
           FILTER (WHERE m.caller IS NOT NULL)        AS callers,
         MAX(m.asked_at)                              AS last_asked_at,
         (ARRAY_AGG(m.reason ORDER BY m.asked_at DESC))[1] AS last_reason
    FROM public.door_miss_log m
   WHERE NULLIF(TRIM(m.asked), '') IS NOT NULL
   GROUP BY LOWER(TRIM(m.asked))
   ORDER BY COUNT(*) DESC, MAX(m.asked_at) DESC
   LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.door_miss_backlog(INT) IS
  'TRUTH LAYER Brick 2. Refused questions grouped by what was asked, most-asked first. The certification backlog in one call.';

REVOKE ALL ON FUNCTION public.door_miss_backlog(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.door_miss_backlog(INT) TO service_role, authenticated;

COMMIT;
