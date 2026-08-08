-- ─────────────────────────────────────────────────────────────────────────
-- TRUTH LAYER BRICK 5 — THE IDENTITY BRIDGE, part 2: the backfill.
--
-- Sweeps every HARD evidence path in the database and writes the links it
-- finds into registry_persons. Idempotent: running it twice links nothing
-- twice, because registry_person_link is a no-op for an id the person already
-- holds. Safe to run on every sync cycle, which is how the queue gets drained.
--
-- ── WHAT COUNTS AS HARD, AND WHY ─────────────────────────────────────────
-- A stored row carried BOTH ids. That is the whole test. Nine sweeps qualify:
--
--   1  manychat_origin_checks.raw.ig_id      manychat  <-> ig_scoped
--   2  ads_keyword_events (both ids present) manychat  <-> ghl
--   3  ghl_appointments.raw_payload.manychat_user_id  manychat <-> ghl
--   4  adsv2_booking_facts.linked_subscriber_id       manychat <-> ghl
--   5  dm_conversation_messages (ManyChat-space rows) manychat <-> ghl
--   6  manychat_contact_links, corroborated only      manychat <-> ghl
--   7  sales_tracker_rows        manychat <-> tracker_name (one row)
--   8  adsv2_sale_facts          manychat <-> tracker_name (one row)
--   9  adsv2_booking_facts       ghl      <-> tracker_name (one row)
--
-- Sweeps 7 to 9 attach a NAME to an id because the name and the id sat on the
-- same row. That is same-row co-occurrence, not name similarity: nothing is
-- being matched against anything. Cross-row name similarity never appears in
-- this file at all.
--
-- ── THE ONE SOURCE THIS FILE DELIBERATELY REFUSES ────────────────────────
-- manychat_contact_links holds 10,448 ManyChat-to-GHL rows and looks like the
-- richest bridge in the database. It is written by TWO paths and does not
-- record which one wrote each row: a hard path (the ManyChat custom field on a
-- machine-created contact) and a SCORING path in
-- src/lib/dm-contact-linking.ts, which ranks GHL contacts by first-name and
-- last-name equality plus how close their creation times were, and accepts
-- anything over 70 points. The second path is name similarity wearing a
-- machine's clothes.
--
-- Measured 2026-08-08 against the 290 ManyChat-to-GHL pairs this file can
-- prove independently: 265 of them agree with manychat_contact_links and 25
-- disagree, mapping the same subscriber to a different contact. Those 25 may
-- be bad scored links or may be the known duplicate-GHL-contact pattern; the
-- table alone cannot tell you which. So sweep 6 imports ONLY the rows an
-- independent hard source already corroborates, and the remainder is counted
-- and reported rather than imported and trusted.
--
-- Migration 073's stamp ladder does lean on this table. Brick 5 is knowingly
-- stricter than 073, and the report says so with these numbers next to it.
-- ─────────────────────────────────────────────────────────────────────────

/** The canonical creator key, through the signed registry, never by hand. */
create or replace function registry_person_client(p_client text)
returns text language sql stable as $$
  select coalesce(registry_resolve_entity(p_client), nullif(btrim(p_client), ''))
$$;

/**
 * Link two ids that a single stored row carried together.
 *
 * When the two ids already sit on two DIFFERENT people, hard evidence has just
 * proved those two people are one human. That is a merge, and it is performed
 * EXPLICITLY here, through registry_person_merge, with the evidence named in
 * the reason and 'backfill' as the actor. It lands in registry_person_merges
 * like every other merge. Nothing about it is silent; what it is not is
 * manual, because evidence this hard should not wait on a human to retype it.
 *
 * name_match evidence never reaches this path: registry_person_link refuses to
 * let a name_match cross id systems, so a name can never trigger a merge.
 */
