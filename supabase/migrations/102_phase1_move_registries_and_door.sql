-- ─────────────────────────────────────────────────────────────────────────
-- 102 — PHASE 1: the registries and the door plumbing move into warehouse
--
-- Eleven tables move. Nothing is deleted, nothing is renamed, and every one of
-- them is reversible with a single ALTER TABLE back. A view is left behind in
-- public under the old name so anything still reading by the old name keeps
-- working untouched.
--
-- Why these eleven first: they have the smallest blast radius of anything on the
-- list. Across the whole app only TWO files write to any of them
-- (src/lib/person-bridge-queue.ts and src/app/api/organic-keywords/route.ts).
-- Everything else that writes them is a SQL function, which this migration
-- handles, and everything else that reads them reads through the door.
--
-- THREE THINGS THIS MIGRATION DOES BEYOND THE MOVE, each explained where it
-- happens below:
--   1. gives service_role the key to the room, since it could not reach it
--   2. rewrites every SQL function that names these tables with a public prefix
--   3. stops handing these tables to the browser key, which it should never
--      have had (see the note on that step: this is a real hole being closed)
--
-- To reverse the whole phase:
--   drop the eleven public views, then
--   alter table warehouse.<name> set schema public;  (eleven times)
--   then re-run migrations 083 to 087 style grants if you also want anon back,
--   which you should not.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. The server needs the key to the room ──────────────────────────────
-- service_role had USAGE on nothing in warehouse and not one table grant there,
-- so the moment a table moved, every server read of it would have failed. It
-- bypasses row level security already, so this grants reach, not new power.
grant usage on schema warehouse to service_role;
alter default privileges for role postgres in schema warehouse
  grant select, insert, update, delete on tables to service_role;


-- ── 2. The move itself ───────────────────────────────────────────────────
do $$
declare
  t text;
  moved int := 0;
  tables text[] := array[
    'registry_definitions',
    'registry_entities',
    'registry_keywords',
    'registry_persons',
    'registry_person_merges',
    'registry_person_link_queue',
    'registry_person_link_conflicts',
    'organic_keywords',
    'door_ask_log',
    'door_miss_log',
    'door_freshness_thresholds'
  ];
  old_comment text;
begin
  foreach t in array tables loop
    -- Skip anything already moved, so this migration can be run twice safely.
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise notice 'skipping %, it is not a table in public', t;
      continue;
    end if;

    select obj_description(format('public.%I', t)::regclass, 'pg_class') into old_comment;

    execute format('alter table public.%I set schema warehouse', t);

    -- The compatibility view. security_invoker so it is checked as whoever calls
    -- it rather than as its owner, which means it hands out no privilege of its
    -- own and cannot become a back door into the room.
    execute format(
      'create view public.%I with (security_invoker = true) as select * from warehouse.%I', t, t);

    -- Carry over exactly the access the server actually uses, and no more.
    execute format('grant select, insert, update, delete on warehouse.%I to service_role', t);
    execute format('grant select on public.%I to service_role', t);

    -- Law 5: every moved table says where it went, and every new object is
    -- labelled at birth rather than later.
    execute format(
      'comment on table warehouse.%I is %L', t,
      coalesce(old_comment || ' ', '') ||
      '[MOVED to warehouse 2026-08-10 by migration 102, Semantic Layer consolidation Phase 1. ' ||
      'A compatibility view stands at public.' || t || ' for readers that still use the old name. ' ||
      'Writers must address warehouse.' || t || ' directly, because a view cannot take INSERT ... ON CONFLICT.]');

    execute format(
      'comment on view public.%I is %L', t,
      'COMPATIBILITY VIEW over warehouse.' || t || ', left behind when that table moved on 2026-08-10 ' ||
      '(migration 102, Semantic Layer consolidation Phase 1). Readers only. It is security_invoker, so it ' ||
      'grants nothing of its own. Anything that writes must address warehouse.' || t || ' directly.');

    moved := moved + 1;
  end loop;

  raise notice 'moved % tables into warehouse', moved;
end
$$;


