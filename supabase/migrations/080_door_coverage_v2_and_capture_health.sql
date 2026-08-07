-- 080_door_coverage_v2_and_capture_health.sql
-- TRUTH LAYER, Brick 4. The read side of the trust pack.
--
-- Two things:
--   1. door_coverage_block learns about human-confirmed non-ad wins, and
--      learns to SAY when a person has classified a win that no signed bucket
--      covers, rather than folding it into the gap in silence.
--   2. Five capture-health reads, one per pipe, so a break is caught while it
--      is small instead of being found by hand a fortnight later.
--
-- Additive. Every function is SECURITY DEFINER with a pinned search_path,
-- STABLE (they read and never write), and reachable by service_role and
-- authenticated only, matching 075.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. THE COVERAGE BLOCK, version 2.
--
-- WHAT CHANGED AND WHY.
--
-- Migration 078 part D gives eight reviewed sales blank_reason
-- 'human_confirmed_non_ad' and awaiting_review = false. Six of them carry the
-- team's own "Miscellaneous Chat" label, so the EXISTING priority already moves
-- them into misc_chat with no rule change at all. That is the happy path and it
-- needed no help.
--
-- THE TWO THAT ARE NOT THE HAPPY PATH ARE THE POINT.
-- Drake McGinley's callType is "Strategy Session" and Hunter Fleek's is
-- "Onboarding Call". A person opened both threads and confirmed there is no ad
-- in either. They are CLASSIFIED by any ordinary meaning of the word. But
-- certainty_buckets v1 defines MISC CHAT strictly as the team's own callType
-- field reading "Miscellaneous Chat", and theirs does not. So no signed bucket
-- covers them.
--
-- Three options, and only one of them is honest:
--   * call them misc_chat anyway    -> the door inventing a value for a sheet
--                                      field it can read. Never.
--   * invent a fifth bucket         -> a bucket nobody signed, quietly entering
--                                      every receipt. Never.
--   * count them in the gap, and    -> understates coverage, states exactly why,
--     NAME them                        and hands the owner a decision to make.
--
-- The third. This is the same shape as Brick 3's tree_unresolved: where the
-- signed rules do not reach, the answer says so instead of guessing, and the
-- resolution is a registry change the owner signs, not code freelancing.
--
-- Coverage may understate itself. It may never overstate itself.
--
-- The return type gains three columns, so this is DROP then CREATE rather than
-- CREATE OR REPLACE. Both happen inside one transaction, so no caller can ever
-- observe the function missing.
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.door_coverage_block(TEXT[], DATE, DATE);

