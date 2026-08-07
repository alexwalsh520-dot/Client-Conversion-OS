-- 079_labeler_backfill_since_attribution_floor.sql
-- TRUTH LAYER, Brick 4. Run the upgraded labeler (078) over the FULL history
-- since the attribution floor, so the past gets the same truth as the present.
--
-- WHY THIS IS A SEPARATE STATEMENT AND NOT A NICE-TO-HAVE.
-- The hourly sync labels the last FACTS_LOOKBACK_DAYS (45) days only. Without a
-- backfill, part C's organic flag and part D's queue closures would creep
-- backwards one day at a time and never reach the oldest rows at all: the fix
-- would be live and the history would stay wrong, which is the worst of both.
--
-- The active roster is passed EXPLICITLY rather than read from the registry
-- here. Part A of the labeler decides "former creator" by asking which creators
-- are active, so the roster it runs under has to be the roster the facts were
-- built under, pinned in the migration, not whatever the registry happens to
-- say on the day someone replays this file. Tyson and Jake, per the roster
-- decision of 2026-07-21.
--
-- Idempotent. The labeler's own guards mean a second run changes 0 rows, and
-- that was verified on the live database immediately after the first run.
--
-- Applied 2026-08-07. Live result:
--   first run  12 rows changed  (4 part C organic flags, 8 part D closures)
--   second run  0 rows changed
--
-- Bucket effect, business-wide, 2026-05-22 to 2026-08-07:
--   awaiting_review  47 wins / 5,289,300 cents  ->  41 wins / 4,019,500 cents
--   misc_chat         0 wins /         0 cents  ->   6 wins / 1,269,800 cents
-- Nothing moved into or out of the ad bucket. No money number changed; only
-- the honesty of the labels on it did.

SELECT public.adsv2_label_sale_origins(
  DATE '2026-05-22',
  CURRENT_DATE,
  ARRAY['tyson','jake']
) AS rows_changed;
