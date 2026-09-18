-- Hammer Them campaigns are INDIRECT (dark-post remarketing to people already in
-- the DMs). They make no DMs, calls, or sales of their own, so their ad names
-- are not keywords and their spend must not sit in the attribution table or
-- dilute the Metrics cards. They get their own section on Ads v2 instead.
--
-- Rule: any campaign whose name starts with "Hammer Them - " is left out of the
-- window leaves (the table + its TOTAL) and the window days (the Metrics
-- charts). Name new hammer campaigns with that prefix and they stay out too.
-- The January 2026 "Hammer Them / CC Bin - 7 Day DM" does not match on purpose:
-- it is history and its rows keep reading exactly as they did.

create or replace function public.adsv2_window_leaves(p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb)
 returns table(client_key text, keyword text, ad_id text, ad_name text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_status text, campaign_status text, preview_url text, video_url text, is_video boolean, spend_cents bigint, impressions bigint, clicks bigint, messages bigint, booked bigint, upcoming bigint, showed_people bigint, taken_rows bigint, taken_people bigint, new_clients bigint, collected_usd_cents bigint, contracted_usd_cents bigint, lead_score_sum bigint, lead_score_n bigint, subs bigint, sub_collected_usd_cents bigint, has_spend boolean, last_spend_day date, cycle_days_sum bigint, cycle_n bigint)
 language sql
 stable
