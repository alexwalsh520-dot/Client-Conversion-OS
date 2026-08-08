-- ─────────────────────────────────────────────────────────────────────────
-- TRUTH LAYER BRICK 5 — question 18: person_timeline.
--
-- Everything one human did, in the order they did it, across all four id
-- systems, with the bridge saying which links are hard, which are only a name,
-- and what it could not bridge at all.
--
-- ── WHY THIS IS DIFFERENT FROM person_lookup (question 6) ────────────────
-- person_lookup reads warehouse.people and the facts already stitched into it.
-- Its own receipt has always carried the honest caveat that "the identity
-- bridge is a later brick" and that an empty event list is therefore not proof
-- the person did nothing. This is that brick. person_timeline resolves through
-- registry_persons first, so it reaches the DM threads that live in an id
-- space the facts never touched.
--
-- person_lookup is NOT retired and its numbers do not move. It answers what it
-- always answered.
--
-- ── WHAT THE TIMELINE REFUSES TO DO ──────────────────────────────────────
-- It never invents a link to fill a gap. When a person's booking has no DM
-- thread behind it, the answer says the thread could not be bridged and names
-- the reason. Under person_identity v1 a zero-row join across id systems is
-- never evidence of absence, and a timeline that quietly showed nothing there
-- would be making exactly that claim.
-- ─────────────────────────────────────────────────────────────────────────

/**
 * Everything the bridge knows about one person, plus every event, in order.
 * Takes a person_id; resolving an arbitrary identifier to one is the caller's
 * job, through registry_person_resolve, so an ambiguous name is refused where
 * a caller can see it happen rather than deep inside a timeline.
 */
create or replace function door_person_timeline(p_person_id uuid)
returns jsonb
language plpgsql stable as $$
declare
  v_p registry_persons%rowtype;
  v_events jsonb;
  v_mc text[];
  v_ig text[];
  v_ghl text[];
  v_names text[];
