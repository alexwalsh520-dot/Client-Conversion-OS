-- ─────────────────────────────────────────────────────────────────────────
-- Ads v2 Part D: the Metrics section's charts need a per-ET-day series the slim
-- table payload does not carry. We store that day series BESIDE the table
-- snapshot, in the same row and at the same data_version, so the cards and the
-- table can never disagree and nothing is computed from raw tables at request
-- time. The client lazily fetches this slice after the table paints.
-- ─────────────────────────────────────────────────────────────────────────

alter table adsv2_window_snapshots add column if not exists metrics_payload jsonb;

-- Per-ET-day aggregates over the window, with the SAME paid / not-organic /
-- not-awaiting filters as the table leaves, so every card sums to the table.
-- Spend is USD-converted per day exactly like adsv2_window_leaves.
create or replace function adsv2_window_days(
  p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb
)
returns table (
  et_day date, spend_cents bigint, impressions bigint, clicks bigint,
  messages bigint, booked bigint, taken bigint, new_clients bigint, collected_usd_cents bigint
)
language sql stable as $$
  with spend as (
    select amid.date as d,
      sum(case when upper(coalesce(p_currency->>amid.client_key,'USD'))='USD' then amid.spend_cents
        else round(amid.spend_cents * coalesce((
          select fr.rate from fx_rates fr
          where fr.base = upper(coalesce(p_currency->>amid.client_key,'USD')) and fr.quote='USD' and fr.rate_date <= amid.date
          order by fr.rate_date desc limit 1),1)) end)::bigint as spend_cents,
      sum(amid.impressions)::bigint as impressions,
      sum(amid.link_clicks)::bigint as clicks
    from ads_meta_insights_daily amid
    where amid.client_key = any(p_clients)
      and amid.raw_payload->>'reporting_timezone' = 'America/New_York'
      and amid.date >= p_from and amid.date <= p_to
      and amid.keyword_normalized is not null and amid.keyword_normalized <> ''
    group by amid.date
  ),
  dm as (
    select et_day as d, count(distinct subscriber_id) as messages
    from adsv2_dm_facts
    where client_key = any(p_clients) and et_day >= p_from and et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by et_day
  ),
  bk as (
    select booked_et_day as d, count(distinct contact_id) as booked
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by booked_et_day
  ),
  tk as (
    select sale_et_day as d,
      count(*) filter (where call_taken) as taken,
      count(*) filter (where is_win) as new_clients,
      coalesce(sum(collected_usd_cents),0)::bigint as collected_usd_cents
    from adsv2_sale_facts
    where client_key = any(p_clients) and sale_et_day >= p_from and sale_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by sale_et_day
  ),
  days as (
    select d from spend union select d from dm union select d from bk union select d from tk
  )
  select gd::date as et_day,
    coalesce(s.spend_cents,0), coalesce(s.impressions,0), coalesce(s.clicks,0),
    coalesce(dm.messages,0), coalesce(bk.booked,0),
    coalesce(tk.taken,0), coalesce(tk.new_clients,0), coalesce(tk.collected_usd_cents,0)
  from generate_series(p_from, p_to, interval '1 day') gd
  left join spend s on s.d = gd::date
  left join dm on dm.d = gd::date
  left join bk on bk.d = gd::date
  left join tk on tk.d = gd::date
  order by gd;
$$;
