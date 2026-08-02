-- 065_registry_keywords.sql
-- TRUTH LAYER, Brick 1 (2 of 4): the KEYWORD registry.
--
-- Full history of every keyword ever used, per client, with the all-time
-- uniqueness law enforced going forward.
--
-- THE UNIQUENESS LAW AND WHY IT IS NOT FULLY ARMED TODAY
-- ------------------------------------------------------
-- The signed definition (keyword_uniqueness) says ad keywords are all-time
-- unique across ALL clients. The intended constraint is:
--
--     UNIQUE (keyword_normalized) WHERE status = 'active' AND type = 'ad'
--
-- That index CANNOT be created truthfully today: the historical data contains
-- active-status collisions (see registry_keyword_active_collisions). Creating
-- it would require silently picking a winner and deleting real history, which
-- is exactly the kind of quiet lie this layer exists to prevent.
--
-- So this migration:
--   1. Creates the per-client uniqueness index that IS true today.
--   2. Ships registry_keyword_active_collisions so the gap is visible, not
--      forgotten.
--   3. Ships registry_enforce_keyword_uniqueness(), which arms the strong
--      index the moment the collisions are resolved and REFUSES (with the
--      collision list) while they are not.
--
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.registry_keywords (
  keyword_normalized TEXT NOT NULL,
  client_key         TEXT NOT NULL REFERENCES public.registry_entities (canonical_key),
  type               TEXT NOT NULL CHECK (type IN ('ad', 'organic')),
  status             TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  first_used         DATE,
  last_used          DATE,

  -- Where this keyword was actually seen, e.g.
  --   {"sources": ["insights", "keyword_events"], "spend_cents_30d": 4128,
  --    "live_ad_rows": 22, "event_count": 9}
  -- Provenance is part of the row: a keyword with no evidence is not a fact.
  source_evidence JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (keyword_normalized, client_key, type)
);

COMMENT ON TABLE public.registry_keywords IS
  'TRUTH LAYER Brick 1. Every keyword ever used, per client, with provenance. Ad keywords are meant to be all-time unique across clients - see registry_keyword_active_collisions for the historical exceptions blocking the strong constraint.';
COMMENT ON COLUMN public.registry_keywords.status IS
  'active = spend or events in the last 30 days, or attached to a live ACTIVE ad. Otherwise retired.';

ALTER TABLE public.registry_keywords ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS registry_keywords_lookup_idx
  ON public.registry_keywords (keyword_normalized);
CREATE INDEX IF NOT EXISTS registry_keywords_client_status_idx
  ON public.registry_keywords (client_key, status, type);

-- The uniqueness that IS true today: one active ad row per (keyword, client).
-- Weaker than the signed law - deliberately so, and flagged as such.
CREATE UNIQUE INDEX IF NOT EXISTS registry_keywords_active_ad_per_client_uidx
  ON public.registry_keywords (keyword_normalized, client_key)
  WHERE status = 'active' AND type = 'ad';

COMMENT ON INDEX public.registry_keywords_active_ad_per_client_uidx IS
  'FALLBACK constraint. The signed law is UNIQUE(keyword_normalized) for active ad keywords across ALL clients; it is blocked by historical collisions. Run registry_enforce_keyword_uniqueness() to arm the strong index once resolved.';

-- ── The live collision list ─────────────────────────────────────────────
-- What stands between us and the signed law, queryable at any time.
CREATE OR REPLACE VIEW public.registry_keyword_active_collisions AS
  SELECT keyword_normalized,
         COUNT(*)                                        AS active_clients,
         ARRAY_AGG(client_key ORDER BY client_key)        AS clients,
         MAX(last_used)                                   AS last_used
    FROM public.registry_keywords
   WHERE status = 'active' AND type = 'ad'
   GROUP BY keyword_normalized
  HAVING COUNT(*) > 1;

COMMENT ON VIEW public.registry_keyword_active_collisions IS
  'Ad keywords currently active for more than one client. Empty view = the all-time-uniqueness law can be armed.';

-- ── The resolver ────────────────────────────────────────────────────────
-- Returns ALL rows for a keyword, history included: who used it, when, and
-- whether it is live. A keyword is never "owned" by one answer.
CREATE OR REPLACE FUNCTION public.registry_resolve_keyword(p_keyword TEXT)
RETURNS SETOF public.registry_keywords
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.*
    FROM public.registry_keywords k
   WHERE k.keyword_normalized = LOWER(TRIM(p_keyword))
     AND NULLIF(TRIM(p_keyword), '') IS NOT NULL
   ORDER BY (k.status = 'active') DESC, k.last_used DESC NULLS LAST, k.client_key;