create or replace function registry_person_link_pair(
  p_system_a text, p_id_a text,
  p_system_b text, p_id_b text,
  p_source text,
  p_confidence text default 'hard',
  p_display_name text default null,
  p_client_key text default null
)
returns uuid
language plpgsql as $$
declare
  v_a uuid;
  v_b uuid;
  v_client text;
begin
  v_client := registry_person_client(p_client_key);
  v_a := registry_person_ensure(p_system_a, p_id_a, p_source, p_confidence, p_display_name, v_client);
  if v_a is null then
    -- The first id was empty; the second still deserves a person of its own.
    return registry_person_ensure(p_system_b, p_id_b, p_source, p_confidence, p_display_name, v_client);
  end if;

  v_b := registry_person_holding(p_system_b, p_id_b);

  if v_b is not null and v_b <> v_a then
    if p_confidence = 'hard' then
      return registry_person_merge(
        v_a, v_b,
        format('Hard evidence linked %s %s to %s %s on one stored row (%s), and the two ids were on two person rows.',
               p_system_a, p_id_a, p_system_b, p_id_b, p_source),
        'backfill');
    end if;
    -- Softer evidence never merges. registry_person_link records the conflict.
    return registry_person_link(v_a, p_system_b, p_id_b, p_source, p_confidence, p_display_name, v_client);
  end if;

  return registry_person_link(v_a, p_system_b, p_id_b, p_source, p_confidence, p_display_name, v_client);
end;
$$;

/**
 * Which id space a DM subscriber id belongs to.
 *
 * dm_conversation_messages is TWO capture paths sharing one column, which is
 * not obvious and is easy to get wrong. Measured 2026-08-08: 132,521 rows
 * carry 15-to-17 digit Instagram-scoped ids and no GHL contact, while 620 rows
 * carry 6-to-10 digit ManyChat ids and DO carry a GHL contact. Treating the
 * short ones as Instagram ids would file 49 people under an id space they were
 * never in.
 */
create or replace function registry_person_dm_system(p_id text)
returns text language sql immutable as $$
  select case
    when p_id is null then null
    when length(btrim(p_id)) >= 15 then 'ig_scoped'
    when length(btrim(p_id)) between 4 and 10 then 'manychat'
    else null
  end
$$;

-- ── The backfill ─────────────────────────────────────────────────────────

create or replace function registry_persons_backfill()
returns jsonb
language plpgsql as $$
declare
  r record;
  v_person uuid;
  v_before_persons integer;
  v_before_merges integer;
  v_counts jsonb := '{}'::jsonb;
  v_drained integer := 0;
