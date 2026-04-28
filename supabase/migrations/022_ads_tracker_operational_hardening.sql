-- 022_ads_tracker_operational_hardening.sql
-- Keep Ads/Sales attribution data behind server routes instead of direct anon reads.

DROP POLICY IF EXISTS "Allow anon read sales tracker rows" ON sales_tracker_rows;
