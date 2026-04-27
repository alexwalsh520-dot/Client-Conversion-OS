-- 020_ads_tracker_tighten_rls.sql
-- Raw Ads Tracker tables should be accessed through authenticated server APIs.
-- The Supabase service role bypasses RLS, so broad public policies are unnecessary.

DROP POLICY IF EXISTS "Allow anon read ads meta insights" ON ads_meta_insights_daily;
DROP POLICY IF EXISTS "Allow service role manage ads meta insights" ON ads_meta_insights_daily;

DROP POLICY IF EXISTS "Allow anon read ads keyword events" ON ads_keyword_events;
DROP POLICY IF EXISTS "Allow service role manage ads keyword events" ON ads_keyword_events;

DROP POLICY IF EXISTS "Allow anon read ads attribution exceptions" ON ads_attribution_exceptions;
DROP POLICY IF EXISTS "Allow service role manage ads attribution exceptions" ON ads_attribution_exceptions;

DROP POLICY IF EXISTS "Allow anon read ads sync runs" ON ads_sync_runs;
DROP POLICY IF EXISTS "Allow service role manage ads sync runs" ON ads_sync_runs;

DROP POLICY IF EXISTS "Allow anon read ads keyword backfill" ON ads_keyword_backfill_daily;
DROP POLICY IF EXISTS "Allow service role manage ads keyword backfill" ON ads_keyword_backfill_daily;

DROP POLICY IF EXISTS "Allow anon read ads keyword backfill issues" ON ads_keyword_backfill_reconciliation_issues;
DROP POLICY IF EXISTS "Allow service role manage ads keyword backfill issues" ON ads_keyword_backfill_reconciliation_issues;

