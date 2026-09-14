-- ─────────────────────────────────────────────────────────────────────────
-- SALES CYCLE (Alex, 2026-09-14): how many days pass between a person's FIRST
-- keyword DM and the day their sale is logged, averaged per row.
--
-- Rules:
--   * One number per new client (is_win) in the window, by hard key only:
--     the sale's subscriber_id must match a DM fact's subscriber_id. Names are
--     never used. A win with no matched DM is left out of the average (it is
--     not a zero).
--   * "First DM" = the earliest ET day that subscriber sent ANY keyword
--     (paid or organic, any creator). The clock starts the first time they
--     reached out, not the time they sent this ad's keyword.
--   * The DM must be on or before the sale day; a later DM is not a cycle.
--   * Both RPCs return a SUM of days and a COUNT of matched wins, so any level
--     (ad, ad set, campaign, TOTAL) averages as sum / count over its children,
--     the same way the Lead Score column rolls up.
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.adsv2_window_leaves(text[], date, date, jsonb);

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
    group by client_key, keyword_normalized
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
  -- The first keyword DM ever recorded for each subscriber, any keyword, any
  -- creator. Hard key only (subscriber id).
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

drop function if exists public.adsv2_lane_rows(text[], date, date);

create or replace function public.adsv2_lane_rows(p_clients text[], p_from date, p_to date)
 returns table(client_key text, bucket text, dms bigint, booked bigint, upcoming bigint, taken bigint, wins bigint, collected_usd_cents bigint, cycle_days_sum bigint, cycle_n bigint)
 language sql
 stable
 set search_path to 'warehouse', 'public', 'pg_temp'