$$;

COMMENT ON FUNCTION public.registry_resolve_keyword(TEXT) IS
  'Normalized keyword lookup. Returns every row for the keyword (all clients, all history), active first.';

REVOKE ALL ON FUNCTION public.registry_resolve_keyword(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registry_resolve_keyword(TEXT) TO service_role, authenticated;

-- ── Arming the signed law ───────────────────────────────────────────────
-- Creates the strong all-client unique index, but ONLY if it is true. If any
-- collision remains, it raises with the list rather than destroying history.
CREATE OR REPLACE FUNCTION public.registry_enforce_keyword_uniqueness()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_collisions TEXT;
  v_count      INT;
BEGIN
  SELECT COUNT(*), STRING_AGG(keyword_normalized || ' (' || ARRAY_TO_STRING(clients, ', ') || ')', '; ' ORDER BY keyword_normalized)
    INTO v_count, v_collisions
    FROM public.registry_keyword_active_collisions;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Cannot arm all-time keyword uniqueness: % active ad keyword(s) belong to more than one client -> %',
      v_count, v_collisions
      USING HINT = 'Resolve each collision (retire the loser, or confirm the shared use is intended) then re-run.';
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS registry_keywords_active_ad_all_clients_uidx
    ON public.registry_keywords (keyword_normalized)
    WHERE status = 'active' AND type = 'ad';

  RETURN 'All-time ad keyword uniqueness armed.';
END;
$$;

COMMENT ON FUNCTION public.registry_enforce_keyword_uniqueness() IS
  'Arms the signed all-time keyword uniqueness law if and only if zero active collisions remain. Raises with the collision list otherwise.';

REVOKE ALL ON FUNCTION public.registry_enforce_keyword_uniqueness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_enforce_keyword_uniqueness() TO service_role;

-- ── The sweep ───────────────────────────────────────────────────────────
-- Rebuilds registry_keywords from every source that records a keyword.
-- Re-runnable: upserts by primary key, never deletes.
--
-- Sources swept (a DISTINCT sweep of ALL of them, never a sample - this is
-- the lesson from the setter-roster miss):
--   * ads_meta_insights_daily  (ad keywords + spend + live ad status)
--   * ads_keyword_events       (ad keywords + DM/booking events)
--   * organic_keywords         (the marked organic list)
CREATE OR REPLACE FUNCTION public.registry_reseed_keywords()
RETURNS TABLE (keywords_upserted INT, ad_rows INT, organic_rows INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ad      INT;
  v_organic INT;
BEGIN
  -- Ad keywords: union the two ad sources, then roll up per (keyword, client).
  WITH insights AS (
    SELECT LOWER(TRIM(keyword_normalized)) AS kw,
           client_key,
           date::DATE                      AS d,
           COALESCE(spend_cents, 0)        AS spend_cents,
           (COALESCE(ad_effective_status, '') = 'ACTIVE') AS live_ad
      FROM public.ads_meta_insights_daily
     WHERE NULLIF(TRIM(keyword_normalized), '') IS NOT NULL
       AND client_key IS NOT NULL
  ), events AS (
    SELECT LOWER(TRIM(keyword_normalized)) AS kw,
           client_key,
           event_at::DATE                  AS d
      FROM public.ads_keyword_events
     WHERE NULLIF(TRIM(keyword_normalized), '') IS NOT NULL
       AND client_key IS NOT NULL
  ), ins_roll AS (
    SELECT kw, client_key,
           MIN(d) AS first_used, MAX(d) AS last_used,
           SUM(spend_cents) FILTER (WHERE d >= CURRENT_DATE - 30) AS spend_30d,
           COUNT(*) FILTER (WHERE live_ad)                        AS live_ad_rows
      FROM insights GROUP BY kw, client_key
  ), ev_roll AS (
    SELECT kw, client_key,
           MIN(d) AS first_used, MAX(d) AS last_used,
           COUNT(*)                                    AS event_count,
           COUNT(*) FILTER (WHERE d >= CURRENT_DATE - 30) AS events_30d
      FROM events GROUP BY kw, client_key
  ), merged AS (
    SELECT COALESCE(i.kw, e.kw)                 AS kw,
           COALESCE(i.client_key, e.client_key) AS client_key,
           LEAST(i.first_used, COALESCE(e.first_used, i.first_used))  AS first_used,
           GREATEST(i.last_used, COALESCE(e.last_used, i.last_used))  AS last_used,
           COALESCE(i.spend_30d, 0)     AS spend_30d,
           COALESCE(i.live_ad_rows, 0)  AS live_ad_rows,
           COALESCE(e.event_count, 0)   AS event_count,
           COALESCE(e.events_30d, 0)    AS events_30d,
           (i.kw IS NOT NULL)           AS from_insights,
           (e.kw IS NOT NULL)           AS from_events
      FROM ins_roll i
      FULL OUTER JOIN ev_roll e ON i.kw = e.kw AND i.client_key = e.client_key
  )
  INSERT INTO public.registry_keywords AS rk
    (keyword_normalized, client_key, type, status, first_used, last_used, source_evidence, updated_at)
  SELECT m.kw,
         m.client_key,
         'ad',
         CASE WHEN m.spend_30d > 0 OR m.events_30d > 0 OR m.live_ad_rows > 0
              THEN 'active' ELSE 'retired' END,
         COALESCE(m.first_used, m.last_used),
         COALESCE(m.last_used, m.first_used),
         JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
           'sources', (SELECT JSONB_AGG(s) FROM (
                         SELECT 'insights' AS s WHERE m.from_insights
                         UNION ALL
                         SELECT 'keyword_events' WHERE m.from_events) t),
           'spend_cents_30d', m.spend_30d,
           'live_ad_rows',    m.live_ad_rows,
           'event_count',     m.event_count,
           'events_30d',      m.events_30d
         )),
         NOW()
    FROM merged m
    -- Only keywords whose client is a known entity. An unknown client_key is a
    -- registry gap to fix, not a row to invent.
   WHERE EXISTS (SELECT 1 FROM public.registry_entities e WHERE e.canonical_key = m.client_key)
      ON CONFLICT (keyword_normalized, client_key, type) DO UPDATE
      SET status          = EXCLUDED.status,
          first_used      = LEAST(rk.first_used, EXCLUDED.first_used),
          last_used       = GREATEST(rk.last_used, EXCLUDED.last_used),
          source_evidence = EXCLUDED.source_evidence,
          updated_at      = NOW();

  GET DIAGNOSTICS v_ad = ROW_COUNT;

  -- Organic keywords: the marked list is itself the authority. Dates come from
  -- ad-event evidence where it exists, else the row's own created_at.
  INSERT INTO public.registry_keywords AS rk
    (keyword_normalized, client_key, type, status, first_used, last_used, source_evidence, updated_at)
  SELECT LOWER(TRIM(o.keyword_normalized)),
         o.client_key,
         'organic',
         'active',
         COALESCE(ev.first_used, o.created_at::DATE),
         COALESCE(ev.last_used,  o.created_at::DATE),
         JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
           'sources',     JSONB_BUILD_ARRAY('organic_keywords'),
           'note',        o.note,
           'event_count', ev.event_count
         )),
         NOW()
    FROM public.organic_keywords o
    LEFT JOIN LATERAL (
      SELECT MIN(event_at::DATE) AS first_used,
             MAX(event_at::DATE) AS last_used,
             COUNT(*)            AS event_count
        FROM public.ads_keyword_events k
       WHERE LOWER(TRIM(k.keyword_normalized)) = LOWER(TRIM(o.keyword_normalized))
         AND k.client_key = o.client_key
    ) ev ON TRUE
   WHERE NULLIF(TRIM(o.keyword_normalized), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.registry_entities e WHERE e.canonical_key = o.client_key)
      ON CONFLICT (keyword_normalized, client_key, type) DO UPDATE
      SET status          = EXCLUDED.status,
          first_used      = LEAST(rk.first_used, EXCLUDED.first_used),
          last_used       = GREATEST(rk.last_used, EXCLUDED.last_used),
          source_evidence = EXCLUDED.source_evidence,
          updated_at      = NOW();

  GET DIAGNOSTICS v_organic = ROW_COUNT;

  RETURN QUERY SELECT (v_ad + v_organic), v_ad, v_organic;
END;
$$;

COMMENT ON FUNCTION public.registry_reseed_keywords() IS
  'Re-runnable DISTINCT sweep of ads_meta_insights_daily + ads_keyword_events + organic_keywords into registry_keywords. Upserts by primary key; never deletes.';

REVOKE ALL ON FUNCTION public.registry_reseed_keywords() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_reseed_keywords() TO service_role;

COMMIT;