begin
  select count(*) into v_before_persons from registry_persons;
  select count(*) into v_before_merges from registry_person_merges;

  -- ── Sweep 1. The ManyChat-to-Instagram bridge ─────────────────────────
  -- The only place in the database where one row carries a ManyChat id and an
  -- Instagram-scoped id at the same time. This is what makes a booking's
  -- person findable in the real DM threads.
  for r in
    select subscriber_id, nullif(raw->>'ig_id','') ig_id, prospect_name, client_key
    from manychat_origin_checks
    where nullif(raw->>'ig_id','') is not null and nullif(subscriber_id,'') is not null
  loop
    v_person := registry_person_link_pair(
      'manychat', r.subscriber_id, 'ig_scoped', r.ig_id,
      'manychat_origin_checks.raw.ig_id', 'hard', r.prospect_name, r.client_key);
    if r.prospect_name is not null then
      perform registry_person_link(v_person, 'tracker_name', r.prospect_name,
        'manychat_origin_checks.prospect_name (same row as the subscriber id)', 'hard',
        r.prospect_name, registry_person_client(r.client_key));
    end if;
  end loop;

  -- ── Sweep 2. The UTM booking-link chain ───────────────────────────────
  -- A keyword event that carries the subscriber AND the GoHighLevel contact
  -- the booking landed on.
  for r in
    select distinct subscriber_id, contact_id, contact_name, client_key
    from ads_keyword_events
    where nullif(subscriber_id,'') is not null and nullif(contact_id,'') is not null
  loop
    v_person := registry_person_link_pair(
      'manychat', r.subscriber_id, 'ghl', r.contact_id,
      'ads_keyword_events (one row carrying both the subscriber and the contact)', 'hard',
      r.contact_name, r.client_key);
  end loop;

  -- ── Sweep 3. The appointment's own ManyChat field ─────────────────────
  for r in
    select distinct nullif(raw_payload->>'manychat_user_id','') mc, contact_id
    from ghl_appointments
    where nullif(raw_payload->>'manychat_user_id','') is not null and nullif(contact_id,'') is not null
  loop
    v_person := registry_person_link_pair(
      'manychat', r.mc, 'ghl', r.contact_id,
      'ghl_appointments.raw_payload.manychat_user_id', 'hard');
  end loop;

  -- ── Sweep 4. What migration 073 already resolved ──────────────────────
  -- 073's ladder is hard-key only and says so in its own comment. The one
  -- rung of it that leans on manychat_contact_links is re-proved here by
  -- sweep 6 rather than taken on trust.
  for r in
    select distinct linked_subscriber_id, contact_id, person_name, client_key
    from adsv2_booking_facts
    where nullif(linked_subscriber_id,'') is not null and nullif(contact_id,'') is not null
  loop
    v_person := registry_person_link_pair(
      'manychat', r.linked_subscriber_id, 'ghl', r.contact_id,
      'adsv2_booking_facts.linked_subscriber_id (migration 073 hard-key ladder)', 'hard',
      r.person_name, r.client_key);
  end loop;

  -- ── Sweep 5. The ManyChat-space DM rows ───────────────────────────────
  for r in
    select distinct subscriber_id, contact_id, client
    from dm_conversation_messages
    where nullif(contact_id,'') is not null
      and registry_person_dm_system(subscriber_id) = 'manychat'
  loop
    v_person := registry_person_link_pair(
      'manychat', r.subscriber_id, 'ghl', r.contact_id,
      'dm_conversation_messages (a ManyChat-space thread carrying its GHL contact)', 'hard',
      null, r.client);
  end loop;

  -- ── Sweep 6. manychat_contact_links, corroborated rows only ───────────
  -- See the header. Only rows an independent hard source already proved.
  for r in
    with hard_pairs as (
      select distinct subscriber_id mc, contact_id ghl from ads_keyword_events
        where nullif(subscriber_id,'') is not null and nullif(contact_id,'') is not null
      union
      select distinct nullif(raw_payload->>'manychat_user_id',''), contact_id from ghl_appointments
        where nullif(raw_payload->>'manychat_user_id','') is not null and nullif(contact_id,'') is not null
      union
      select distinct linked_subscriber_id, contact_id from adsv2_booking_facts
        where nullif(linked_subscriber_id,'') is not null and nullif(contact_id,'') is not null
      union
      select distinct subscriber_id, contact_id from dm_conversation_messages
        where nullif(contact_id,'') is not null and registry_person_dm_system(subscriber_id) = 'manychat'
    )
    select m.subscriber_id, m.ghl_contact_id, m.client
    from manychat_contact_links m
    join hard_pairs h on h.mc = m.subscriber_id and h.ghl = m.ghl_contact_id
  loop
    v_person := registry_person_link_pair(
      'manychat', r.subscriber_id, 'ghl', r.ghl_contact_id,
      'manychat_contact_links, corroborated by an independent hard pair', 'hard',
      null, r.client);
  end loop;

  -- ── Sweeps 7 to 9. Names, from the row their id sat on ────────────────
  for r in
    select distinct manychat_subscriber_id mc, prospect_name from sales_tracker_rows
    where nullif(manychat_subscriber_id,'') is not null and nullif(prospect_name,'') is not null
  loop
    v_person := registry_person_link_pair(
      'manychat', r.mc, 'tracker_name', r.prospect_name,
      'sales_tracker_rows (the pasted ManyChat link and the name on one row)', 'hard',
      r.prospect_name);
  end loop;

  for r in
    select distinct subscriber_id, prospect_name, client_key from adsv2_sale_facts
    where nullif(subscriber_id,'') is not null and nullif(prospect_name,'') is not null
  loop
    v_person := registry_person_link_pair(
      'manychat', r.subscriber_id, 'tracker_name', r.prospect_name,
      'adsv2_sale_facts (the subscriber and the name on one row)', 'hard',
      r.prospect_name, r.client_key);
  end loop;

  for r in
    select distinct contact_id, person_name, client_key from adsv2_booking_facts
    where nullif(contact_id,'') is not null and nullif(person_name,'') is not null
  loop
    v_person := registry_person_link_pair(
      'ghl', r.contact_id, 'tracker_name', r.person_name,
      'adsv2_booking_facts (the contact and the name on one row)', 'hard',
      r.person_name, r.client_key);
  end loop;

  -- ── Sweep 10. Every id the money system already knows ─────────────────
  -- A person we can SEE but have not bridged is still a person. Giving them a
  -- row is what lets person_timeline answer "here is everything, and here is
  -- what could not be bridged" instead of returning nothing at all.
  --
  -- Instagram-scoped ids are deliberately NOT swept in bulk: 36,604 of them
  -- exist and all but the bridged ones are threads with no funnel row behind
  -- them. They are counted as the remainder instead of materialised.
  for r in
    select distinct subscriber_id, subscriber_name, client_key from ads_keyword_events
    where nullif(subscriber_id,'') is not null
  loop
    v_person := registry_person_ensure('manychat', r.subscriber_id,
      'ads_keyword_events.subscriber_id', 'hard', r.subscriber_name, registry_person_client(r.client_key));
    if r.subscriber_name is not null and v_person is not null then
      perform registry_person_link(v_person, 'tracker_name', r.subscriber_name,
        'ads_keyword_events (the subscriber and their name on one row)', 'hard',
        r.subscriber_name, registry_person_client(r.client_key));
    end if;
  end loop;

  for r in
    select distinct subscriber_id, subscriber_name, client_key from adsv2_dm_facts
    where nullif(subscriber_id,'') is not null
  loop
    perform registry_person_ensure('manychat', r.subscriber_id,
      'adsv2_dm_facts.subscriber_id', 'hard', r.subscriber_name, registry_person_client(r.client_key));
  end loop;

  for r in
    select distinct contact_id, client_key from ads_keyword_events
    where nullif(contact_id,'') is not null
  loop
    perform registry_person_ensure('ghl', r.contact_id,
      'ads_keyword_events.contact_id', 'hard', null, registry_person_client(r.client_key));
  end loop;

  -- ── Drain anything the live capture paths enqueued ────────────────────
  select registry_person_drain_queue() into v_drained;

  v_counts := jsonb_build_object(
    'ran_at', now(),
    'persons_before', v_before_persons,
    'persons_after', (select count(*) from registry_persons),
    'persons_created', (select count(*) from registry_persons) - v_before_persons,
    'live_persons', (select count(*) from registry_persons where merged_into is null),
    'merges_performed', (select count(*) from registry_person_merges) - v_before_merges,
    'queue_rows_drained', v_drained,
    'ids_linked', (
      select jsonb_object_agg(system, n) from (
        select e->>'system' system, count(*) n
        from registry_persons p, lateral jsonb_array_elements(p.evidence) e
        group by 1
      ) s),
    'confidence', (
      select jsonb_object_agg(confidence, n) from (
        select e->>'confidence' confidence, count(*) n
        from registry_persons p, lateral jsonb_array_elements(p.evidence) e
        group by 1
      ) s),
    'conflicts_recorded', (select count(*) from registry_person_link_conflicts)
  );

  return v_counts;
