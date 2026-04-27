-- 021_ads_tracker_meta_status.sql
-- Store lightweight Meta ad/campaign status so Active/Finished filters are data-backed.

ALTER TABLE ads_meta_insights_daily
  ADD COLUMN IF NOT EXISTS ad_effective_status text,
  ADD COLUMN IF NOT EXISTS ad_configured_status text,
  ADD COLUMN IF NOT EXISTS campaign_effective_status text,
  ADD COLUMN IF NOT EXISTS campaign_configured_status text;

CREATE INDEX IF NOT EXISTS idx_ads_meta_insights_status
  ON ads_meta_insights_daily (client_key, ad_effective_status, campaign_effective_status, date DESC);
