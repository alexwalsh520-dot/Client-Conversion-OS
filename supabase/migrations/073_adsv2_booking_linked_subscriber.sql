-- ─────────────────────────────────────────────────────────────────────────
-- Ads v2: persist the hard-key-resolved ManyChat subscriber on each booking
-- fact. The stamp function already resolves it (ladder a-d) to set dm_et_day
-- and `taken`, but threw the id away, so nothing downstream could join a
-- taken SALE back to its BOOKING. The hover popups need that join: the
-- "calls taken" popup showed permanent dashes in its DMed and Booked columns
-- because the sale fact alone carries neither date.
--
-- Same ladder, same no-name-matching rule; the only change is that the
-- resolved subscriber id is now written to the row.
-- ─────────────────────────────────────────────────────────────────────────

alter table adsv2_booking_facts add column if not exists linked_subscriber_id text;

create index if not exists idx_adsv2_booking_facts_linked_sub
  on adsv2_booking_facts (linked_subscriber_id)
  where linked_subscriber_id is not null;

create or replace function adsv2_stamp_booking_links(p_from date, p_to date)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update adsv2_booking_facts bf
  set dm_et_day = r.dm_day,
      taken = r.taken,
      linked_subscriber_id = r.sub
  from (
    select b.id, b.sub,
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

-- Backfill every stored booking fact once; the sync re-stamps its own range
-- every run from here on.
select adsv2_stamp_booking_links(
  (current_date - 180)::date,
  (current_date + 90)::date
);
