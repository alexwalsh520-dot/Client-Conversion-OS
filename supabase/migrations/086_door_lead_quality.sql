-- ─────────────────────────────────────────────────────────────────────────
-- TRUTH LAYER BRICK 5 — question 19: lead_quality_read.
--
-- The certified version of the read that was hand-built for Jake on 7/31.
-- Per cohort, with N beside every claim: how many people sent the keyword, how
-- many of them we can actually SEE the conversation for, how deep those
-- conversations went, how many booked, how many showed, and what closed.
--
-- ── SPEAKING RULES ───────────────────────────────────────────────────────
-- Counts and observations. No verdicts. This question informs a decision; it
-- does not make one. kill_scale_read (question 11) is where a signed ruleset
-- turns numbers into a judgement, and that separation is deliberate: a
-- question that both measures and judges is a question nobody can audit.
--
-- ── THE DENOMINATOR RULE ─────────────────────────────────────────────────
-- Every rate carries the N it was computed over, and DM depth carries a second
-- N: how many of the cohort could be bridged to a real thread at all. A median
-- message count over 4 bridged people out of 27 is a fact about 4 people, and
-- printing it without that number would be the same lie as "100% coverage"
-- computed over the rows that happened to join.
--
-- ── WHY off-calendar CALLS COUNT HERE ────────────────────────────────────
-- Taken is read from the booking facts AND from the sales tracker. The 8/5
-- finding was that booked counts only the pinned sales calendar while taken
-- counts tracker rows, so a call that happened off-calendar exists in one and
-- not the other. The bridge lets both be attributed to the same person, so a
-- shown call is counted once whichever way it was recorded.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function door_lead_quality(
  p_client text,
  p_from date,
  p_to date,
  p_cohort text default 'keyword'
)
returns jsonb
language plpgsql stable as $$
declare
  v_rows jsonb;
  v_totals jsonb;
