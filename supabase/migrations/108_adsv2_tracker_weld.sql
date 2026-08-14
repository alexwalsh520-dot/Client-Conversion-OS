-- ─────────────────────────────────────────────────────────────────────────
-- TRACKER WELD (Alex, 2026-08-13). The sales tracker is the richest identity
-- source we have: a human pastes the person's ManyChat link on every call.
-- Verified 8/13: bookings carry that id only ~half the time, and ~11 of
-- Tyson's August calls had no sales-calendar booking at all, so Booked and
-- show rate undercounted reality by 3-4x. This function runs after the
-- hard-key ladder (073) and bridge recovery (brick 5) each facts rebuild.
--
-- Pass 1 WELD: an unlinked booking adopts the subscriber id of the tracker
-- rows on the same creator whose prospect name matches the booking's person
-- name — exact normalized match, or levenshtein <= 2 on names >= 8 chars to
-- survive sheet typos (Hildago/Hidalgo, Suroweic/Surowiec) — with the call
-- dated within -7..+60 days of the booking. Two+ candidate subscribers weld
-- nothing: report, never referee. taken is OR-ed with the tracker's
-- call_taken so show rate sees the call.
--
-- Pass 2 OFF-CALENDAR: a non-organic, keyword-resolved tracker row whose
-- subscriber has no booking on the creator (and no name-similar booking
-- either, so a typo can never double-count a person) gets a synthetic
-- booking fact, appointment_key 'tracker:<sale_key>'. Its booked day is the
-- tracker call day — an approximation the row admits in its evidence.
-- created_time stays null so the call-before-booking gate ignores it.
-- 'Miscellaneous Chat' rows are not calls and never synthesize.
--
-- Both passes only touch rows the ladder left blank, both stamp evidence,
-- and both are idempotent: facts rebuilds delete the window first, and the
-- synthetic insert re-checks appointment_key existence.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists fuzzystrmatch with schema extensions;