as $function$
  with spend_daily as (
    select amid.client_key, amid.keyword_normalized as kw, amid.date,
      amid.spend_cents, amid.impressions, amid.link_clicks,
      upper(coalesce(p_currency->>amid.client_key,'USD')) as ccy
    from ads_meta_insights_daily amid
    where amid.client_key = any(p_clients)
      and amid.raw_payload->>'reporting_timezone' = 'America/New_York'
      and amid.date >= p_from and amid.date <= p_to
      and amid.keyword_normalized is not null and amid.keyword_normalized <> ''
      and coalesce(amid.campaign_name,'') not ilike 'Hammer Them - %'
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
  lifespan as (
    select client_key, keyword_normalized as kw,
      max(date) filter (where spend_cents > 0) as last_spend_day
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and date >= (p_from - 180)
      and coalesce(campaign_name,'') not ilike 'Hammer Them - %'
    group by client_key, keyword_normalized
  ),
  ident as (
    select distinct on (client_key, keyword_normalized)
      client_key, keyword_normalized as kw, ad_id, ad_name, campaign_id, campaign_name,
      adset_id, adset_name, ad_effective_status, campaign_effective_status
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and date >= (p_from - 180)
      and coalesce(campaign_name,'') not ilike 'Hammer Them - %'
    order by client_key, keyword_normalized, date desc
  ),
  prev as (
    select distinct on (client_key, keyword_normalized)
      client_key, keyword_normalized as kw, raw_payload->>'creative_preview' as preview_url
    from ads_meta_insights_daily
    where client_key = any(p_clients) and keyword_normalized is not null and keyword_normalized <> ''
      and raw_payload->>'creative_preview' is not null and date >= (p_from - 180)
      and coalesce(campaign_name,'') not ilike 'Hammer Them - %'
    order by client_key, keyword_normalized, date desc
  ),
  dm as (
    select client_key, keyword_normalized as kw, count(distinct subscriber_id) as messages
    from adsv2_dm_facts
    where client_key = any(p_clients) and et_day >= p_from and et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
    group by client_key, keyword_normalized
  ),
  scores as (
    select ls.client_key, ls.keyword_normalized as kw,
      sum(ls.score)::bigint as lead_score_sum,
      count(*)::bigint as lead_score_n
    from lead_scores ls
    where ls.client_key = any(p_clients)
      and ls.band in ('high','medium','low')
      and ls.keyword_normalized is not null and ls.keyword_normalized <> ''
      and (ls.first_keyword_at at time zone 'America/New_York')::date >= p_from
      and (ls.first_keyword_at at time zone 'America/New_York')::date <= p_to
    group by ls.client_key, ls.keyword_normalized
  ),
  bk_person as (
    select client_key, keyword_normalized as kw, contact_id,
      bool_or(taken) as taken_any, bool_or(is_upcoming) as upcoming_any
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review and keyword_normalized is not null and keyword_normalized <> ''
      and contact_id is not null
    group by client_key, keyword_normalized, contact_id
  ),
  booked as (
    select client_key, kw,
      count(*) as booked,
      count(*) filter (where upcoming_any and not taken_any) as upcoming,
      count(*) filter (where taken_any) as showed_people
    from bk_person group by client_key, kw
  ),
  first_dm as (
    select subscriber_id, min(et_day) as first_dm_day
    from adsv2_dm_facts
    where subscriber_id is not null and subscriber_id <> ''
    group by subscriber_id
  ),
  taken as (
    select s.client_key, s.keyword_normalized as kw,
      count(*) filter (where s.call_taken) as taken_rows,
      count(distinct coalesce(s.subscriber_id, s.prospect_name)) filter (where s.call_taken) as taken_people,
      count(*) filter (where s.is_win) as new_clients,
      coalesce(sum(s.collected_usd_cents),0)::bigint as collected_usd_cents,
      coalesce(sum(s.contracted_usd_cents),0)::bigint as contracted_usd_cents,
      count(*) filter (where s.sale_kind = 'subscription') as subs,
      coalesce(sum(s.collected_usd_cents) filter (where s.sale_kind in ('subscription','renewal')),0)::bigint as sub_collected_usd_cents,
      coalesce(sum(s.sale_et_day - f.first_dm_day) filter (where s.is_win and f.first_dm_day <= s.sale_et_day),0)::bigint as cycle_days_sum,
      count(*) filter (where s.is_win and f.first_dm_day <= s.sale_et_day)::bigint as cycle_n
    from adsv2_sale_facts s
    left join first_dm f on f.subscriber_id = s.subscriber_id
    where s.client_key = any(p_clients) and s.sale_et_day >= p_from and s.sale_et_day <= p_to
      and not s.is_organic and not s.awaiting_review and s.keyword_normalized is not null and s.keyword_normalized <> ''
    group by s.client_key, s.keyword_normalized
  ),
  keys as (
    select client_key, kw from spend
    union select client_key, kw from dm
    union select client_key, kw from booked
    union select client_key, kw from taken
  )
  select k.client_key, k.kw, i.ad_id, i.ad_name, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name,
    i.ad_effective_status, i.campaign_effective_status,
    coalesce(ci.stored_thumb_url, ci.stored_image_url, p.preview_url) as preview_url,
    ci.stored_video_url as video_url,
    coalesce(ci.is_video, false) as is_video,
    coalesce(s.spend_cents,0), coalesce(s.impressions,0), coalesce(s.clicks,0),
    coalesce(d.messages,0), coalesce(b.booked,0), coalesce(b.upcoming,0),
    coalesce(b.showed_people,0),
    coalesce(t.taken_rows,0), coalesce(t.taken_people,0), coalesce(t.new_clients,0),
    coalesce(t.collected_usd_cents,0), coalesce(t.contracted_usd_cents,0),
    coalesce(sc.lead_score_sum,0), coalesce(sc.lead_score_n,0),
    coalesce(t.subs,0), coalesce(t.sub_collected_usd_cents,0),
    (s.kw is not null),
    ls.last_spend_day,
    coalesce(t.cycle_days_sum,0), coalesce(t.cycle_n,0)
  from keys k
  join ident i on i.client_key = k.client_key and i.kw = k.kw
  left join ad_creative_image ci on ci.ad_id = i.ad_id
  left join prev p on p.client_key = k.client_key and p.kw = k.kw
  left join spend s on s.client_key = k.client_key and s.kw = k.kw
  left join dm d on d.client_key = k.client_key and d.kw = k.kw
  left join booked b on b.client_key = k.client_key and b.kw = k.kw
  left join taken t on t.client_key = k.client_key and t.kw = k.kw
  left join scores sc on sc.client_key = k.client_key and sc.kw = k.kw
  left join lifespan ls on ls.client_key = k.client_key and ls.kw = k.kw
$function$;

create or replace function public.adsv2_window_days(p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb)
 returns table(et_day date, spend_cents bigint, impressions bigint, clicks bigint, messages bigint, booked bigint, taken bigint, new_clients bigint, collected_usd_cents bigint, subs bigint, sub_collected_usd_cents bigint)
 language sql
 stable
as $function$
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
      and coalesce(amid.campaign_name,'') not ilike 'Hammer Them - %'
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
      coalesce(sum(collected_usd_cents),0)::bigint as collected_usd_cents,
      count(*) filter (where sale_kind = 'subscription') as subs,
      coalesce(sum(collected_usd_cents) filter (where sale_kind in ('subscription','renewal')),0)::bigint as sub_collected_usd_cents
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
    coalesce(tk.taken,0), coalesce(tk.new_clients,0), coalesce(tk.collected_usd_cents,0),
    coalesce(tk.subs,0), coalesce(tk.sub_collected_usd_cents,0)
  from generate_series(p_from, p_to, interval '1 day') gd
  left join spend s on s.d = gd::date
  left join dm on dm.d = gd::date
  left join bk on bk.d = gd::date
  left join tk on tk.d = gd::date
  order by gd;
$function$;
