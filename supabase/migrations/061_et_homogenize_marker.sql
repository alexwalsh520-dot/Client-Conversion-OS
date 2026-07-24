-- Item 6: finish the ET homogenization for good. The 662 rows dated
-- 2026-06-18..2026-07-16 that lacked the America/New_York reporting marker are
-- all Antwan, whose ad account reports in America/New_York (account_timezone =
-- 'America/New_York'). For an ET account, Meta's daily rows are ALREADY bucketed
-- by ET days, so these rows were never Pacific-bucketed; they simply lacked the
-- marker that a side path failed to write. This stamps the marker on rows we can
-- prove are ET (account_timezone = America/New_York), which is exactly the
-- ET-native result. Additive only: spend, impressions, and dates are untouched,
-- and v1 (which does not filter on the marker) is unaffected. Idempotent.
update ads_meta_insights_daily
set raw_payload = jsonb_set(coalesce(raw_payload, '{}'::jsonb), '{reporting_timezone}', '"America/New_York"'::jsonb)
                  || jsonb_build_object('homogenized_et_marker', '2026-07-24', 'homogenize_basis', 'account_timezone=America/New_York')
where account_timezone = 'America/New_York'
  and (raw_payload->>'reporting_timezone') is distinct from 'America/New_York';

-- Assertion helper for the nightly self-check: how many spend rows for the
-- served clients lack the ET marker. `is distinct from` correctly counts NULL
-- markers too (a plain <> would silently skip them). Must always be zero.
create or replace function adsv2_unmarked_served_spend(p_clients text[])
returns bigint language sql stable as $$
  select count(*)::bigint
  from ads_meta_insights_daily
  where client_key = any(p_clients)
    and (raw_payload->>'reporting_timezone') is distinct from 'America/New_York';
$$;
grant execute on function adsv2_unmarked_served_spend(text[]) to service_role;
