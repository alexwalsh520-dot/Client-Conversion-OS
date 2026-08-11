-- ─────────────────────────────────────────────────────────────────────────
-- 106 — PHASE 3: the copies of reality move into warehouse
--
-- Twelve tables move. ONE is deliberately left behind.
--
-- MOVED (12): ads_keyword_events, dm_conversation_messages, ghl_appointments,
--   sales_tracker_rows, manychat_origin_checks, manychat_tag_events,
--   instagram_lead_links, fx_rates, fathom_calls, fathom_call_links,
--   creator_content, creator_account_snapshots
--
-- DEFERRED (1): ads_meta_insights_daily. The frozen v1 Ads tab writes it from
--   src/app/api/sync/ads-tracker/route.ts, and a compatibility view cannot take
--   an INSERT ... ON CONFLICT, so moving it would mean editing v1. It is the ad
--   spend spine, so leaving it behind is a real gap and it is named as one.
--
-- ORDERING, which matters more here than in any earlier phase. Two of these
-- tables are written by LIVE WEBHOOKS: ads_keyword_events (every "someone sent
-- the magic word") and dm_conversation_messages (about 1,500 a day). Between a
-- migration landing and the repointed code deploying, every upsert to a moved
-- table fails, and a dropped keyword event is lost attribution, which is lost
-- money. So the order was inverted for this phase: the repointed code deployed
-- FIRST, with the door's serverInfo version bumped to 2.3.0 purely as a marker so
-- the deploy could be polled for rather than guessed at. The moment it answered
-- 2.3.0 (09:45:30 UTC) this migration was applied. The exposed window was seconds
-- rather than the length of a build.
--
-- Note this migration does NOT touch who can read what. That is migration 107,
-- kept separate on purpose: the window above was too tight to be doing two
-- different kinds of work in.
--
-- Reversible: drop the twelve public views, then
--   alter table warehouse.<name> set schema public;   (twelve times)
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  t text; moved int := 0; old_comment text;
  tables text[] := array[
    'ads_keyword_events','dm_conversation_messages','ghl_appointments','sales_tracker_rows',
    'manychat_origin_checks','manychat_tag_events','instagram_lead_links','fx_rates',
    'fathom_calls','fathom_call_links','creator_content','creator_account_snapshots'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise notice 'skipping %, not a table in public', t;
      continue;
    end if;

    select obj_description(format('public.%I', t)::regclass, 'pg_class') into old_comment;

    execute format('alter table public.%I set schema warehouse', t);
    execute format('create view public.%I with (security_invoker = true) as select * from warehouse.%I', t, t);
    execute format('grant select, insert, update, delete on warehouse.%I to service_role', t);
    execute format('grant select on public.%I to service_role', t);

    execute format('comment on table warehouse.%I is %L', t,
      coalesce(old_comment || ' ', '') ||
      '[MOVED to warehouse 2026-08-11 by migration 106, Semantic Layer consolidation Phase 3. ' ||
      'A compatibility view stands at public.' || t || ' for readers on the old name. ' ||
      'Writers must address warehouse.' || t || ' directly, because a view cannot take INSERT ... ON CONFLICT.]');

    execute format('comment on view public.%I is %L', t,
      'COMPATIBILITY VIEW over warehouse.' || t || ', left behind when that table moved on 2026-08-11 ' ||
      '(migration 106, Semantic Layer consolidation Phase 3). Readers only, security_invoker. ' ||
      'Anything that writes must address warehouse.' || t || ' directly.');

    moved := moved + 1;
  end loop;
  raise notice 'moved % tables into warehouse', moved;
end
$$;

-- Repoint the SQL functions that hard-code a public prefix, by regenerating each
-- one from its own stored definition with the prefix swapped by pattern. Never
-- retyped. The trailing character class stops one table name matching a longer
-- name that starts the same way.
do $$
declare
  fn record; newdef text; t text; rewritten int := 0;
  tables text[] := array[
    'ads_keyword_events','dm_conversation_messages','ghl_appointments','sales_tracker_rows',
    'manychat_origin_checks','manychat_tag_events','instagram_lead_links','fx_rates',
    'fathom_calls','fathom_call_links','creator_content','creator_account_snapshots'
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
  raise notice 'rewrote % functions', rewritten;
end
$$;

-- Functions that write through bare, unprefixed names get a search path that
-- looks in warehouse first, rather than a regex over their bodies.
do $$
declare
  fn record; fixed int := 0;
  tables text[] := array[
    'ads_keyword_events','dm_conversation_messages','ghl_appointments','sales_tracker_rows',
    'manychat_origin_checks','manychat_tag_events','instagram_lead_links','fx_rates',
    'fathom_calls','fathom_call_links','creator_content','creator_account_snapshots'
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
  end loop;
  raise notice 'pointed % writing functions at the room', fixed;
end
$$;

-- Default privileges do not reach tables that were MOVED in, only ones created
-- there, so the boundary credential is granted them explicitly. Every phase.
grant select on all tables in schema warehouse to ai_marketing_readonly;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema warehouse from ai_marketing_readonly;