CREATE FUNCTION public.door_coverage_block(
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
  misc_chat_awaiting_overlap INT,
  -- Brick 4. Wins a PERSON has confirmed are not ad sales, anywhere in the
  -- window. Most land in misc_chat; this is the honest total of the work done.
  human_confirmed_non_ad_wins INT,
  -- Brick 4. Of those, the ones no signed bucket covers, because their callType
  -- is not "Miscellaneous Chat". Counted inside awaiting_review, named here.
  unbucketed_resolved_wins    INT,
  unbucketed_resolved_cash_usd_cents BIGINT
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
           (s.blank_reason = 'human_confirmed_non_ad')   AS is_human_non_ad,
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
             -- one nobody has classified. Since Brick 4 this branch also
             -- catches the human-confirmed non-ad wins whose callType is not
             -- "Miscellaneous Chat", and those are counted separately below so
             -- the note can say a person DID look at them.
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
    COUNT(*) FILTER (WHERE bucket = 'awaiting_review' AND is_misc)::INT,
    COUNT(*) FILTER (WHERE is_human_non_ad)::INT,
    COUNT(*) FILTER (WHERE is_human_non_ad AND bucket = 'awaiting_review')::INT,
    COALESCE(SUM(cash) FILTER (WHERE is_human_non_ad AND bucket = 'awaiting_review'), 0)::BIGINT
  FROM bucketed;
$$;

COMMENT ON FUNCTION public.door_coverage_block(TEXT[], DATE, DATE) IS
  'TRUTH LAYER Brick 4 (v2 of the Brick 2 function). The one implementation of the four signed certainty buckets. Classified buckets are scoped to the clients asked about; the awaiting-review bucket always includes the client-less unassigned pool, because those wins are the gap and filtering them out is how a false 100% coverage gets reported. Since Brick 4 it also counts human-confirmed non-ad wins, and separately counts the ones no signed bucket covers, so a win a person HAS classified is never silently counted as one nobody has looked at.';

REVOKE ALL ON FUNCTION public.door_coverage_block(TEXT[], DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.door_coverage_block(TEXT[], DATE, DATE) TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE RESOLUTION QUEUE. The working list, in one call.
--
-- This is the list Alex hand-worked on 2026-07-31 and again on 2026-08-07,
-- rebuilt from the facts rather than from anyone's memory of it. The ManyChat
-- link comes from the tracker row, because that link is the whole reason a
-- human can resolve one of these in under a minute.
--
-- The tracker join is on sale_key, which adsv2_sale_facts already carries and
-- which is built from the sheet row itself, so it is a hard key and not a name
-- match. A row with no tracker match returns a null link rather than being
-- dropped: the queue must never be shorter than the gap it represents.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.door_resolution_queue(p_limit INT DEFAULT 100)
RETURNS TABLE (
  sale_key           TEXT,
  sale_et_day        DATE,
  prospect_name      TEXT,
  client_key         TEXT,
  collected_usd_cents BIGINT,
  call_type          TEXT,
  setter_name        TEXT,
  closer             TEXT,
  subscriber_id      TEXT,
  manychat_link      TEXT,
  blank_reason       TEXT,
  has_keyword_events BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.sale_key,
         f.sale_et_day,
         f.prospect_name,
         f.client_key,
         f.collected_usd_cents,
         f.call_type,
         f.setter_name,
         f.closer,
         f.subscriber_id,
         t.manychat_link,
         f.blank_reason,
         EXISTS (SELECT 1 FROM public.ads_keyword_events e
                  WHERE e.subscriber_id = f.subscriber_id) AS has_keyword_events
    FROM public.adsv2_sale_facts f
    LEFT JOIN public.sales_tracker_rows t
           ON t.sheet_row_key = f.sale_key
   WHERE f.is_win
     AND f.awaiting_review
   ORDER BY f.sale_et_day DESC, f.collected_usd_cents DESC
   LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.door_resolution_queue(INT) IS
  'TRUTH LAYER Brick 4. Every awaiting-review win, newest first, with the ManyChat link from the tracker row so a person can resolve one in a minute. This is the certification backlog for MONEY, the way door_miss_backlog is the certification backlog for QUESTIONS.';

REVOKE ALL ON FUNCTION public.door_resolution_queue(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.door_resolution_queue(INT) TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. DEPOSITS PENDING CLOSE (win_definition v1).
--
-- "PCFU is the closers' follow-up-pending bucket. Counting PCFU rows as wins
-- would double-count those people. Cash on ANY row always counts in collected.
-- Cash-bearing PCFU rows surface in answers as deposits pending close so they
-- are visible, never lost."
--
-- That last sentence has never had an implementation. This is it.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.door_deposits_pending_close(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (
  rows_count        INT,
  cash_usd_cents    BIGINT,
  detail            JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH pcfu AS (
    SELECT t.date, t.prospect_name, t.closer, t.setter, t.collected_revenue_cents
      FROM public.sales_tracker_rows t
     WHERE t.outcome = 'PCFU'
       AND t.collected_revenue_cents > 0
       AND t.date BETWEEN p_from AND p_to
  )
  SELECT COUNT(*)::INT,
         COALESCE(SUM(collected_revenue_cents), 0)::BIGINT,
         COALESCE(
           jsonb_agg(jsonb_build_object(
             'day', date, 'prospect', prospect_name, 'closer', closer,
             'setter', setter, 'cash_usd_cents', collected_revenue_cents
           ) ORDER BY date DESC),
           '[]'::jsonb)
    FROM pcfu;
$$;

COMMENT ON FUNCTION public.door_deposits_pending_close(DATE, DATE) IS
  'TRUTH LAYER Brick 4. Cash-bearing PCFU rows, surfaced as "deposits pending close" exactly as win_definition v1 requires. They are NOT wins and are never counted as such; they are money in the door that has not become a close yet, and leaving them invisible is how it gets forgotten.';

REVOKE ALL ON FUNCTION public.door_deposits_pending_close(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.door_deposits_pending_close(DATE, DATE) TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. CAPTURE HEALTH, pipe by pipe.
--
-- ── THE FINDING THAT SHAPED ALL OF THIS ─────────────────────────────────
-- ads_keyword_events.subscriber_id and dm_conversation_messages.subscriber_id
-- are DIFFERENT ID SPACES. Measured on 2026-08-07:
--
--   distinct subscriber ids in ads_keyword_events       7,585   (0 of length >= 15)
--   distinct subscriber ids in dm_conversation_messages 29,897  (29,848 of length >= 15)
--   ids present in BOTH                                     1
--
-- One. Out of 7,585. The keyword events carry ManyChat subscriber ids; the DM
-- messages carry Instagram-scoped ids. Bridging them is Brick 5 and is
-- deliberately not attempted here.
--
-- This matters because the obvious implementation of the organic-break detector
-- is "find a person who sent an organic keyword in their DMs and has no keyword
-- event", and across two disjoint id spaces that query returns EVERY person,
-- forever, including the ones the automation handled perfectly. It would be a
-- false-alarm engine wearing a trust badge, which is worse than no detector.
--
-- So the detector compares COHORT COUNTS per creator, per keyword, per day. It
-- never claims to know that a particular DM belongs to a particular event, only
-- that N people said the word on a day and M events were recorded. That needs
-- no identity bridge and it is the signal that actually matters.
--
-- It reproduces the real history without being told it: zero events against
-- live DM arrivals every day from 2026-07-26 to 2026-08-03 (which is the break
-- Alex found by hand on 8/02), then events flowing from 2026-08-04.
-- ─────────────────────────────────────────────────────────────────────────

-- 4a. Keyword events flowing: how long since the last one, per creator.
CREATE OR REPLACE FUNCTION public.door_capture_keyword_flow(p_clients TEXT[])
RETURNS TABLE (
  client_key       TEXT,
  last_event_at    TIMESTAMPTZ,
  hours_since_last NUMERIC,
  events_7d        INT,
  events_30d       INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c AS client_key,
         MAX(e.event_at) AS last_event_at,
         ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(e.event_at)))::numeric / 3600, 1) AS hours_since_last,
         COUNT(*) FILTER (WHERE e.event_at > NOW() - INTERVAL '7 days')::INT  AS events_7d,
         COUNT(*) FILTER (WHERE e.event_at > NOW() - INTERVAL '30 days')::INT AS events_30d
    FROM UNNEST(p_clients) AS c
    LEFT JOIN public.ads_keyword_events e ON e.client_key = c
   GROUP BY c
   ORDER BY c;
$$;

COMMENT ON FUNCTION public.door_capture_keyword_flow(TEXT[]) IS
  'TRUTH LAYER Brick 4. How long since each creator last produced a keyword event. A creator with a live ad and no events is the single loudest capture break there is, and it is invisible in every money number until the sales stop.';

-- 4b. Webhook keyword misses: a sale carries a ManyChat subscriber id, but that
--     subscriber produced no keyword event at all. This is the known
--     lead_engaged flow gap.
CREATE OR REPLACE FUNCTION public.door_capture_webhook_misses(
  p_clients TEXT[],
  p_from    DATE,
  p_to      DATE,
  p_limit   INT DEFAULT 10
)
RETURNS TABLE (
  rows_with_subscriber INT,
  rows_with_zero_events INT,
  sample JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT f.sale_key, f.sale_et_day, f.prospect_name, f.subscriber_id,
           NOT EXISTS (SELECT 1 FROM public.ads_keyword_events e
                        WHERE e.subscriber_id = f.subscriber_id) AS zero_events
      FROM public.adsv2_sale_facts f
     WHERE f.subscriber_id IS NOT NULL
       AND f.sale_et_day BETWEEN p_from AND p_to
       AND (f.client_key = ANY (p_clients) OR f.client_key IS NULL)
  )
  SELECT COUNT(*)::INT,
         COUNT(*) FILTER (WHERE zero_events)::INT,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    -- FIRST NAME ONLY. A health answer needs to prove the miss
                    -- is real, not to publish a contact list.
                    'first_name', SPLIT_PART(COALESCE(s.prospect_name, ''), ' ', 1),
                    'subscriber_id', s.subscriber_id,
                    'day', s.sale_et_day))
             FROM (SELECT * FROM scoped WHERE zero_events
                    ORDER BY sale_et_day DESC LIMIT GREATEST(p_limit, 1)) s
         ), '[]'::jsonb)
    FROM scoped;
$$;

COMMENT ON FUNCTION public.door_capture_webhook_misses(TEXT[], DATE, DATE, INT) IS
  'TRUTH LAYER Brick 4. Sales that carry a ManyChat subscriber id whose subscriber produced no keyword event at all: the lead_engaged flow gap, counted. The sample carries first names only, because a health answer has to prove the miss is real, not publish a contact list.';

-- 4c. Organic automation breaks, at COHORT level. See the long note above for
--     why this is not a per-person join.
CREATE OR REPLACE FUNCTION public.door_capture_organic_breaks(
  p_clients TEXT[],
  p_from    DATE,
  p_to      DATE
)
RETURNS TABLE (
  client_key   TEXT,
  keyword      TEXT,
  et_day       DATE,
  dm_senders   INT,
  keyword_events INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH kw AS (
    SELECT k.keyword_normalized, k.client_key,
           COALESCE(k.first_used, p_from) AS registered_on
      FROM public.registry_keywords k
     WHERE k.type = 'organic'
       AND k.client_key = ANY (p_clients)
  ),
  -- The DM store keys creators by their handle (tyson_sonnek); the warehouse
  -- keys them canonically (tyson). registry_resolve_entity is Brick 1's job and
  -- it is used here rather than a hardcoded map, so a new creator needs a
  -- registry row and nothing else.
  --
  -- Resolved ONCE per distinct handle, not once per message. Calling the
  -- resolver inside the join condition would run it against every one of the
  -- 123,000 stored messages, twice, on every health check.
  dm_client AS (
    SELECT d.client AS dm_client,
           public.registry_resolve_entity(d.client) AS client_key
      FROM (SELECT DISTINCT client FROM public.dm_conversation_messages) d
  ),
  dm AS (
    SELECT dc.client_key,
           k.keyword_normalized AS keyword,
           m.sent_at::date AS et_day,
           COUNT(DISTINCT m.subscriber_id)::INT AS dm_senders
      FROM public.dm_conversation_messages m
      JOIN dm_client dc ON dc.dm_client = m.client
      JOIN kw k
        ON k.client_key = dc.client_key
       AND LOWER(BTRIM(REGEXP_REPLACE(COALESCE(m.body, ''), '[^a-zA-Z0-9 ]', '', 'g')))
           = k.keyword_normalized
     WHERE m.direction = 'inbound'
       AND m.sent_at::date BETWEEN GREATEST(p_from, k.registered_on) AND p_to
     GROUP BY 1, 2, 3
  ),
  ev AS (
    SELECT e.client_key, e.keyword_normalized AS keyword, e.event_at::date AS et_day,
           COUNT(DISTINCT e.subscriber_id)::INT AS keyword_events
      FROM public.ads_keyword_events e
      JOIN kw k ON k.client_key = e.client_key AND k.keyword_normalized = e.keyword_normalized
     WHERE e.event_at::date BETWEEN GREATEST(p_from, k.registered_on) AND p_to
     GROUP BY 1, 2, 3
  )
  SELECT COALESCE(dm.client_key, ev.client_key),
         COALESCE(dm.keyword, ev.keyword),
         COALESCE(dm.et_day, ev.et_day),
         COALESCE(dm.dm_senders, 0),
         COALESCE(ev.keyword_events, 0)
    FROM dm
    FULL JOIN ev
      ON ev.client_key = dm.client_key AND ev.keyword = dm.keyword AND ev.et_day = dm.et_day
   ORDER BY 3 DESC, 1, 2;
$$;

COMMENT ON FUNCTION public.door_capture_organic_breaks(TEXT[], DATE, DATE) IS
  'TRUTH LAYER Brick 4. Per creator, per organic keyword, per day: how many people sent that word in their DMs, and how many keyword events were recorded. COHORT counts, never a person-to-person join, because ads_keyword_events and dm_conversation_messages use different subscriber id spaces (1 id in common out of 7,585) and joining them would report every organic sender as a break forever. Bridging those spaces is Brick 5.';

-- 4d. Misc-chat recoverables: a misc-chat win whose own subscriber DID produce
--     keyword events. One look and a human can flip it.
CREATE OR REPLACE FUNCTION public.door_capture_misc_recoverable(
  p_clients TEXT[],
  p_from    DATE,
  p_to      DATE,
  p_limit   INT DEFAULT 10
)
RETURNS TABLE (
  misc_chat_wins INT,
  recoverable    INT,
  sample         JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT f.sale_key, f.sale_et_day, f.prospect_name, f.subscriber_id,
           (f.subscriber_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.ads_keyword_events e
               WHERE e.subscriber_id = f.subscriber_id
                 AND e.event_at::date <= f.sale_et_day)) AS recoverable
      FROM public.adsv2_sale_facts f
     WHERE f.is_win
       AND f.call_type = 'Miscellaneous Chat'
       AND f.keyword_normalized IS NULL
       AND f.sale_et_day BETWEEN p_from AND p_to
       AND (f.client_key = ANY (p_clients) OR f.client_key IS NULL)
  )
  SELECT COUNT(*)::INT,
         COUNT(*) FILTER (WHERE recoverable)::INT,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'first_name', SPLIT_PART(COALESCE(s.prospect_name, ''), ' ', 1),
                    'sale_key', s.sale_key,
                    'day', s.sale_et_day))
             FROM (SELECT * FROM scoped WHERE recoverable
                    ORDER BY sale_et_day DESC LIMIT GREATEST(p_limit, 1)) s
         ), '[]'::jsonb)
    FROM scoped;
