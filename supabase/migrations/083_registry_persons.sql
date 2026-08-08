-- ─────────────────────────────────────────────────────────────────────────
-- TRUTH LAYER BRICK 5 — THE IDENTITY BRIDGE, part 1: the store.
--
-- One person, one spine. Four id systems name the same human today with no
-- shared key:
--
--   manychat    ManyChat subscriber ids, 6 to 10 digits. Live in
--               ads_keyword_events, adsv2_* facts and the sales tracker.
--   ig_scoped   Instagram-scoped ids, 15 to 17 digits. Live in
--               dm_conversation_messages, which is where the real threads are.
--   ghl         GoHighLevel contact ids, 20 characters. Live on bookings and
--               appointments.
--   tracker_name a normalized name spelling. NOT an id and never treated as
--               one; it is here so a name can be looked UP, never so a name
--               can prove two rows are the same human.
--
-- MEASURED on 2026-08-08 against the live database: 7,623 distinct ManyChat
-- ids, 36,598 distinct IG-scoped ids, and ONE value in common. They are
-- disjoint spaces. That is the whole reason this table exists.
--
-- ── THE LAW THIS TABLE ENFORCES ──────────────────────────────────────────
-- A link between two ids exists only where a stored row carried BOTH of them.
-- Every link records the row that proved it. Name similarity may attach a name
-- SPELLING to a person; it may never, on its own, join two id systems, and it
-- may never merge two people.
--
-- The signed person_identity v1 definition governs everything here, including
-- its hardest clause: a zero-row join across id systems is never evidence of
-- absence. A person with no IG id is a person we have not bridged yet, not a
-- person who never sent a DM.
--
-- ── WHY MERGING IS NOT AUTOMATIC ─────────────────────────────────────────
-- Two person rows becoming one is a real, recorded operation with a survivor,
-- an absorbed row, a reason and an actor. It is never a side effect. The
-- absorbed row is KEPT and points at its survivor, because this system
-- archives and never deletes, and because an id that once resolved must keep
-- resolving.
--
-- Idempotent and additive. Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────

-- ── The bridge store ─────────────────────────────────────────────────────

