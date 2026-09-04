-- 2026-09-04 · Repo record of live migration adsv2_lane_rows_upcoming
-- Adds an `upcoming` column to public.adsv2_lane_rows for the lanes table's
-- new "Upcoming calls" column. Same person-level rule as the paid table's
-- Upcoming: a person booked in the window whose booking is still upcoming and
-- has no taken record yet (bool_or(is_upcoming) and not bool_or(taken), grouped
-- by coalesce(linked_subscriber_id, contact_id)). Only the organic and
-- not-attributed lanes have a booking source, so the other lanes stay null
-- (rendered as a dash, never zero).
--
-- Return-type change, so the old function is dropped first. The app calls the
-- function by name through PostgREST with named results; code deployed before
-- this migration simply ignores the extra column, so applying it first is safe.

drop function if exists public.adsv2_lane_rows(text[], date, date);

create or replace function public.adsv2_lane_rows(p_clients text[], p_from date, p_to date)
returns table(client_key text, bucket text, dms bigint, booked bigint, upcoming bigint, taken bigint, wins bigint, collected_usd_cents bigint)
language sql
stable
set search_path to 'warehouse', 'public', 'pg_temp'
as $function$
  with organic_dm as (
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
      coalesce(sum(s.collected_usd_cents),0)::bigint cents
    from adsv2_sale_facts s
    where s.client_key = any(p_clients) and s.sale_et_day between p_from and p_to and s.is_organic
    group by 1
  ),
  misc_sale as (
    select coalesce(s.client_key,'team') ck,
      count(*) filter (where s.call_taken)::bigint taken,
      count(*) filter (where s.is_win)::bigint wins,
      coalesce(sum(s.collected_usd_cents),0)::bigint cents
    from adsv2_sale_facts s
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
      coalesce(sum(s.collected_usd_cents),0)::bigint cents
    from adsv2_sale_facts s
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
                  else null end collected_usd_cents
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