as $function$
  with first_dm as (
    select subscriber_id, min(et_day) as first_dm_day
    from adsv2_dm_facts
    where subscriber_id is not null and subscriber_id <> ''
    group by subscriber_id
  ),
  organic_dm as (
    select d.client_key ck, count(distinct (d.keyword_normalized, d.subscriber_id))::bigint dms
    from adsv2_dm_facts d
    where d.client_key = any(p_clients) and d.et_day between p_from and p_to and d.is_organic
    group by 1
  ),
  organic_bk_person as (
    select b.client_key ck, coalesce(b.linked_subscriber_id, b.contact_id) person,
      bool_or(b.taken) taken_any, bool_or(b.is_upcoming) upcoming_any
    from adsv2_booking_facts b
    where b.client_key = any(p_clients) and b.booked_et_day between p_from and p_to
      and b.is_organic and not b.awaiting_review
      and coalesce(b.linked_subscriber_id, b.contact_id) is not null
    group by 1, 2
  ),
  organic_bk as (
    select ck, count(*)::bigint booked,
      count(*) filter (where upcoming_any and not taken_any)::bigint upcoming
    from organic_bk_person
    group by 1
  ),
  organic_sale as (
    select s.client_key ck,
      count(*) filter (where s.call_taken)::bigint taken,
      count(*) filter (where s.is_win)::bigint wins,
      coalesce(sum(s.collected_usd_cents),0)::bigint cents,
      coalesce(sum(s.sale_et_day - f.first_dm_day) filter (where s.is_win and f.first_dm_day <= s.sale_et_day),0)::bigint cycle_days_sum,
      count(*) filter (where s.is_win and f.first_dm_day <= s.sale_et_day)::bigint cycle_n
    from adsv2_sale_facts s
    left join first_dm f on f.subscriber_id = s.subscriber_id
    where s.client_key = any(p_clients) and s.sale_et_day between p_from and p_to and s.is_organic
    group by 1
  ),
  misc_sale as (
    select coalesce(s.client_key,'team') ck,
      count(*) filter (where s.call_taken)::bigint taken,
      count(*) filter (where s.is_win)::bigint wins,
      coalesce(sum(s.collected_usd_cents),0)::bigint cents,
      coalesce(sum(s.sale_et_day - f.first_dm_day) filter (where s.is_win and f.first_dm_day <= s.sale_et_day),0)::bigint cycle_days_sum,
      count(*) filter (where s.is_win and f.first_dm_day <= s.sale_et_day)::bigint cycle_n
    from adsv2_sale_facts s
    left join first_dm f on f.subscriber_id = s.subscriber_id
    where s.sale_et_day between p_from and p_to
      and (lower(coalesce(s.call_type,'')) = 'miscellaneous chat'
           or coalesce(s.blank_reason,'') = 'human_confirmed_non_ad')
      and not (s.keyword_normalized is not null and s.keyword_normalized <> '' and not s.awaiting_review)
    group by 1
  ),
  follower_dm as (
    select case
        when m.client like 'tyson%' then 'tyson'
        when m.client like 'jake%' then 'jake'
        when m.client like 'antwan%' then 'antwan'
        else m.client end ck,
      count(distinct m.subscriber_id)::bigint dms
    from warehouse.manychat_tag_events m
    where m.tag_name = 'new_follower'
      and (m.event_at at time zone 'America/New_York')::date between p_from and p_to
    group by 1
  ),
  unattrib_bk_person as (
    select b.client_key ck, coalesce(b.linked_subscriber_id, b.contact_id) person,
      bool_or(b.taken) taken_any, bool_or(b.is_upcoming) upcoming_any
    from adsv2_booking_facts b
    where b.client_key = any(p_clients) and b.booked_et_day between p_from and p_to
      and b.awaiting_review
      and coalesce(b.linked_subscriber_id, b.contact_id) is not null
    group by 1, 2
  ),
  unattrib_bk as (
    select ck, count(*)::bigint booked,
      count(*) filter (where upcoming_any and not taken_any)::bigint upcoming
    from unattrib_bk_person
    group by 1
  ),
  unattrib_sale as (
    select coalesce(s.client_key,'team') ck,
      count(*) filter (where s.call_taken)::bigint taken,
      count(*) filter (where s.is_win)::bigint wins,
      coalesce(sum(s.collected_usd_cents),0)::bigint cents,
      coalesce(sum(s.sale_et_day - f.first_dm_day) filter (where s.is_win and f.first_dm_day <= s.sale_et_day),0)::bigint cycle_days_sum,
      count(*) filter (where s.is_win and f.first_dm_day <= s.sale_et_day)::bigint cycle_n
    from adsv2_sale_facts s
    left join first_dm f on f.subscriber_id = s.subscriber_id
    where s.sale_et_day between p_from and p_to
      and not (s.keyword_normalized is not null and s.keyword_normalized <> '' and not s.awaiting_review)
      and not s.is_organic
      and not (lower(coalesce(s.call_type,'')) = 'miscellaneous chat'
               or coalesce(s.blank_reason,'') = 'human_confirmed_non_ad')
      and not (lower(coalesce(s.call_type,'')) in ('follow up','outbound call','closer cold call')
               and coalesce(s.blank_reason,'') <> 'human_confirmed_non_ad')
    group by 1
  ),
  keys as (
    select ck, 'organic' bucket from organic_dm
    union select ck, 'organic' from organic_bk
    union select ck, 'organic' from organic_sale
    union select ck, 'misc_chat' from misc_sale
    union select ck, 'follower' from follower_dm where ck = any(p_clients)
    union select ck, 'not_attributed' from unattrib_bk
    union select ck, 'not_attributed' from unattrib_sale
  )
  select k.ck, k.bucket,
    case k.bucket when 'organic' then coalesce(od.dms,0)
                  when 'follower' then coalesce(fd.dms,0)
                  else null end dms,
    case k.bucket when 'organic' then coalesce(ob.booked,0)
                  when 'not_attributed' then coalesce(ub.booked,0)
                  else null end booked,
    case k.bucket when 'organic' then coalesce(ob.upcoming,0)
                  when 'not_attributed' then coalesce(ub.upcoming,0)
                  else null end upcoming,
    case k.bucket when 'organic' then coalesce(os.taken,0)
                  when 'misc_chat' then coalesce(ms.taken,0)
                  when 'not_attributed' then coalesce(us.taken,0)
                  else null end taken,
    case k.bucket when 'organic' then coalesce(os.wins,0)
                  when 'misc_chat' then coalesce(ms.wins,0)
                  when 'not_attributed' then coalesce(us.wins,0)
                  else null end wins,
    case k.bucket when 'organic' then coalesce(os.cents,0)
                  when 'misc_chat' then coalesce(ms.cents,0)
                  when 'not_attributed' then coalesce(us.cents,0)
                  else null end collected_usd_cents,
    case k.bucket when 'organic' then coalesce(os.cycle_days_sum,0)
                  when 'misc_chat' then coalesce(ms.cycle_days_sum,0)
                  when 'not_attributed' then coalesce(us.cycle_days_sum,0)
                  else null end cycle_days_sum,
    case k.bucket when 'organic' then coalesce(os.cycle_n,0)
                  when 'misc_chat' then coalesce(ms.cycle_n,0)
                  when 'not_attributed' then coalesce(us.cycle_n,0)
                  else null end cycle_n
  from keys k
  left join organic_dm od on od.ck = k.ck and k.bucket='organic'
  left join organic_bk ob on ob.ck = k.ck and k.bucket='organic'
  left join organic_sale os on os.ck = k.ck and k.bucket='organic'
  left join misc_sale ms on ms.ck = k.ck and k.bucket='misc_chat'
  left join follower_dm fd on fd.ck = k.ck and k.bucket='follower'
  left join unattrib_bk ub on ub.ck = k.ck and k.bucket='not_attributed'
  left join unattrib_sale us on us.ck = k.ck and k.bucket='not_attributed'
  order by k.ck, k.bucket;
$function$;