create table if not exists registry_persons (
  person_id uuid primary key default gen_random_uuid(),

  -- The best-known spelling of this human's name. Convenience for reading.
  -- NEVER authoritative: nothing in this system keys off it.
  display_name text,

  -- Every creator this person has been seen under. A person who DMs two
  -- creators is ONE person; measured 2026-08-08, that is 1 ManyChat id and 8
  -- IG-scoped ids across the roster, so this is a set and not a single value.
  client_keys text[] not null default '{}',

  -- The four id systems. Each id appears on at most one LIVE person row.
  manychat_ids     text[] not null default '{}',
  ig_scoped_ids    text[] not null default '{}',
  ghl_contact_ids  text[] not null default '{}',
  tracker_name_keys text[] not null default '{}',

  -- One entry per linked id:
  --   {id, system, source, linked_at, confidence: "hard" | "name_match"}
  -- `source` names the stored row that carried the id. An entry without a
  -- source is not accepted; see registry_person_link below.
  evidence jsonb not null default '[]'::jsonb,

  -- Set when this row was absorbed by a merge. A merged row is kept forever
  -- so that ids which once resolved keep resolving, to the survivor.
  merged_into uuid references registry_persons(person_id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table registry_persons is
  'Truth Layer Brick 5. One row per human, holding their ids across the four disjoint id systems, with per-id evidence. Rows with merged_into set were absorbed by an explicit, recorded merge and are kept so old ids keep resolving.';

create index if not exists idx_registry_persons_manychat on registry_persons using gin (manychat_ids);
create index if not exists idx_registry_persons_ig on registry_persons using gin (ig_scoped_ids);
create index if not exists idx_registry_persons_ghl on registry_persons using gin (ghl_contact_ids);
create index if not exists idx_registry_persons_names on registry_persons using gin (tracker_name_keys);
create index if not exists idx_registry_persons_live on registry_persons (person_id) where merged_into is null;

-- ── The merge log ────────────────────────────────────────────────────────

create table if not exists registry_person_merges (
  id uuid primary key default gen_random_uuid(),
  survivor_person_id uuid not null references registry_persons(person_id),
  absorbed_person_id uuid not null references registry_persons(person_id),
  -- Why these two are the same human, in words, naming the evidence.
  reason text not null,
  -- Who did it: a person's name, or the name of the process.
  actor text not null,
  merged_at timestamptz not null default now(),
  -- What the absorbed row held at the moment it was absorbed, so the merge is
  -- reversible by hand and auditable forever.
  absorbed_snapshot jsonb
);

comment on table registry_person_merges is
  'Truth Layer Brick 5. Every merge of two person rows: survivor, absorbed, why, who, when, and what the absorbed row held. Merging is never silent and never automatic.';

create index if not exists idx_registry_person_merges_survivor on registry_person_merges (survivor_person_id);
create index if not exists idx_registry_person_merges_absorbed on registry_person_merges (absorbed_person_id);

-- ── Link collisions: what refused to link, kept rather than dropped ──────
--
-- When evidence would attach an id that already belongs to a DIFFERENT live
-- person, the link does not silently win and does not silently vanish. Hard
-- evidence escalates to an explicit merge; anything softer is written here for
-- a human to look at. A bridge that hides its disagreements is not a bridge.

create table if not exists registry_person_link_conflicts (
  id uuid primary key default gen_random_uuid(),
  system text not null,
  id_value text not null,
  held_by_person_id uuid references registry_persons(person_id),
  claimed_for_person_id uuid references registry_persons(person_id),
  source text not null,
  confidence text not null,
  note text,
  seen_at timestamptz not null default now()
);

create index if not exists idx_registry_person_link_conflicts_seen on registry_person_link_conflicts (seen_at desc);

-- ── Helpers ──────────────────────────────────────────────────────────────

-- The four systems this bridge knows. Anything else is refused rather than
-- stored under a name nothing can query.
create or replace function registry_person_systems()
returns text[] language sql immutable as $$
  select array['manychat','ig_scoped','ghl','tracker_name']::text[]
$$;

/**
 * A tracker name key: lowercase letters and single spaces, nothing else.
 * "Bradford  Wendt" and "bradford wendt" become the same key. This is for
 * LOOKUP only. Two people with the same key are not thereby the same person,
 * which is why this returns a key and never a person.
 */
create or replace function registry_person_name_key(p_name text)
returns text language sql immutable as $$
  select nullif(
    btrim(regexp_replace(lower(coalesce(p_name,'')), '[^a-z]+', ' ', 'g')),
    ''
  )
$$;

/** Which column holds a given system's ids. Kept in one place on purpose. */
create or replace function registry_person_column_for(p_system text)
returns text language sql immutable as $$
  select case p_system
    when 'manychat' then 'manychat_ids'
    when 'ig_scoped' then 'ig_scoped_ids'
    when 'ghl' then 'ghl_contact_ids'
    when 'tracker_name' then 'tracker_name_keys'
  end
$$;

/**
 * The live person holding one id, following merges to the survivor.
 * Returns null when nothing holds it. A null here means NOT YET BRIDGED; it
 * never means the person does not exist.
 */
create or replace function registry_person_holding(p_system text, p_id text)
returns uuid
language plpgsql stable as $$
declare
  v_id uuid;
  v_next uuid;
begin
  if p_id is null or btrim(p_id) = '' then return null; end if;

  -- One branch per system, each a bare `@>` predicate, for two reasons that
  -- both cost a backfill run to learn. `= any(array)` cannot use a GIN index
  -- at all, and wrapping `@>` in a CASE hides the containment from the
  -- planner, which turns every lookup back into a sequential scan. Four plain
  -- statements is the price of four index scans.
  if p_system = 'manychat' then
    select p.person_id into v_id from registry_persons p
     where p.manychat_ids @> array[p_id]
     order by (p.merged_into is null) desc, p.created_at limit 1;
  elsif p_system = 'ig_scoped' then
    select p.person_id into v_id from registry_persons p
     where p.ig_scoped_ids @> array[p_id]
     order by (p.merged_into is null) desc, p.created_at limit 1;
  elsif p_system = 'ghl' then
    select p.person_id into v_id from registry_persons p
     where p.ghl_contact_ids @> array[p_id]
     order by (p.merged_into is null) desc, p.created_at limit 1;
  elsif p_system = 'tracker_name' then
    select p.person_id into v_id from registry_persons p
     where p.tracker_name_keys @> array[p_id]
     order by (p.merged_into is null) desc, p.created_at limit 1;
  else
    return null;
  end if;

  -- Follow the merge chain to whoever is alive now. Bounded so a cycle
  -- introduced by hand can never hang a caller.
  for i in 1..10 loop
    exit when v_id is null;
    select merged_into into v_next from registry_persons where person_id = v_id;
    exit when v_next is null;
    v_id := v_next;
  end loop;

  return v_id;
end;
$$;

/**
 * RESOLVE. Any identifier in, one live person out.
 *
 * Accepts an exact id in any of the four systems, a person_id, or a name. A
 * NAME is resolved through tracker_name_keys and returns a person only when
 * exactly ONE live person holds that key; an ambiguous name returns nothing,
 * because a name that could be two people must never silently become one.
 */
create or replace function registry_person_resolve(p_identifier text)
returns uuid
language plpgsql stable as $$
declare
  v_id uuid;
  v_next uuid;
  v_key text;
  v_n integer;
begin
  if p_identifier is null or btrim(p_identifier) = '' then return null; end if;

  -- A person_id resolves to itself (or to its survivor). A non-uuid string
  -- simply falls through to the id lookups below.
  begin
    v_id := p_identifier::uuid;
  exception when others then
    v_id := null;
  end;
  if v_id is not null then
    for i in 1..10 loop
      select merged_into into v_next from registry_persons where person_id = v_id;
      exit when v_next is null;
      v_id := v_next;
    end loop;
    if exists (select 1 from registry_persons where person_id = v_id) then
      return v_id;
    end if;
    v_id := null;
  end if;

  -- An exact id, in the order that costs least and proves most.
  v_id := registry_person_holding('manychat', p_identifier);
  if v_id is not null then return v_id; end if;
  v_id := registry_person_holding('ig_scoped', p_identifier);
  if v_id is not null then return v_id; end if;
  v_id := registry_person_holding('ghl', p_identifier);
  if v_id is not null then return v_id; end if;

  -- A name. Only an unambiguous one answers.
  --
  -- Counted first and fetched second, rather than `min(person_id)`: Postgres
  -- has no min() for uuid, and the first version of this function only failed
  -- when a name actually reached this branch, which is to say when it mattered.
  v_key := registry_person_name_key(p_identifier);
  if v_key is null then return null; end if;
  select count(*) into v_n from registry_persons
   where merged_into is null and tracker_name_keys @> array[v_key];
  if v_n <> 1 then return null; end if;
  select person_id into v_id from registry_persons
   where merged_into is null and tracker_name_keys @> array[v_key] limit 1;
  return v_id;
end;
$$;

-- ── The one writer ───────────────────────────────────────────────────────

/**
 * LINK one id to a person, with evidence. This is the ONLY way an id joins a
 * person row, so the rules live in exactly one place:
 *
 *   1. A link with no source is refused. Evidence is not optional.
 *   2. confidence is 'hard' or 'name_match'. Nothing else exists.
 *   3. A 'name_match' link may never join two id SYSTEMS: it only ever
 *      attaches a tracker_name key. Enforced here, not by convention.
 *   4. If the id already belongs to another live person, this does NOT merge.
 *      It writes a conflict row and leaves both people alone. Merging is
 *      registry_person_merge's job and nothing else's.
 *
 * Returns the person the id ended up on, or the person it was already on.
 */
create or replace function registry_person_link(
  p_person_id uuid,
  p_system text,
  p_id text,
  p_source text,
  p_confidence text,
  p_display_name text default null,
  p_client_key text default null
)
returns uuid
language plpgsql as $$
declare
  v_holder uuid;
  v_value text;
begin
  if p_person_id is null then
    raise exception 'registry_person_link needs a person to link to.';
  end if;
  if not (p_system = any(registry_person_systems())) then
    raise exception 'registry_person_link: unknown id system "%". Known systems: %',
      p_system, array_to_string(registry_person_systems(), ', ');
  end if;
  if p_source is null or btrim(p_source) = '' then
    raise exception 'registry_person_link: a link needs a source. An id joined to a person with no evidence is exactly what this bridge exists to prevent.';
  end if;
  if p_confidence not in ('hard','name_match') then
    raise exception 'registry_person_link: confidence must be hard or name_match, not "%".', p_confidence;
  end if;
  if p_confidence = 'name_match' and p_system <> 'tracker_name' then
    raise exception 'registry_person_link: name_match may only attach a tracker_name key. Name similarity never joins two id systems; that is the signed person_identity rule.';
  end if;

  v_value := case when p_system = 'tracker_name'
                  then registry_person_name_key(p_id)
                  else nullif(btrim(p_id), '') end;
  if v_value is null then return p_person_id; end if;

  -- A NAME IS NOT EXCLUSIVE, and this is the whole difference between a name
  -- and an id. Real ids belong to one person, so a second claim on one is a
  -- conflict. Names do not: measured on the first backfill run, 528 name keys
  -- were claimed by more than one person, "aaron" among them. Treating the
  -- first claimant as the owner would leave exactly one person holding
  -- "aaron", and registry_person_resolve would then answer that name with
  -- total confidence and the wrong human.
  --
  -- So every person who is called this keeps the key, and resolve refuses any
  -- name more than one live person answers to. An ambiguous name returning
  -- nothing is the correct answer; a confident wrong person is not.
  if p_system = 'tracker_name' then
    update registry_persons
    set tracker_name_keys = case when tracker_name_keys @> array[v_value]
                                 then tracker_name_keys else tracker_name_keys || v_value end,
        display_name = coalesce(display_name, p_display_name),
        client_keys = case when p_client_key is null or p_client_key = any(client_keys)
                           then client_keys else client_keys || p_client_key end,
        evidence = case when tracker_name_keys @> array[v_value] then evidence
                        else evidence || jsonb_build_object(
                          'id', v_value, 'system', p_system, 'source', p_source,
                          'linked_at', now(), 'confidence', p_confidence) end,
        updated_at = now()
    where person_id = p_person_id;
    return p_person_id;
  end if;

  v_holder := registry_person_holding(p_system, v_value);

  -- Already ours: refresh the name and creator set, add nothing.
  if v_holder = p_person_id then
    update registry_persons
    set display_name = coalesce(display_name, p_display_name),
        client_keys = case when p_client_key is null or p_client_key = any(client_keys)
                           then client_keys else client_keys || p_client_key end,
        updated_at = now()
    where person_id = p_person_id;
    return p_person_id;
  end if;

  -- Somebody else holds it. Say so out loud and change nothing.
  if v_holder is not null then
    insert into registry_person_link_conflicts
      (system, id_value, held_by_person_id, claimed_for_person_id, source, confidence, note)
    values (p_system, v_value, v_holder, p_person_id, p_source, p_confidence,
      'This id already belongs to a different live person. Nothing was merged: merging two people is an explicit recorded operation, never a side effect of a link.');
    return v_holder;
  end if;

  update registry_persons
  set manychat_ids = case when p_system = 'manychat' then manychat_ids || v_value else manychat_ids end,
      ig_scoped_ids = case when p_system = 'ig_scoped' then ig_scoped_ids || v_value else ig_scoped_ids end,
      ghl_contact_ids = case when p_system = 'ghl' then ghl_contact_ids || v_value else ghl_contact_ids end,
      -- No tracker_name branch here on purpose: names returned above, where
      -- they are appended non-exclusively. Only the three real id systems,
      -- which ARE exclusive, reach this statement.
      display_name = coalesce(display_name, p_display_name),
      client_keys = case when p_client_key is null or p_client_key = any(client_keys)
                         then client_keys else client_keys || p_client_key end,
      evidence = evidence || jsonb_build_object(
        'id', v_value,
        'system', p_system,
        'source', p_source,
        'linked_at', now(),
        'confidence', p_confidence
      ),
      updated_at = now()
  where person_id = p_person_id;

  return p_person_id;
end;
$$;

/**
 * The person holding this id, created if nobody holds it yet. The entry point
 * every backfill sweep uses for the FIRST id of a row; the rest of that row's
 * ids go through registry_person_link against the person this returns.
 */
create or replace function registry_person_ensure(
  p_system text,
  p_id text,
  p_source text,
  p_confidence text,
  p_display_name text default null,
  p_client_key text default null
)
returns uuid
language plpgsql as $$
declare
  v_person uuid;
  v_value text;
  v_n integer;
begin
  v_value := case when p_system = 'tracker_name'
                  then registry_person_name_key(p_id)
                  else nullif(btrim(p_id), '') end;
  if v_value is null then return null; end if;

  -- A name only finds an existing person when exactly ONE live person answers
  -- to it. Names are not exclusive (see registry_person_link), so "the person
  -- holding this name" is a question with no answer whenever two people share
  -- a spelling, and inventing one would be the exact failure this brick exists
  -- to prevent.
  if p_system = 'tracker_name' then
    select count(*) into v_n from registry_persons
     where merged_into is null and tracker_name_keys @> array[v_value];
    if v_n = 1 then
      select person_id into v_person from registry_persons
       where merged_into is null and tracker_name_keys @> array[v_value] limit 1;
    else
      v_person := null;
    end if;
  else
    v_person := registry_person_holding(p_system, v_value);
  end if;

  if v_person is not null then
    return registry_person_link(v_person, p_system, v_value, p_source, p_confidence, p_display_name, p_client_key);
  end if;

  insert into registry_persons (display_name, client_keys)
  values (p_display_name, case when p_client_key is null then '{}'::text[] else array[p_client_key] end)
  returning person_id into v_person;

  return registry_person_link(v_person, p_system, v_value, p_source, p_confidence, p_display_name, p_client_key);
end;
$$;

/**
 * MERGE two people into one, explicitly, with a reason and an actor.
 *
 * The absorbed row keeps its ids and gains a merged_into pointer, so every id
 * it ever held still resolves, now to the survivor. Nothing is deleted, ever.
 */
create or replace function registry_person_merge(
  p_survivor uuid,
  p_absorbed uuid,
  p_reason text,
  p_actor text
)
returns uuid
language plpgsql as $$
declare
  v_absorbed registry_persons%rowtype;
begin
  if p_survivor is null or p_absorbed is null then
    raise exception 'registry_person_merge needs both a survivor and an absorbed person.';
  end if;
  if p_survivor = p_absorbed then
    raise exception 'registry_person_merge: a person cannot absorb themselves.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'registry_person_merge: a merge needs a written reason naming the evidence. A merge nobody can audit is a merge nobody should trust.';
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'registry_person_merge: a merge needs an actor.';
  end if;

  select * into v_absorbed from registry_persons where person_id = p_absorbed;
  if not found then raise exception 'registry_person_merge: no person %', p_absorbed; end if;
  if v_absorbed.merged_into is not null then
    raise exception 'registry_person_merge: person % was already absorbed by %.', p_absorbed, v_absorbed.merged_into;
  end if;
  if not exists (select 1 from registry_persons where person_id = p_survivor and merged_into is null) then
    raise exception 'registry_person_merge: the survivor % is not a live person.', p_survivor;
  end if;

  -- The survivor takes every id the absorbed row held, with the absorbed
  -- row's own evidence carried across unchanged.
  update registry_persons s
  set manychat_ids = (select array(select distinct e from unnest(s.manychat_ids || v_absorbed.manychat_ids) e)),
      ig_scoped_ids = (select array(select distinct e from unnest(s.ig_scoped_ids || v_absorbed.ig_scoped_ids) e)),
      ghl_contact_ids = (select array(select distinct e from unnest(s.ghl_contact_ids || v_absorbed.ghl_contact_ids) e)),
      tracker_name_keys = (select array(select distinct e from unnest(s.tracker_name_keys || v_absorbed.tracker_name_keys) e)),
      client_keys = (select array(select distinct e from unnest(s.client_keys || v_absorbed.client_keys) e)),
      display_name = coalesce(s.display_name, v_absorbed.display_name),
      evidence = s.evidence || v_absorbed.evidence,
      updated_at = now()
  where s.person_id = p_survivor;

  update registry_persons set merged_into = p_survivor, updated_at = now()
  where person_id = p_absorbed;

  insert into registry_person_merges
    (survivor_person_id, absorbed_person_id, reason, actor, absorbed_snapshot)
  values (p_survivor, p_absorbed, p_reason, p_actor, to_jsonb(v_absorbed));

  return p_survivor;
end;
$$;

-- ── The forward-write queue ──────────────────────────────────────────────
--
-- The capture paths that see both ids of a pair must not have to write to the
-- bridge inline: a webhook that blocks on bookkeeping is a webhook that drops
-- leads. They enqueue instead, and the backfill drains this on every sync
-- cycle. A queue row is evidence in transit, so it carries a source too.

create table if not exists registry_person_link_queue (
  id uuid primary key default gen_random_uuid(),
  system_a text not null,
  id_a text not null,
  system_b text,
  id_b text,
  source text not null,
  confidence text not null default 'hard',
  display_name text,
  client_key text,
  enqueued_at timestamptz not null default now(),
  drained_at timestamptz,
  error text
);

create index if not exists idx_registry_person_link_queue_pending
  on registry_person_link_queue (enqueued_at) where drained_at is null;

comment on table registry_person_link_queue is
  'Truth Layer Brick 5. Bridge evidence seen by a live capture path, waiting to be drained into registry_persons on the next sync cycle. Webhooks enqueue and return; they never block on the bridge.';
