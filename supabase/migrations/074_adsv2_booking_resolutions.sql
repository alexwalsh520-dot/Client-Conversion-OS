-- ─────────────────────────────────────────────────────────────────────────
-- Human resolutions for BOOKING attribution, mirroring adsv2_sale_resolutions
-- for sales. The signed resolution-order definition says a recorded human
-- resolution (who decided, when, why) outranks machine guesses and survives
-- every resync - but until now the store only existed for sales. First real
-- case: a setter pasted the METER booking link into a chat whose actual ad
-- keyword was BADGE, so the UTM (the machine's best evidence) is simply
-- wrong and re-fires of the GHL webhook would keep restoring the error.
--
-- Consulted in three places:
--   1. the facts builder (facts.ts) - corrected keyword wins, stamped as
--      evidence_key 'human_resolution' with the reason on the row;
--   2. the stamp function below - resolution subscriber_id becomes ladder
--      step 0, ahead of the appointment payload and the bridge;
--   3. the GHL appointment webhook - so a later webhook event for the same
--      appointment cannot silently restore the wrong UTM keyword.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists adsv2_booking_resolutions (
  appointment_key text primary key,
  client_key text not null,
  keyword_normalized text,
  subscriber_id text,
  resolved_by text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Stamp function: human-resolved subscriber outranks every machine ladder
-- step. Everything else is unchanged from migration 073.
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
          res.subscriber_id,
          nullif(ga.manychat_user_id, ''),
          mcl.subscriber_id,
          pc.sub,
          sp.sub
        ) as sub
      from adsv2_booking_facts bf2
      -- (0) a recorded human resolution for this appointment
      left join adsv2_booking_resolutions res
        on res.appointment_key = bf2.appointment_key
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

-- First resolution: Ralph Toussaint's 2026-08-05 strategy session on Jake's
-- calendar. The setter pasted the METER booking link into ManyChat chat
-- 661411593, but that subscriber's actual ad keyword event is BADGE
-- (dm_keyword 2026-08-05 01:32 UTC). Attribution corrected by Alex.
insert into adsv2_booking_resolutions
  (appointment_key, client_key, keyword_normalized, subscriber_id, resolved_by, reason)
values (
  'kx1aXOP4eNVaPmub9Q7P',
  'jake',
  'badge',
  '661411593',
  'alex',
  'Setter pasted the wrong booking link: UTM said METER but the chat (ManyChat subscriber 661411593) DMed keyword BADGE hours before booking. Confirmed by Alex from the ManyChat chat on 2026-08-05.'
)
on conflict (appointment_key) do update
  set keyword_normalized = excluded.keyword_normalized,
      subscriber_id = excluded.subscriber_id,
      resolved_by = excluded.resolved_by,
      reason = excluded.reason;