$$;

COMMENT ON FUNCTION public.door_capture_misc_recoverable(TEXT[], DATE, DATE, INT) IS
  'TRUTH LAYER Brick 4. Misc-chat wins whose own ManyChat subscriber DID send a keyword before the sale. Those are misclassifications a person can flip in one look. Uses the subscriber id the sale row already carries, which is the same id space as ads_keyword_events, so no identity bridge is involved.';

REVOKE ALL ON FUNCTION public.door_capture_keyword_flow(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.door_capture_webhook_misses(TEXT[], DATE, DATE, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.door_capture_organic_breaks(TEXT[], DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.door_capture_misc_recoverable(TEXT[], DATE, DATE, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.door_capture_keyword_flow(TEXT[]) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.door_capture_webhook_misses(TEXT[], DATE, DATE, INT) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.door_capture_organic_breaks(TEXT[], DATE, DATE) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.door_capture_misc_recoverable(TEXT[], DATE, DATE, INT) TO service_role, authenticated;

-- Supporting index: the organic-break detector scans inbound DM bodies by day.
CREATE INDEX IF NOT EXISTS dm_conversation_messages_inbound_day_idx
  ON public.dm_conversation_messages (client, sent_at)
  WHERE direction = 'inbound';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. ONE NEW FRESHNESS THRESHOLD.
--
-- 24 hours for the keyword events, and that number is measured rather than
-- picked. Over the 30 days to 2026-08-07 the largest gap between consecutive
-- keyword events was 11.0 hours for Tyson and 19.1 hours for Jake, so 24 sits
-- above every gap either creator has actually produced. A full day of silence
-- is therefore a real signal and not ordinary quiet, which is the only kind of
-- threshold worth having: one that has never yet fired on healthy behaviour.
--
-- ON CONFLICT DO NOTHING, like 075, so a tuned value is never stamped back.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO public.door_freshness_thresholds (source, threshold_hours, note) VALUES
  ('ads_keyword_events', 24, 'the keyword capture webhook; the largest real gap either active creator produced in the 30 days to 2026-08-07 was 19.1 hours, so a full day of silence is a break rather than a quiet spell')
ON CONFLICT (source) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. THREE SOURCES THAT REPORT THEIR FRESHNESS FOR THE FIRST TIME.
--
-- Brick 2 seeded thresholds for sales_tracker_rows and dm_conversation_messages
-- and then noted, honestly, that nothing compared them: question_door_freshness
-- never reported those two, so the thresholds sat unused.
--
-- That stopped being harmless the moment a Brick 4 question NAMED them as its
-- own freshness sources. A source with a threshold and no reported write time
-- is flagged stale by staleSources(), by design, because unknown freshness must
-- never be assumed current. So every single coverage_report answer carried a
-- permanent "sales_tracker_rows reported no write time at all" caveat that was
-- about the reporting function rather than about the data.
--
-- A caveat that fires on every answer regardless of the facts is worse than no
-- caveat: it trains the reader to skip caveats, which costs more than the
-- caveat was ever worth. Brick 2 made exactly that point about a currency note
-- that fired on the wrong creator. The fix is the same shape: report the real
-- write time, so the flag means something when it fires.
--
-- ads_keyword_events joins them because Brick 4's capture_health is the first
-- question to depend on it, and its threshold was seeded above.
--
-- Every existing row is returned unchanged, in the same order, so no existing
-- answer's freshness list moves.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.question_door_freshness()
RETURNS TABLE(source TEXT, last_written_at TIMESTAMPTZ, note TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $function$
  select 'warehouse.answers'::text,
         (select max(s.computed_at) from adsv2_window_snapshots s
          where s.data_version = (select (m.value)::bigint from adsv2_meta m where m.key = 'data_version')),
         'the newest saved window answer at the version the tab is serving'::text
  union all
  select 'adsv2_dm_facts', (select max(f.computed_at) from adsv2_dm_facts f),
         'the newest stamped DM fact'
  union all
  select 'adsv2_booking_facts', (select max(f.computed_at) from adsv2_booking_facts f),
         'the newest stamped booking fact'
  union all
  select 'adsv2_sale_facts', (select max(f.computed_at) from adsv2_sale_facts f),
         'the newest stamped sale fact'
  union all
  select 'warehouse.ad_changes', (select max(c.created_at) from warehouse.ad_changes c),
         'the newest row written into the ad change log'
  union all
  select 'warehouse.ads', (select max(a.refreshed_at) from warehouse.ads a),
         'the last hourly refresh of the merged ads table'
  union all
  select 'warehouse.people', (select max(p.refreshed_at) from warehouse.people p),
         'the last hourly refresh of the merged people table'
  union all
  select 'warehouse.definitions', (select max(d.refreshed_at) from warehouse.definitions d),
         'the last time the definitions were rewritten from the code registry'
  union all
  select 'warehouse.accuracy_checks', (select max(c.ran_at) from warehouse.accuracy_checks c),
         'the last daily accuracy run'
  union all
  select 'ads_meta_insights_daily', (select max(i.synced_at) from ads_meta_insights_daily i),
         'the last time Meta spend landed'
  -- Brick 4. Three sources whose thresholds existed before anything reported
  -- their write times.
  union all
  select 'sales_tracker_rows', (select max(t.synced_at) from sales_tracker_rows t),
         'the last sales tracker sync'
  union all
  select 'dm_conversation_messages', (select max(m.created_at) from dm_conversation_messages m),
         'the last DM message captured'
  union all
  select 'ads_keyword_events', (select max(e.event_at) from ads_keyword_events e),
         'the last keyword event the capture webhook recorded'
  union all
  -- Brick 3 seeded a 26 hour threshold for the budget photos and nothing
  -- reported their write time either, so capture_health's freshness pipe would
  -- have read "unknown" forever and sat permanently at degraded. Same class of
  -- bug as the three above, found by running the question and reading its own
  -- output rather than by trusting that it worked.
  select 'adsv2_budget_snapshots', (select max(b.synced_at) from adsv2_budget_snapshots b),
         'the last daily budget photo'
$function$;

COMMENT ON FUNCTION public.question_door_freshness() IS
  'TRUTH LAYER. The real newest write time of every stored source a certified answer can depend on. Brick 4 added sales_tracker_rows, dm_conversation_messages, ads_keyword_events and adsv2_budget_snapshots, whose staleness thresholds had been seeded by earlier bricks with nothing reporting their write times, so they were permanently flagged as unknown-freshness the moment a question named them.';

COMMIT;
