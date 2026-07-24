-- ─────────────────────────────────────────────────────────────────────────
-- Ads v2 round 3, Part A1 + A2: DMed dates on bookings, and a cohort-true
-- show rate.
--
-- A1: resolve each booking to a ManyChat subscriber by HARD KEY only, in a
-- fixed priority order, then stamp the person's earliest DM day for the ad's
-- keyword (any date, not window-limited) as dm_et_day. Never name matching.
--
-- A2: the show rate must be one cohort. We add a `taken` flag to each booking,
-- set by a hard-key link from the booked person to a taken sales-tracker row,
-- so the show-rate cell and its popup are computed from the SAME booked-in-
-- window people. The leaves function then reports `showed_people` = booked-in-
-- window people (not upcoming) who have that hard-key-linked taken record.
-- ─────────────────────────────────────────────────────────────────────────

-- Hard-key lookup indexes the stamp function needs (all were missing).
create index if not exists idx_ads_keyword_events_subscriber_dm
  on ads_keyword_events (subscriber_id)
  where event_type = 'dm_keyword';
create index if not exists idx_manychat_contact_links_ghl_contact
  on manychat_contact_links (ghl_contact_id);
create index if not exists idx_person_context_contact_ids
  on person_context using gin (contact_ids);

-- The hard-key link from a booked person to a taken call.
alter table adsv2_booking_facts add column if not exists taken boolean not null default false;

-- ── Stamp DMed dates and the taken link, set-based, over a day range ────────
-- Resolves each booking's subscriber by the hard-key ladder:
--   (a) the appointment's own raw_payload manychat_user_id,
--   (b) the stored ManyChat<->GHL bridge (manychat_contact_links),
--   (c) the Foundation identity graph (person_context, hard links only),
--   (d) the ManyChat id pasted on that person's own sale row (bridged back).
-- Then:
--   dm_et_day = earliest dm_keyword event for (subscriber, this keyword), any
--               date; else the subscriber's earliest dm_keyword event at all.
--   taken     = the subscriber has a sales-tracker row marked call taken.
-- No name matching anywhere. A booking with no hard key stays null (a dash).
create or replace function adsv2_stamp_booking_links(p_from date, p_to date)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update adsv2_booking_facts bf
  set dm_et_day = r.dm_day,
      taken = r.taken
  from (
    select b.id,
      coalesce(kw.kw_day, anyd.any_day) as dm_day,
      (tk.hit is not null) as taken
    from (
      select bf2.id, bf2.client_key, bf2.contact_id, bf2.keyword_normalized,
        coalesce(
          nullif(ga.manychat_user_id, ''),
          mcl.subscriber_id,
          pc.sub,
          sp.sub
        ) as sub
      from adsv2_booking_facts bf2
      -- (a) the appointment's own manychat_user_id from raw_payload
      left join lateral (
        select nullif(g.raw_payload->>'manychat_user_id','') as manychat_user_id
        from ghl_appointments g
        where g.appointment_id = bf2.appointment_key
        limit 1
      ) ga on true
      -- (b) the stored ManyChat<->GHL bridge
      left join lateral (
        select m.subscriber_id
        from manychat_contact_links m
        where m.ghl_contact_id = bf2.contact_id
        limit 1
      ) mcl on true
      -- (c) the Foundation identity graph, hard links only (never name-linked)
      left join lateral (
        select (x.subscriber_ids)[1] as sub
        from person_context x
        where x.client_key = bf2.client_key
          and x.linked_via in ('subscriber','contact')
          and array_length(x.subscriber_ids,1) >= 1
          and bf2.contact_id = any(x.contact_ids)
        limit 1
      ) pc on true
      -- (d) a sale row for this contact (bridged) that pasted a subscriber id
      left join lateral (
        select s.manychat_subscriber_id as sub
        from sales_tracker_rows s
        join manychat_contact_links m2 on m2.subscriber_id = s.manychat_subscriber_id
        where m2.ghl_contact_id = bf2.contact_id
          and nullif(s.manychat_subscriber_id,'') is not null
        limit 1
      ) sp on true
      where bf2.booked_et_day >= p_from and bf2.booked_et_day <= p_to
    ) b
    -- earliest DM for this keyword, any date (not window-limited)
    left join lateral (
      select min((e.event_at at time zone 'America/New_York')::date) as kw_day
      from ads_keyword_events e
      where e.subscriber_id = b.sub and e.event_type = 'dm_keyword'
        and lower(e.keyword_normalized) = lower(b.keyword_normalized)
    ) kw on true
    -- else the subscriber's earliest DM at all
    left join lateral (
      select min((e.event_at at time zone 'America/New_York')::date) as any_day
      from ads_keyword_events e
      where e.subscriber_id = b.sub and e.event_type = 'dm_keyword'
    ) anyd on true
    -- the hard-key taken link
    left join lateral (
      select 1 as hit
      from sales_tracker_rows s
      where s.manychat_subscriber_id = b.sub
        and lower(coalesce(s.call_taken_status,'')) = 'yes'
      limit 1
    ) tk on true
  ) r
  where bf.id = r.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Leaves function: add cohort-true showed_people (person-level) ────────────
-- The serving path calls the 4-arg (p_currency) form. showed_people = people
-- BOOKED in the window who have the hard-key-linked taken record, aggregated
-- per person so a taken call outranks an upcoming reschedule (showed wins),
-- exactly like the popup. Denominator = booked minus upcoming (not-taken). The
-- cell and its popup are the same booked-in-window cohort by construction.
drop function if exists adsv2_window_leaves(text[], date, date);
drop function if exists adsv2_window_leaves(text[], date, date, jsonb);
create or replace function adsv2_window_leaves(
  p_clients text[], p_from date, p_to date, p_currency jsonb default '{}'::jsonb
)
returns table (
  client_key text, keyword text, ad_id text, ad_name text, campaign_id text, campaign_name text,
  adset_id text, adset_name text, ad_status text, campaign_status text, preview_url text,
  spend_cents bigint, impressions bigint, clicks bigint, messages bigint, booked bigint, upcoming bigint,
  showed_people bigint,
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
    coalesce(b.showed_people,0),
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

-- ── Independent show-rate cohort recompute (nightly parity gate, A2) ─────────
-- The self-check compares this to the leaves numbers the cell renders. If they
-- ever diverge, the cell and its popup would disagree and the gate fails.
create or replace function adsv2_showrate_cohort(p_clients text[], p_from date, p_to date)
returns table(client_key text, keyword text, showed bigint, due bigint)
language sql stable as $$
  with p as (
    select client_key, keyword_normalized as kw, contact_id,
      bool_or(taken) as taken_any, bool_or(is_upcoming) as upcoming_any
    from adsv2_booking_facts
    where client_key = any(p_clients) and booked_et_day >= p_from and booked_et_day <= p_to
      and not is_organic and not awaiting_review
      and keyword_normalized is not null and keyword_normalized <> '' and contact_id is not null
    group by client_key, keyword_normalized, contact_id
  )
  select client_key, kw,
    count(*) filter (where taken_any)::bigint as showed,
    count(*) filter (where not (upcoming_any and not taken_any))::bigint as due
  from p group by client_key, kw
$$;
