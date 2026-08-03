-- 069_registry_keyword_active_rule_and_arm_uniqueness.sql
-- TRUTH LAYER, Brick 1 close-out: the keyword "active" rule, signed by Alex 2026-08-02.
--
-- Signed rule: an AD keyword is ACTIVE only when its creator is active AND the
-- keyword is carried by a live ACTIVE ad. Everything else is retired. This
-- clears the 9 historical cross-client collisions (each resolves to at most
-- one active owner) and lets the all-time uniqueness law arm truthfully.
-- The final statement arms the law; if any collision survived, it RAISES and
-- this whole migration rolls back.
--
-- NOTE: registry_seed_definitions still seeds keyword_uniqueness v1 with the
-- pre-armed details blob; a reseed reverts that one details field (the signed
-- statement is unaffected, and the seed script prints the live enforcement
-- state every run). Fold into the definitions seed at the next definitions
-- change (Brick 2).

BEGIN;

CREATE OR REPLACE FUNCTION public.registry_reseed_keywords()
 RETURNS TABLE(keywords_upserted integer, ad_rows integer, organic_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ad      INT;
  v_organic INT;
BEGIN
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
           COUNT(*)                                       AS event_count,
           COUNT(*) FILTER (WHERE d >= CURRENT_DATE - 30)  AS events_30d
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
         -- SIGNED RULE (Alex 2026-08-02, definition keyword_active_status v1):
         -- active = creator active AND a live ACTIVE ad carries the keyword.
         CASE WHEN m.live_ad_rows > 0
               AND EXISTS (SELECT 1 FROM public.registry_entities e2
                            WHERE e2.canonical_key = m.client_key
                              AND e2.status = 'active')
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
   WHERE EXISTS (SELECT 1 FROM public.registry_entities e WHERE e.canonical_key = m.client_key)
      ON CONFLICT (keyword_normalized, client_key, type) DO UPDATE
      SET status          = EXCLUDED.status,
          first_used      = LEAST(rk.first_used, EXCLUDED.first_used),
          last_used       = GREATEST(rk.last_used, EXCLUDED.last_used),
          source_evidence = EXCLUDED.source_evidence,
          updated_at      = NOW();

  GET DIAGNOSTICS v_ad = ROW_COUNT;

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
$function$;


-- the signed rule as a definition of record
INSERT INTO public.registry_definitions (name, version, statement, details, signed_by, signed_at, status)
VALUES ('keyword_active_status', 1,
  'An AD keyword is ACTIVE only when its creator is active AND the keyword is carried by a live ACTIVE ad. Everything else is retired. Retired keywords remain permanently in the registry history and still block new-keyword selection (all-time uniqueness is checked against FULL history, not just active rows).',
  '{"active_requires": ["creator status active", "live ACTIVE ad carries the keyword"], "otherwise": "retired", "history_blocks_new_selection": true, "decided": "clears the 9 historical cross-client collisions so the all-time law can arm", "context": "6 of the 9 collision keywords had live Tyson ads at decision time; each pair resolves to at most one active owner under this rule"}'::JSONB,
  'Alex Walsh (2026-08-02, relayed via Fable)', '2026-08-02', 'signed')
ON CONFLICT (name, version) DO UPDATE
  SET statement = EXCLUDED.statement, details = EXCLUDED.details,
      signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at, status = EXCLUDED.status;

-- reflect the armed state in keyword_uniqueness v1 details
UPDATE public.registry_definitions
   SET details = details || '{"enforcement_status_2026_08_02": "ARMED 2026-08-02: the keyword_active_status rule cleared all 9 historical collisions and registry_enforce_keyword_uniqueness() created the all-client unique index."}'::JSONB
 WHERE name = 'keyword_uniqueness' AND version = 1;

SELECT * FROM public.registry_reseed_keywords();

SELECT public.registry_enforce_keyword_uniqueness();

COMMIT;
