-- Item 2: the ad creative preview must use our DURABLE stored image, never a
-- live Facebook CDN url (those expire in days, so the preview broke). We store
-- each ad's image bytes in the public 'ad-creatives' bucket at sync time
-- (ad_creative_image.stored_image_url). Serve that, keyed by the leaf's ad_id,
-- and fall back to the last-seen creative_preview only if no stored image
-- exists yet. All 140 active Tyson+Jake ads currently have a stored image.

drop function if exists adsv2_window_leaves(text[], date, date, jsonb);

create or replace function adsv2_window_leaves(
  p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb
)
returns table (
  client_key text, keyword text, ad_id text, ad_name text, campaign_id text, campaign_name text,
  adset_id text, adset_name text, ad_status text, campaign_status text, preview_url text,
  spend_cents bigint, impressions bigint, clicks bigint, messages bigint, booked bigint, upcoming bigint,
  taken_rows bigint, taken_people bigint, new_clients bigint, collected_usd_cents bigint, contracted_usd_cents bigint,
  has_spend boolean
) language sql stable as $$
  with spend_daily as (
    select amid.client_key, amid.keyword_normalized as kw, amid.date,
      amid.spend_cents, amid.impressions, amid.link_clicks,
      upper(coalesce(p_currency->>amid.client_key, 'USD')) as ccy
    from ads_meta_insights_daily amid
    where amid.client_key = any(p_clients)
      and amid.raw_payload->>'reporting_timezone' = 'America/New_York'
      and amid.date >= p_from and amid.date <= p_to
      and amid.keyword_normalized is not null and amid.keyword_normalized <> ''
  ),
  spend as (
    select client_key, kw,
      sum(case when ccy = 'USD' then spend_cents
        else round(spend_cents * coalesce((
          select fr.rate from fx_rates fr
          where fr.base = sd.ccy and fr.quote = 'USD' and fr.rate_date <= sd.date
          order by fr.rate_date desc limit 1), 1)) end)::bigint as spend_cents,
      sum(impressions)::bigint as impressions, sum(link_clicks)::bigint as clicks
    from spend_daily sd group by client_key, kw
  ),
  ident as (
    select distinct on (client_key, keyword_normalized)
      client_key, keyword_normalized as kw, ad_id, ad_name, campaign_id, campaign_name,
      adset_id, adset_name, ad_effective_status, campaign_effective_status
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and date >= (p_from - 180)
    order by client_key, keyword_normalized, date desc
  ),
  prev as (
    select distinct on (client_key, keyword_normalized)
      client_key, keyword_normalized as kw, raw_payload->>'creative_preview' as preview_url
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and raw_payload->>'creative_preview' is not null and date >= (p_from - 180)
    order by client_key, keyword_normalized, date desc
  ),
  dm as (
    select client_key, keyword_normalized as kw, count(distinct subscriber_id) as messages
    from adsv2_dm_facts
    where client_key = any(p_clients) and et_day >= p_from and et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by client_key, keyword_normalized
  ),
  booked as (
    select client_key, keyword_normalized as kw,
      count(distinct contact_id) as booked, count(distinct contact_id) filter (where is_upcoming) as upcoming
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by client_key, keyword_normalized
  ),
  taken as (
    select client_key, keyword_normalized as kw,
      count(*) filter (where call_taken) as taken_rows,
      count(distinct coalesce(subscriber_id, prospect_name)) filter (where call_taken) as taken_people,
      count(*) filter (where is_win) as new_clients,
      coalesce(sum(collected_usd_cents),0)::bigint as collected_usd_cents,
      coalesce(sum(contracted_usd_cents),0)::bigint as contracted_usd_cents
    from adsv2_sale_facts
    where client_key = any(p_clients) and sale_et_day >= p_from and sale_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by client_key, keyword_normalized
  ),
  keys as (
    select client_key, kw from spend
    union select client_key, kw from dm
    union select client_key, kw from booked
    union select client_key, kw from taken
  )
  select k.client_key, k.kw, i.ad_id, i.ad_name, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name,
    i.ad_effective_status, i.campaign_effective_status,
    coalesce(ci.stored_image_url, p.preview_url) as preview_url,
    coalesce(s.spend_cents,0), coalesce(s.impressions,0), coalesce(s.clicks,0),
    coalesce(d.messages,0), coalesce(b.booked,0), coalesce(b.upcoming,0),
    coalesce(t.taken_rows,0), coalesce(t.taken_people,0), coalesce(t.new_clients,0),
    coalesce(t.collected_usd_cents,0), coalesce(t.contracted_usd_cents,0), (s.kw is not null)
  from keys k
  join ident i on i.client_key = k.client_key and i.kw = k.kw
  left join ad_creative_image ci on ci.ad_id = i.ad_id and ci.stored_image_url is not null
  left join prev p on p.client_key = k.client_key and p.kw = k.kw
  left join spend s on s.client_key = k.client_key and s.kw = k.kw
  left join dm d on d.client_key = k.client_key and d.kw = k.kw
  left join booked b on b.client_key = k.client_key and b.kw = k.kw
  left join taken t on t.client_key = k.client_key and t.kw = k.kw
$$;