end;
$$;

/**
 * DRAIN. Turns queued evidence from the live capture paths into links.
 *
 * A queue row that fails is marked with its error and left drained, so one bad
 * row can never wedge the queue behind it. Returns how many rows it consumed.
 */
create or replace function registry_person_drain_queue()
returns integer
language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from registry_person_link_queue where drained_at is null order by enqueued_at loop
    begin
      if r.system_b is not null and r.id_b is not null then
        perform registry_person_link_pair(r.system_a, r.id_a, r.system_b, r.id_b,
          r.source, r.confidence, r.display_name, r.client_key);
      else
        perform registry_person_ensure(r.system_a, r.id_a, r.source, r.confidence,
          r.display_name, registry_person_client(r.client_key));
      end if;
      update registry_person_link_queue set drained_at = now(), error = null where id = r.id;
    exception when others then
      update registry_person_link_queue set drained_at = now(), error = sqlerrm where id = r.id;
    end;
    n := n + 1;
  end loop;
  return n;
end;
$$;

/**
 * THE UNBRIDGEABLE REMAINDER, counted honestly, per system.
 *
 * This is the number that keeps the bridge honest. Every id the database holds
 * that no person row has claimed, by system, with the reason it could not be
 * claimed. person_identity v1 says a zero-row join is never evidence of
 * absence; this is that rule turned into a measurement.
 */