-- ── 3. Repoint every SQL function that named these tables as public.<name> ──
-- Nine functions hard-code the public prefix. Left alone they would silently
-- start reading the compatibility view, which is correct for a read and fails
-- for a write, which is the worst of both worlds: quiet until it matters.
--
-- Each one is regenerated from its own stored definition with the prefix
-- swapped, rather than retyped, so there is no chance of a transcription slip.
-- The trailing character class in the pattern is what stops
-- public.registry_definitions from also matching public.registry_definitions_current,
-- which is a different object and must not be touched.
do $$
declare
  fn record;
  newdef text;
  t text;
  rewritten int := 0;
  tables text[] := array[
    'registry_definitions','registry_entities','registry_keywords','registry_persons',
    'registry_person_merges','registry_person_link_queue','registry_person_link_conflicts',
    'organic_keywords','door_ask_log','door_miss_log','door_freshness_thresholds'
  ];
begin
  for fn in
    select p.oid, p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and exists (select 1 from unnest(tables) x where p.prosrc ~ ('public\.' || x || '([^a-zA-Z0-9_]|$)'))
  loop
    newdef := fn.def;
    foreach t in array tables loop
      newdef := regexp_replace(newdef, 'public\.' || t || '([^a-zA-Z0-9_]|$)', 'warehouse.' || t || '\1', 'g');
    end loop;
    if newdef <> fn.def then
      execute newdef;
      rewritten := rewritten + 1;
      raise notice 'rewrote %', fn.sig;
    end if;
  end loop;
  raise notice 'rewrote % functions that named a moved table with a public prefix', rewritten;
end
$$;


-- ── 4. Point the WRITING functions at the room, not at the view ──────────
-- A second group of functions names these tables with no prefix at all. For a
-- read that is harmless: the name now resolves to the compatibility view and
-- returns the same rows. For a write it is fatal, because the view cannot take
-- one. Rather than rewrite these bodies, each writer is given a search path that
-- looks in warehouse first, so a bare name lands on the real table. Bare names
-- in those same bodies that mean tables still living in public keep resolving to
-- public, because warehouse does not contain them.
do $$
declare
  fn record;
  fixed int := 0;
  tables text[] := array[
    'registry_definitions','registry_entities','registry_keywords','registry_persons',
    'registry_person_merges','registry_person_link_queue','registry_person_link_conflicts',
    'organic_keywords','door_ask_log','door_miss_log','door_freshness_thresholds'
  ];
begin
  for fn in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and exists (
        select 1 from unnest(tables) x
        where p.prosrc ~* ('(insert\s+into|update|delete\s+from)\s+' || x || '([^a-zA-Z0-9_]|$)')
      )
  loop
    execute format('alter function %s set search_path = warehouse, public, pg_temp', fn.sig);
    fixed := fixed + 1;
    raise notice 'search path set to warehouse first on %', fn.sig;
  end loop;
  raise notice 'pointed % writing functions at the room', fixed;
end
$$;


-- ── 5. Stop handing this data to the browser key ─────────────────────────
-- Found while enumerating references for this phase, and worth stating plainly
-- because it is not a consolidation detail, it is a live hole.
--
-- Before this migration, public.registry_persons granted SELECT, INSERT, UPDATE
-- and DELETE to `anon` and had row level security switched OFF. `anon` is the
-- publishable key that ships inside the browser bundle. Anybody holding it could
-- read 8,124 people with their names and their ManyChat, GoHighLevel and
-- Instagram ids, and the same was true of registry_person_merges,
-- registry_person_link_queue and registry_person_link_conflicts. This was
-- verified against the live API, not inferred: the request returned 200 and real
-- rows.
--
-- Nothing in the app reads any of these with the browser key. Every reader and
-- writer of all eleven tables goes through getServiceSupabase(), which is
-- service_role. So the grants below take away access that no code was using.
--
-- The move already closes most of it, because the new compatibility views were
-- granted to service_role alone. This makes it explicit on both objects, and
-- says so out loud rather than letting it look like a side effect.
--
-- Reversible, if it ever turns out something did need it:
--   grant select on public.<name> to anon, authenticated;
do $$
declare
  t text;
  tables text[] := array[
    'registry_definitions','registry_entities','registry_keywords','registry_persons',
    'registry_person_merges','registry_person_link_queue','registry_person_link_conflicts',
    'organic_keywords','door_ask_log','door_miss_log','door_freshness_thresholds'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all on warehouse.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
