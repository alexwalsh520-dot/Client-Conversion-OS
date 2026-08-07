-- 081_adsv2_sync_single_flight.sql
-- TRUTH LAYER, Brick 4. Make the Ads v2 sync single-flight, atomically.
--
-- ── THE BUG ──────────────────────────────────────────────────────────────
-- acquireLock() in src/lib/ads-v2/sync.ts is a READ, then a WRITE:
--
--     const { data } = await db.from("adsv2_meta").select(...)   <- read
--     if (held?.at && now - held.at < TTL) return false;
--     await db.from("adsv2_meta").upsert({ at: now });            <- write
--     return true;
--
-- Two runners that arrive inside the same few milliseconds both read a free
-- lock, both write it, and both return true. The lock has never been able to
-- stop anything; it only narrows the window. On 2026-07-31 the cron was firing
-- twins ~6ms apart every hour at :25 and the loser died mid-facts on a
-- duplicate-key insert.
--
-- ── WHAT THIS DOES NOT DO, ON PURPOSE ────────────────────────────────────
-- It does NOT add ON CONFLICT or upserts to the facts inserts. That
-- duplicate-key error is a CORRECT alarm for concurrent execution. Silencing it
-- would hide the next concurrency bug behind a green run. The lock removes the
-- cause; the alarm stays armed.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
-- One statement. INSERT ... ON CONFLICT DO UPDATE ... WHERE takes a row lock,
-- so a second caller BLOCKS on the row until the first commits and then
-- re-evaluates the WHERE against the value the winner just wrote. There is no
-- window between the read and the write because there is no separate read.
--
-- The lock is free when any of these holds:
--   * it has no valid claim time at all (never claimed, or the legacy {"at": 0})
--   * it was cleanly released
--   * its claim is older than the TTL, which means the holder crashed
--
-- A TTL takeover is RECORDED in the value (took_over_from, took_over_at) rather
-- than silently overwriting, so "the sync got stuck last night" is a question
-- with a stored answer.
--
-- Releasing is holder-scoped. A runner that hung past the TTL, lost its lock to
-- a takeover, and then finally finished must NOT release the lock the new
-- runner is holding. That is the classic way a lock fix reintroduces the bug it
-- fixed, one release call later.
--
-- Additive and idempotent.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- CLAIM. Exactly one caller wins.
-- ─────────────────────────────────────────────────────────────────────────

-- Drop any earlier two-argument forms first. Two functions of the same name
-- with different arities make PostgREST resolution ambiguous, and an ambiguous
-- lock is not a lock. Harmless on a database that never had them.
DROP FUNCTION IF EXISTS public.adsv2_claim_sync_lock(TEXT, INT);
DROP FUNCTION IF EXISTS public.adsv2_release_sync_lock(TEXT);

