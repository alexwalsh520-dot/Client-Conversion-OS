-- ─────────────────────────────────────────────────────────────────────────
-- TRUTH LAYER BRICK 5 — part 3: the fold-in fixes.
--
-- Two things the bridge can now repair, both of them small, both of them
-- bridge-adjacent, and neither of them allowed to move a money number.
--
--   1. adsv2_booking_facts rows whose direct key match failed. Migration 073's
--      ladder resolves a booking's ManyChat subscriber four ways and gives up
--      when all four miss. With registry_persons live there is a fifth way:
--      resolve the PERSON from the GoHighLevel contact and read their ManyChat
--      id off the bridge. This is what repairs the duplicate-contact breaks,
--      because a person holds every contact id they were ever given.
--
--   2. The dm_et_day-null class found on 8/8: bookings whose DM exists but was
--      never event-captured, so the booking has no first-DM day on it. Where
--      the bridge can supply a real first-DM day, it is filled in and LABELLED
--      with the evidence tier it came from.
--
-- ── WHAT THIS DOES NOT TOUCH ─────────────────────────────────────────────
-- No cash column, no keyword, no attribution bucket, no awaiting_review flag.
-- It writes linked_subscriber_id and dm_et_day and nothing else, and it only
-- ever writes them where they are currently NULL. A row that already has an
-- answer keeps the answer it has.
--
-- `taken` is deliberately left alone. It is computed by 073's own tracker join
-- and it feeds counts a person reads as money; recomputing it from a different
-- path here would be a silent change to a number nobody asked to change.
-- ─────────────────────────────────────────────────────────────────────────

/**
 * The ManyChat id the bridge holds for a booking's contact, or null.
 *
 * Ambiguity is refused: a person holding two ManyChat ids gives no answer,
 * because picking one would be a guess wearing a hard link's clothes.
 */
create or replace function adsv2_booking_bridge_subscriber(p_contact_id text)
returns text
language sql stable as $$
  select case when array_length(p.manychat_ids, 1) = 1 then p.manychat_ids[1] else null end
  from registry_persons p
  where p.merged_into is null and p.ghl_contact_ids @> array[p_contact_id]
  limit 1
$$;

/**
 * Repair what the bridge can repair, and report every count that moved.
 *
 * Returns before-and-after for each column it touches, so the change is
 * auditable from the return value alone rather than from a later query nobody
 * runs.
 */
create or replace function adsv2_booking_bridge_recovery()
returns jsonb
language plpgsql as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_linked integer := 0;
  v_dm_days integer := 0;
begin
  select jsonb_build_object(
    'rows', count(*),
    'with_linked_subscriber', count(*) filter (where linked_subscriber_id is not null),
    'with_dm_et_day', count(*) filter (where dm_et_day is not null),
    'taken_true', count(*) filter (where taken)
  ) into v_before from adsv2_booking_facts;

  -- ── 1. The fifth rung: resolve the person, read their ManyChat id ──────
  with candidates as (
    select b.id, adsv2_booking_bridge_subscriber(b.contact_id) as sub
    from adsv2_booking_facts b
    where b.linked_subscriber_id is null and b.contact_id is not null
  )
  update adsv2_booking_facts b
  set linked_subscriber_id = c.sub,
      evidence_detail = coalesce(b.evidence_detail, '{}'::jsonb) || jsonb_build_object(
        'bridge_recovery', jsonb_build_object(
          'linked_subscriber_id', c.sub,
          'via', 'registry_persons: the GoHighLevel contact resolved to a person holding exactly one ManyChat id',
          'confidence', 'hard',
          'at', now()))
  from candidates c
  where b.id = c.id and c.sub is not null;
  get diagnostics v_linked = row_count;

  -- ── 2. The first-DM day, where the bridge can now supply a real one ────
  -- The same rule 073 uses: the earliest keyword event this person sent for
  -- THIS booking's keyword, in Eastern time, not window-limited. What is new
  -- is only that the person can now be found.
  with candidates as (
    select b.id,
      (select min((e.event_at at time zone 'America/New_York')::date)
       from ads_keyword_events e
       where e.subscriber_id = b.linked_subscriber_id
         and (b.keyword_normalized is null or e.keyword_normalized = b.keyword_normalized)
      ) as dm_day
    from adsv2_booking_facts b
    where b.dm_et_day is null and b.linked_subscriber_id is not null
  )
  update adsv2_booking_facts b
  set dm_et_day = c.dm_day,
      evidence_detail = coalesce(b.evidence_detail, '{}'::jsonb) || jsonb_build_object(
        'dm_day_recovery', jsonb_build_object(
          'dm_et_day', c.dm_day,
          'via', 'the earliest keyword event of the ManyChat id the bridge resolved for this booking',
          'confidence', 'hard',
          'at', now()))
  from candidates c
  where b.id = c.id and c.dm_day is not null;
  get diagnostics v_dm_days = row_count;

  select jsonb_build_object(
    'rows', count(*),
    'with_linked_subscriber', count(*) filter (where linked_subscriber_id is not null),
    'with_dm_et_day', count(*) filter (where dm_et_day is not null),
    'taken_true', count(*) filter (where taken)
  ) into v_after from adsv2_booking_facts;

  return jsonb_build_object(
    'ran_at', now(),
    'before', v_before,
    'after', v_after,
    'subscribers_recovered', v_linked,
    'dm_days_recovered', v_dm_days,
    'money_note',
      'No cash column, keyword, attribution bucket or review flag was touched, and taken was left exactly as migration 073 computed it. Only linked_subscriber_id and dm_et_day were written, and only where they were null.'
  );
end;
$$;