begin
  select * into v_p from registry_persons where person_id = p_person_id;
  if not found then return null; end if;

  v_mc := coalesce(v_p.manychat_ids, '{}');
  v_ig := coalesce(v_p.ig_scoped_ids, '{}');
  v_ghl := coalesce(v_p.ghl_contact_ids, '{}');
  v_names := coalesce(v_p.tracker_name_keys, '{}');

  with events as (
    -- ── The real DM thread, from the messages themselves ────────────────
    -- Both id spaces on purpose: an Instagram-scoped thread reached through
    -- the bridge, and a ManyChat-space thread that never needed bridging.
    select
      min(m.sent_at) as at,
      'dm_thread_started' as kind,
      jsonb_build_object(
        'id_space', registry_person_dm_system(m.subscriber_id),
        'subscriber_id', m.subscriber_id,
        'messages', count(*),
        'inbound', count(*) filter (where m.direction = 'inbound'),
        'outbound', count(*) filter (where m.direction = 'outbound'),
        'first_message_at', min(m.sent_at),
        'last_message_at', max(m.sent_at),
        'creator', m.client
      ) as detail,
      'dm_conversation_messages' as source
    from dm_conversation_messages m
    where m.subscriber_id = any(v_ig || v_mc)
    group by m.subscriber_id, m.client

    union all

    -- ── Keyword events: the ad's own fingerprint ────────────────────────
    select e.event_at, 'keyword_event',
      jsonb_build_object(
        'keyword', e.keyword_normalized,
        'event_type', e.event_type,
        'setter', e.setter_name,
        'creator', e.client_key,
        'subscriber_id', e.subscriber_id,
        'contact_id', e.contact_id),
      'ads_keyword_events'
    from ads_keyword_events e
    where (e.subscriber_id is not null and e.subscriber_id = any(v_mc))
       or (e.contact_id is not null and e.contact_id = any(v_ghl))

    union all

    -- ── Bookings, with the gaps LABELLED rather than hidden ─────────────
    select coalesce(b.created_time, b.start_time), 'booking',
      jsonb_build_object(
        'appointment_key', b.appointment_key,
        'contact_id', b.contact_id,
        'creator', b.client_key,
        'keyword', b.keyword_normalized,
        'calendar', b.calendar_name,
        'booked_et_day', b.booked_et_day,
        'start_time', b.start_time,
        'taken', b.taken,
        'status', b.status,
        'dm_et_day', b.dm_et_day,
        'dm_day_gap', case when b.dm_et_day is null
          then 'This booking has no first-DM day on it. Either the DM was never captured as a keyword event, or it lives in an id space this person is not bridged to.'
          else null end,
        'blank_reason', b.blank_reason,
        'evidence_key', b.evidence_key),
      'adsv2_booking_facts'
    from adsv2_booking_facts b
    where (b.contact_id is not null and b.contact_id = any(v_ghl))
       or (b.linked_subscriber_id is not null and b.linked_subscriber_id = any(v_mc))

    union all

    -- ── The tracker row: the call as a human wrote it down ──────────────
    select (t.date::timestamptz), 'tracker_row',
      jsonb_build_object(
        'call_number', t.call_number,
        'prospect_name', t.prospect_name,
        'call_taken', t.call_taken,
        'outcome', t.outcome,
        'closer', t.closer,
        'setter', t.setter,
        'objection', t.objection,
        'contracted_cents', t.contracted_revenue_cents,
        'collected_cents', t.collected_revenue_cents,
        'manychat_subscriber_id', t.manychat_subscriber_id),
      'sales_tracker_rows'
    from sales_tracker_rows t
    where t.manychat_subscriber_id is not null and t.manychat_subscriber_id = any(v_mc)

    union all

    -- ── Cash, as the money system stamped it ────────────────────────────
    select (s.sale_et_day::timestamptz), 'sale',
      jsonb_build_object(
        'sale_key', s.sale_key,
        'creator', s.client_key,
        'keyword', s.keyword_normalized,
        'is_win', s.is_win,
        'call_taken', s.call_taken,
        'call_type', s.call_type,
        'closer', s.closer,
        'collected_usd_cents', s.collected_usd_cents,
        'contracted_usd_cents', s.contracted_usd_cents,
        'evidence_key', s.evidence_key,
        'blank_reason', s.blank_reason,
        'awaiting_review', s.awaiting_review),
      'adsv2_sale_facts'
    from adsv2_sale_facts s
    where s.subscriber_id is not null and s.subscriber_id = any(v_mc)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', at, 'kind', kind, 'source', source, 'detail', detail
         ) order by at nulls last), '[]'::jsonb)
  into v_events
  from events;

  return jsonb_build_object(
    'person_id', v_p.person_id,
    'display_name', v_p.display_name,
    'creators', v_p.client_keys,
    'ids', jsonb_build_object(
      'manychat', v_mc,
      'ig_scoped', v_ig,
      'ghl', v_ghl,
      'tracker_names', v_names),
    'evidence', v_p.evidence,
    'link_summary', jsonb_build_object(
      'hard_links', (select count(*) from jsonb_array_elements(v_p.evidence) e where e->>'confidence' = 'hard'),
      'name_match_links', (select count(*) from jsonb_array_elements(v_p.evidence) e where e->>'confidence' = 'name_match'),
      'bridged_to_instagram', array_length(v_ig, 1) is not null,
      'bridged_to_ghl', array_length(v_ghl, 1) is not null),
    'could_not_bridge', (
      select jsonb_agg(x) from (
        select 'No Instagram-scoped id. The only stored row that carries a ManyChat id and an Instagram id together is a manychat_origin_checks row, and this person has none, so their DM thread cannot be reached. This is not evidence that they never sent a DM.' as x
        where array_length(v_ig, 1) is null
        union all
        select 'No GoHighLevel contact id, so no booking or appointment can be attached to this person by hard evidence.'
        where array_length(v_ghl, 1) is null
        union all
        select 'No ManyChat subscriber id, so no keyword event, tracker row or sale can be attached to this person by hard evidence.'
        where array_length(v_mc, 1) is null
      ) q),
    'duplicate_contact_note', case when coalesce(array_length(v_ghl,1),0) > 1
      then format('This person holds %s GoHighLevel contact ids. Duplicate contacts are the known cause of booking chains breaking; the bridge holds all of them, so their bookings are counted once here rather than split.', array_length(v_ghl,1))
      else null end,
    'events', v_events,
    'event_count', jsonb_array_length(v_events)
  );
end;
$$;

/**
 * Who an identifier could be, when it did not resolve to exactly one person.
 * A name that two live people answer to returns both of them, labelled, and no
 * timeline. The caller picks; this door never picks for them.
 */
create or replace function door_person_candidates(p_identifier text, p_limit integer default 25)
returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'person_id', person_id,
    'display_name', display_name,
    'creators', client_keys,
    'manychat_ids', manychat_ids,
    'ig_scoped_ids', ig_scoped_ids,
    'ghl_contact_ids', ghl_contact_ids,
    'tracker_names', tracker_name_keys
  )), '[]'::jsonb)
  from (
    select * from registry_persons
    where merged_into is null
      and tracker_name_keys @> array[registry_person_name_key(p_identifier)]
    order by created_at
    limit p_limit
  ) s
$$;

-- Every other door RPC is SECURITY DEFINER, for the same reason these two are:
-- the service role the door runs as has no rights on the warehouse schema, and
-- a question that cannot read its own source is a question that refuses in
-- production and passes in a test.
alter function door_person_timeline(uuid) security definer set search_path = public;
alter function door_person_candidates(text, integer) security definer set search_path = public;