-- p_lock_key exists so the LIVE concurrency tests can claim their own row
-- instead of the production one. A test that can leave the real sync wedged is
-- a hazard, and the first version of these tests proved it: an assertion that
-- failed before its release call left the production lock held, and every later
-- run then failed for the wrong reason. Isolating the row is the fix; adding a
-- release in a finally block would only have narrowed it.
CREATE OR REPLACE FUNCTION public.adsv2_claim_sync_lock(
  p_holder       TEXT,
  p_ttl_seconds  INT DEFAULT 900,
  p_lock_key     TEXT DEFAULT 'sync_lock'
)
RETURNS TABLE (
  claimed        BOOLEAN,
  took_over      BOOLEAN,
  previous_holder TEXT,
  previous_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout TO '10s'
AS $$
DECLARE
  v_prev_holder   TEXT;
  v_prev_at       TIMESTAMPTZ;
  v_prev_released TEXT;
  v_won           BOOLEAN := false;
BEGIN
  IF p_holder IS NULL OR BTRIM(p_holder) = '' THEN
    RAISE EXCEPTION 'a sync lock claim must name its holder';
  END IF;

  -- What the row looked like BEFORE the claim, for the report. This read is
  -- not part of the decision: the decision is made by the WHERE below, under a
  -- row lock. Reading here and deciding there is the whole difference between
  -- this and the code it replaces.
  SELECT m.value ->> 'holder',
         CASE WHEN jsonb_typeof(m.value -> 'at') = 'string'
              THEN (m.value ->> 'at')::TIMESTAMPTZ END,
         m.value ->> 'released_at'
    INTO v_prev_holder, v_prev_at, v_prev_released
    FROM public.adsv2_meta m
   WHERE m.key = p_lock_key;

  INSERT INTO public.adsv2_meta (key, value, updated_at)
  VALUES (
    p_lock_key,
    jsonb_strip_nulls(jsonb_build_object(
      'holder',      p_holder,
      'at',          TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ttl_seconds', p_ttl_seconds,
      'released_at', NULL
    )),
    NOW()
  )
  ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value
                 -- A takeover says so, in the row, permanently.
                 || CASE
                      WHEN public.adsv2_meta.value ->> 'released_at' IS NULL
                       AND public.adsv2_meta.value ->> 'holder' IS NOT NULL
                      THEN jsonb_build_object(
                             'took_over_from', public.adsv2_meta.value ->> 'holder',
                             'took_over_at',   public.adsv2_meta.value ->> 'at')
                      ELSE '{}'::jsonb
                    END,
         updated_at = NOW()
   WHERE
     -- FREE: no usable claim time at all. Covers a fresh row and the legacy
     -- {"at": 0} value, whose 'at' is a number rather than a timestamp string.
     jsonb_typeof(public.adsv2_meta.value -> 'at') IS DISTINCT FROM 'string'
     -- FREE: the previous holder released cleanly.
     OR public.adsv2_meta.value ->> 'released_at' IS NOT NULL
     -- FREE: the claim is older than the TTL, so its holder is presumed dead.
     -- This is crash recovery: without it, one killed function would block the
     -- sync forever.
     OR (public.adsv2_meta.value ->> 'at')::TIMESTAMPTZ
          < NOW() - MAKE_INTERVAL(secs => p_ttl_seconds)
  RETURNING true INTO v_won;

  -- A LOSER RE-READS, and this matters more than it looks.
  --
  -- The "before" read above happens outside the row lock, so under a real
  -- double-fire both twins read the same pre-existing holder: whoever ran an
  -- hour ago. A loser reporting THAT would put a stale name in its skip row and
  -- in the sync history, which is exactly the sort of plausible-looking wrong
  -- detail that costs an hour when somebody investigates.
  --
  -- The test caught it: six concurrent callers produced one winner correctly,
  -- and then all five losers named a holder that had already gone.
  --
  -- So a loser reports who holds it NOW. That read is after the failed claim,
  -- so the winner has committed and is visible. Only the losing path pays for
  -- it, and the losing path is the cheap one by design.
  IF NOT COALESCE(v_won, false) THEN
    SELECT m.value ->> 'holder',
           CASE WHEN jsonb_typeof(m.value -> 'at') = 'string'
                THEN (m.value ->> 'at')::TIMESTAMPTZ END
      INTO v_prev_holder, v_prev_at
      FROM public.adsv2_meta m
     WHERE m.key = p_lock_key;
  END IF;

  -- TOOK OVER means: we claimed a lock that somebody was still nominally
  -- holding, because their claim had aged past the TTL. It is NOT "the lock was
  -- free"; a cleanly released lock is free and claiming it is ordinary.
  --
  -- Deriving this from the TTL comparison instead was wrong and the test caught
  -- it too: a takeover forced with a zero-second TTL reported took_over = false,
  -- because by that TTL the previous claim counted as expired and therefore
  -- "free". The flag that exists to say "the last run never finished" would
  -- have been silent on exactly the case it is for.
  RETURN QUERY SELECT
    COALESCE(v_won, false),
    COALESCE(v_won, false) AND v_prev_holder IS NOT NULL AND v_prev_released IS NULL,
    v_prev_holder,
    v_prev_at;
END;
$$;

COMMENT ON FUNCTION public.adsv2_claim_sync_lock(TEXT, INT, TEXT) IS
  'TRUTH LAYER Brick 4. Atomically claim the Ads v2 sync lock. One statement, decided under a row lock, so exactly one of any number of concurrent callers gets claimed = true. Replaces a read-then-write check that two callers arriving milliseconds apart both passed. A claim older than the TTL is taken over as crash recovery, and the takeover is recorded in the row.';

-- ─────────────────────────────────────────────────────────────────────────
-- RELEASE. Holder-scoped, always.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.adsv2_release_sync_lock(
  p_holder   TEXT,
  p_lock_key TEXT DEFAULT 'sync_lock'
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout TO '10s'
AS $$
  UPDATE public.adsv2_meta
     SET value = value || jsonb_build_object(
           'released_at',
           TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
         updated_at = NOW()
   WHERE key = p_lock_key
     -- ONLY the holder. A runner that hung past the TTL, lost the lock to a
     -- takeover, and then finished must never release the lock the new runner
     -- is holding.
     AND value ->> 'holder' = p_holder
     AND value ->> 'released_at' IS NULL
  RETURNING true;
$$;

COMMENT ON FUNCTION public.adsv2_release_sync_lock(TEXT, TEXT) IS
  'TRUTH LAYER Brick 4. Release the Ads v2 sync lock, but only if this holder still owns it. Returns true when it released and nothing when the lock had already been taken over, which is how a hung runner is stopped from freeing a lock somebody else is now holding.';

REVOKE ALL ON FUNCTION public.adsv2_claim_sync_lock(TEXT, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adsv2_release_sync_lock(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adsv2_claim_sync_lock(TEXT, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.adsv2_release_sync_lock(TEXT, TEXT) TO service_role;

COMMIT;
