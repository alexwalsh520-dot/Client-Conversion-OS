-- 077_door_health_check_thresholds.sql
-- TRUTH LAYER, Brick 3: freshness thresholds for the two sources health_check
-- reads that Brick 2 never had to judge.
--
-- WHY THIS EXISTS. health_check is the one template allowed a LIVE external
-- read, and its whole value is that a live picture can see what stored rows
-- cannot (a campaign sitting in review burns nothing, so it writes nothing).
-- That value inverts the moment the live read fails and the answer quietly
-- falls back to the store while still LOOKING live.
--
-- Brick 2 already has the machinery to prevent that: `staleSources` flags any
-- source that is past its threshold OR that reports no write time at all. But
-- it only judges sources that HAVE a threshold row, so without these two rows
-- a fallback answer would sail through with an empty `stale` list. These rows
-- are what make the receipt say so.
--
-- `meta_graph_live` is deliberately 1 hour: a live read is either happening now
-- or it is not one.
--
-- Additive and idempotent, and ON CONFLICT DO NOTHING so a value ops has since
-- tuned is never stamped back to this file's opinion.

BEGIN;

INSERT INTO public.door_freshness_thresholds (source, threshold_hours, note)
VALUES
  ('meta_graph_live', 1,
   'the live Meta Graph read. A live picture is either current or it is not live at all, so this is tight on purpose: an answer that fell back to stored rows reports no write time here and is flagged.'),
  ('adsv2_budget_snapshots', 26,
   'the daily budget photos. One per Eastern day for anything active, so a full day plus a margin means a whole cycle was missed.')
ON CONFLICT (source) DO NOTHING;

COMMIT;