begin
  if p_cohort not in ('keyword','ad_set') then
    raise exception 'lead_quality_read: cohort must be keyword or ad_set. A geo split cannot be answered: warehouse.ads stores geo_count, which is how MANY places an ad set targeted, and no stored row records which country or region a PERSON was in. Answering a geo split would need a per-person geography this system does not capture.';
  end if;

  with cohort_people as (
    -- One row per human who sent this creator a keyword inside the window.
    -- Keyed on the ManyChat id, because that is the id the keyword arrives on.
    select
      e.subscriber_id,
      min(e.event_at) as first_keyword_at,
      (array_agg(e.keyword_normalized order by e.event_at))[1] as first_keyword,
      (array_agg(e.setter_name order by e.event_at))[1] as setter
    from ads_keyword_events e
    where e.client_key = p_client
      and e.event_type = 'dm_keyword'
      and nullif(e.subscriber_id,'') is not null
      and (e.event_at at time zone 'America/New_York')::date between p_from and p_to
    group by e.subscriber_id
  ),
  bridged as (
    select
      c.*,
      p.person_id,
      coalesce(p.ig_scoped_ids, '{}') as ig_ids,
      coalesce(p.ghl_contact_ids, '{}') as ghl_ids
    from cohort_people c
    left join registry_persons p
      on p.merged_into is null and p.manychat_ids @> array[c.subscriber_id]
  ),
  labelled as (
    select b.*,
      case p_cohort
        when 'keyword' then b.first_keyword
        when 'ad_set' then coalesce(
          (select a.adset_name from warehouse.ads a
            where a.client_key = p_client and a.keyword_normalized = b.first_keyword
            order by a.last_active_day desc nulls last limit 1),
          '(no ad set found for this keyword)')
      end as cohort_key
    from bridged b
  ),
  -- ── How deep the conversation went, for the people we can see ─────────
  depth as (
    select l.subscriber_id,
      count(*) as messages,
      count(*) filter (where m.direction = 'inbound') as inbound
    from labelled l
    join dm_conversation_messages m
      on m.subscriber_id = any(l.ig_ids || array[l.subscriber_id])
    group by l.subscriber_id
  ),
  -- ── Qualification, only where a structured stage state exists ─────────
  qual as (
    select l.subscriber_id,
      bool_or(x.qualified) as qualified,
      max(x.booking_readiness_score) as readiness
    from labelled l
    join person_context x on x.subscriber_ids @> array[l.subscriber_id]
    group by l.subscriber_id
  ),
  -- ── Bookings, reached through the bridge as well as the direct key ────
  booked as (
    select l.subscriber_id,
      count(*) as bookings,
      count(*) filter (where b.taken) as taken_on_calendar
    from labelled l
    join adsv2_booking_facts b
      on (b.contact_id is not null and b.contact_id = any(l.ghl_ids))
      or (b.linked_subscriber_id is not null and b.linked_subscriber_id = l.subscriber_id)
    group by l.subscriber_id
  ),
  -- ── Calls and cash as the tracker recorded them, calendar or not ──────
  tracker as (
    select l.subscriber_id,
      count(*) filter (where t.call_taken) as calls_taken,
      count(*) filter (where upper(coalesce(t.outcome,'')) = 'WIN') as wins,
      coalesce(sum(t.collected_revenue_cents) filter (where upper(coalesce(t.outcome,'')) = 'WIN'), 0) as collected_cents
    from labelled l
    join sales_tracker_rows t on t.manychat_subscriber_id = l.subscriber_id
    group by l.subscriber_id
  ),
  per_cohort as (
    select
      l.cohort_key,
      count(*) as people_who_sent_the_keyword,
      count(l.person_id) as people_on_the_bridge,
      count(*) filter (where array_length(l.ig_ids,1) >= 1) as people_bridged_to_a_thread,
      count(d.subscriber_id) as people_with_a_readable_thread,
      percentile_disc(0.5) within group (order by d.messages) as median_messages_per_thread,
      percentile_disc(0.5) within group (order by d.inbound) as median_inbound_per_thread,
      count(q.subscriber_id) as people_with_a_stage_state,
      count(*) filter (where q.qualified) as people_marked_qualified,
      coalesce(sum(b.bookings), 0) as bookings,
      count(b.subscriber_id) as people_who_booked,
      coalesce(sum(b.taken_on_calendar), 0) as calls_taken_on_calendar,
      coalesce(sum(t.calls_taken), 0) as calls_taken_in_the_tracker,
      coalesce(sum(t.wins), 0) as wins,
      coalesce(sum(t.collected_cents), 0) as collected_usd_cents
    from labelled l
    left join depth d on d.subscriber_id = l.subscriber_id
    left join qual q on q.subscriber_id = l.subscriber_id
    left join booked b on b.subscriber_id = l.subscriber_id
    left join tracker t on t.subscriber_id = l.subscriber_id
    group by l.cohort_key
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'cohort', cohort_key,
      'people_who_sent_the_keyword', people_who_sent_the_keyword,
      'people_on_the_bridge', people_on_the_bridge,
      'people_bridged_to_a_thread', people_bridged_to_a_thread,
      'dm_depth', jsonb_build_object(
        'measured_over_people', people_with_a_readable_thread,
        'out_of_people', people_who_sent_the_keyword,
        'median_messages_per_thread', median_messages_per_thread,
        'median_inbound_per_thread', median_inbound_per_thread,
        'note', case when people_with_a_readable_thread = 0
          then 'No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.'
          else format('Measured over the %s of %s people whose thread could be reached. It describes those people, not the whole cohort.',
                      people_with_a_readable_thread, people_who_sent_the_keyword) end),
      'qualification', jsonb_build_object(
        'people_with_a_stage_state', people_with_a_stage_state,
        'people_marked_qualified', people_marked_qualified,
        'note', 'Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.'),
      'progression', jsonb_build_object(
        'people_who_booked', people_who_booked,
        'bookings', bookings,
        'dm_to_book_rate', case when people_who_sent_the_keyword > 0
          then round((people_who_booked::numeric / people_who_sent_the_keyword) * 100, 1) else null end,
        'dm_to_book_over_n', people_who_sent_the_keyword,
        'calls_taken_on_calendar', calls_taken_on_calendar,
        'calls_taken_in_the_tracker', calls_taken_in_the_tracker,
        'show_rate_on_calendar', case when bookings > 0
          then round((calls_taken_on_calendar::numeric / bookings) * 100, 1) else null end,
        'show_rate_over_n', bookings,
        'off_calendar_note', case when calls_taken_in_the_tracker > calls_taken_on_calendar
          then format('%s calls were taken in the tracker against %s on the calendar. The difference is calls that happened without a pinned-calendar booking; both are the same people, reached through the bridge.',
                      calls_taken_in_the_tracker, calls_taken_on_calendar)
          else null end),
      'money', jsonb_build_object(
        'wins', wins,
        'collected_usd_cents', collected_usd_cents),
      'early_quality_flags', (
        select jsonb_agg(f) from (
          select 'Nobody in this cohort booked.' as f where people_who_booked = 0 and people_who_sent_the_keyword >= 5
          union all
          select 'Every thread that could be read was one message deep, which is the shape of a keyword sent and no conversation after it.'
            where people_with_a_readable_thread > 0 and median_messages_per_thread <= 1
          union all
          select 'This cohort cannot be read at all: not one person in it is bridged to a thread.'
            where people_bridged_to_a_thread = 0
        ) g)
    ) order by people_who_sent_the_keyword desc), '[]'::jsonb),
    jsonb_build_object(
      'people_who_sent_the_keyword', coalesce(sum(people_who_sent_the_keyword), 0),
      'people_on_the_bridge', coalesce(sum(people_on_the_bridge), 0),
      'people_bridged_to_a_thread', coalesce(sum(people_bridged_to_a_thread), 0),
      'people_who_booked', coalesce(sum(people_who_booked), 0),
      'bookings', coalesce(sum(bookings), 0),
      'calls_taken_on_calendar', coalesce(sum(calls_taken_on_calendar), 0),
      'calls_taken_in_the_tracker', coalesce(sum(calls_taken_in_the_tracker), 0),
      'wins', coalesce(sum(wins), 0),
      'collected_usd_cents', coalesce(sum(collected_usd_cents), 0))
  into v_rows, v_totals
  from per_cohort;

  return jsonb_build_object(
    'client', p_client,
    'date_from', p_from,
    'date_to', p_to,
    'cohort_by', p_cohort,
    'units', 'Money is in CENTS. Rates are percentages, each carrying the N it was computed over.',
    'method',
      'The cohort is every person who sent this creator a keyword inside the window, keyed on their ManyChat subscriber id and grouped by the FIRST keyword they sent. Threads, bookings, calls and cash are attached to those people through registry_persons, so a booking recorded against a GoHighLevel contact and a DM recorded against an Instagram-scoped id reach the same human.',
    'totals', v_totals,
    'cohorts', v_rows,
    'speaking_rule',
      'These are counts and observations. This question does not judge an ad or a keyword; kill_scale_read applies the signed ruleset, and a person decides.'
  );
end;
$$;

-- SECURITY DEFINER, like every other door RPC. This one reads warehouse.ads to
-- map a keyword to its ad set, and the service role the door runs as has no
-- rights on the warehouse schema.
alter function door_lead_quality(text, date, date, text) security definer set search_path = public, warehouse;