create or replace function public.adsv2_tracker_weld(p_from date, p_to date)
returns jsonb
language plpgsql
set search_path to 'warehouse', 'public', 'pg_temp'
as $$
declare
  v_welded integer := 0;
  v_synth integer := 0;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  -- ── Pass 1: weld tracker identity onto unlinked bookings ────────────────
  with cand as (
    select b.id as booking_id,
      s.subscriber_id,
      min(s.sale_key) as sale_key,
      bool_or(s.call_taken) as call_taken,
      min(case when lower(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g'))
                  = lower(regexp_replace(s.prospect_name, '[^a-zA-Z]', '', 'g'))
               then 'exact' else 'fuzzy' end) as match_kind
    from adsv2_booking_facts b
    join adsv2_sale_facts s
      on s.client_key = b.client_key
     and s.subscriber_id is not null
     and s.prospect_name is not null
     and s.sale_et_day between b.booked_et_day - 7 and b.booked_et_day + 60
     and (
       lower(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g'))
         = lower(regexp_replace(s.prospect_name, '[^a-zA-Z]', '', 'g'))
       or (
         length(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g')) >= 8
         and extensions.levenshtein(
           lower(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g')),
           lower(regexp_replace(s.prospect_name, '[^a-zA-Z]', '', 'g'))
         ) <= 2
       )
     )
    where b.linked_subscriber_id is null
      and b.person_name is not null
      and b.booked_et_day between p_from and p_to
    group by b.id, s.subscriber_id
  ),
  unique_cand as (
    -- Exactly ONE candidate subscriber, or nothing happens.
    select booking_id,
      min(subscriber_id) as subscriber_id,
      min(sale_key) as sale_key,
      bool_or(call_taken) as call_taken,
      min(match_kind) as match_kind
    from cand
    group by booking_id
    having count(distinct subscriber_id) = 1
  ),
  upd as (
    update adsv2_booking_facts b
    set linked_subscriber_id = u.subscriber_id,
        taken = b.taken or u.call_taken,
        dm_et_day = coalesce(b.dm_et_day, (
          select min((e.event_at at time zone 'America/New_York')::date)
          from ads_keyword_events e
          where e.subscriber_id = u.subscriber_id
            and e.event_type = 'dm_keyword'
        )),
        evidence = coalesce(b.evidence, '{}'::jsonb) || jsonb_build_object(
          'tracker_weld', jsonb_build_object(
            'subscriber', u.subscriber_id,
            'sale_key', u.sale_key,
            'match', u.match_kind
          )
        ),
        evidence_key = coalesce(b.evidence_key, 'tracker_name_match'),
        blank_reason = null
    from unique_cand u
    where b.id = u.booking_id
    returning 1
  )
  select count(*) into v_welded from upd;

  -- ── Pass 2: off-calendar calls become clearly-evidenced booking facts ───
  with candidates as (
    select s.sale_key, s.client_key, s.keyword_normalized, s.subscriber_id,
      s.prospect_name, s.sale_et_day, s.call_taken, s.setter_name
    from adsv2_sale_facts s
    where s.sale_et_day between p_from and p_to
      and s.client_key is not null
      and s.keyword_normalized is not null and s.keyword_normalized <> ''
      and not s.is_organic
      and not s.awaiting_review
      and s.subscriber_id is not null
      and coalesce(s.call_type, '') <> 'Miscellaneous Chat'
      -- Their subscriber already has a booking on this creator: not off-calendar.
      and not exists (
        select 1 from adsv2_booking_facts b
        where b.client_key = s.client_key
          and b.linked_subscriber_id = s.subscriber_id
      )
      -- A name-similar booking exists (typo territory): never risk counting
      -- the same human twice. The weld above gets them next cycle instead.
      and not exists (
        select 1 from adsv2_booking_facts b
        where b.client_key = s.client_key
          and b.person_name is not null
          and (
            lower(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g'))
              = lower(regexp_replace(s.prospect_name, '[^a-zA-Z]', '', 'g'))
            or (
              length(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g')) >= 8
              and extensions.levenshtein(
                lower(regexp_replace(b.person_name, '[^a-zA-Z]', '', 'g')),
                lower(regexp_replace(s.prospect_name, '[^a-zA-Z]', '', 'g'))
              ) <= 2
            )
          )
      )
  ),
  dedup as (
    select distinct on (client_key, subscriber_id) *
    from candidates
    order by client_key, subscriber_id, sale_et_day
  ),
  ins as (
    insert into adsv2_booking_facts (
      appointment_key, client_key, contact_id, person_name, keyword_normalized,
      is_organic, awaiting_review, calendar_id, calendar_name,
      booked_et_day, dm_et_day, is_upcoming, status, start_time, created_time,
      taken, linked_subscriber_id, setter_name,
      evidence, evidence_key, evidence_detail, blank_reason, computed_at
    )
    select
      'tracker:' || d.sale_key,
      d.client_key,
      'tracker:' || d.sale_key,
      d.prospect_name,
      d.keyword_normalized,
      false,
      false,
      null,
      'Sales tracker (off-calendar)',
      d.sale_et_day,
      (
        select min((e.event_at at time zone 'America/New_York')::date)
        from ads_keyword_events e
        where e.subscriber_id = d.subscriber_id
          and e.event_type = 'dm_keyword'
      ),
      (d.sale_et_day > v_today) or (not d.call_taken and d.sale_et_day = v_today),
      'booked',
      null,
      null,
      d.call_taken,
      d.subscriber_id,
      d.setter_name,
      jsonb_build_object(
        'source', 'sales_tracker_offcalendar',
        'sale_key', d.sale_key,
        'note', 'no sales-calendar booking exists for this taken call; booked day approximated from the tracker call day'
      ),
      'tracker_offcalendar',
      jsonb_build_object('subscriber', d.subscriber_id, 'call_day', d.sale_et_day),
      null,
      now()
    from dedup d
    where not exists (
      select 1 from adsv2_booking_facts x
      where x.appointment_key = 'tracker:' || d.sale_key
    )
    returning 1
  )
  select count(*) into v_synth from ins;

  return jsonb_build_object('welded', v_welded, 'synthetic', v_synth);
end;
$$;

revoke execute on function public.adsv2_tracker_weld(date, date) from public, anon, authenticated;