create or replace function registry_persons_remainder()
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'measured_at', now(),
    'manychat', jsonb_build_object(
      'ids_in_the_data', (select count(*) from (
        select subscriber_id i from ads_keyword_events where nullif(subscriber_id,'') is not null
        union select subscriber_id from adsv2_dm_facts where nullif(subscriber_id,'') is not null
        union select subscriber_id from adsv2_sale_facts where nullif(subscriber_id,'') is not null
        union select manychat_subscriber_id from sales_tracker_rows where nullif(manychat_subscriber_id,'') is not null
      ) x),
      'on_a_person', (select count(distinct i) from (
        select unnest(manychat_ids) i from registry_persons) y),
      'bridged_to_ig', (select count(*) from registry_persons
        where merged_into is null and array_length(manychat_ids,1) >= 1 and array_length(ig_scoped_ids,1) >= 1),
      'bridged_to_ghl', (select count(*) from registry_persons
        where merged_into is null and array_length(manychat_ids,1) >= 1 and array_length(ghl_contact_ids,1) >= 1)
    ),
    'ig_scoped', jsonb_build_object(
      'ids_in_the_data', (select count(distinct subscriber_id) from dm_conversation_messages
        where registry_person_dm_system(subscriber_id) = 'ig_scoped'),
      'on_a_person', (select count(distinct i) from (select unnest(ig_scoped_ids) i from registry_persons) y),
      'why_the_rest_cannot_bridge',
        'An Instagram-scoped thread bridges only where manychat_origin_checks holds a raw ig_id for it. That check is run per SALE, so threads that never produced a sale have no bridge row and no other stored row carries both ids.'
    ),
    'ghl', jsonb_build_object(
      'ids_in_the_data', (select count(*) from (
        select contact_id i from adsv2_booking_facts where nullif(contact_id,'') is not null
        union select contact_id from ads_keyword_events where nullif(contact_id,'') is not null
        union select contact_id from ghl_appointments where nullif(contact_id,'') is not null
      ) x),
      'on_a_person', (select count(distinct i) from (select unnest(ghl_contact_ids) i from registry_persons) y)
    ),
    'manychat_contact_links', jsonb_build_object(
      'rows', (select count(*) from manychat_contact_links),
      'imported', 'only the rows an independent hard source corroborates',
      'why', 'The table is written by two paths and records neither: a hard ManyChat custom field path and a name-and-time scoring path in src/lib/dm-contact-linking.ts that accepts any candidate over 70 points.'
    )
  )
$$;
