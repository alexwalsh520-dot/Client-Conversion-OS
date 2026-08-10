-- ─────────────────────────────────────────────────────────────────────────
-- 105 — PHASE 2: the clean facts move into warehouse
--
-- Ten tables move. Six are deliberately LEFT WHERE THEY ARE, and the reason is
-- the frozen v1 Ads tab, which is alive and whose code this build never edits.
--
-- MOVED (10):
--   adsv2_dm_facts, adsv2_booking_facts, adsv2_sale_facts,
--   adsv2_sale_resolutions, adsv2_booking_resolutions,
--   adsv2_window_snapshots, adsv2_budget_snapshots,
--   adsv2_alerts, adsv2_sync_runs, adsv2_meta
--
-- DEFERRED (6), each because v1 code UPSERTS it and a compatibility view cannot
-- take an INSERT ... ON CONFLICT, so moving it would mean editing v1:
--   ad_creative_copy          v1 writes it from src/lib/ads-tracker/creative-copy.ts
--                             and src/app/api/ads/creative-copy/backfill-all/route.ts
--   ad_creative_image         v1 writes it from src/lib/ads-tracker/creative-image.ts
--   ad_creative_transcripts   v1 writes it from src/lib/ads-tracker/creative-transcript.ts
--   ad_set_targeting          v1 writes it from src/app/api/sync/ads-tracker/route.ts
--   ads_dashboard_snapshots   v1 writes it from src/lib/ads-tracker/snapshot.ts
--   sale_attribution_facts    v1 writes it from src/lib/ads-tracker/sale-facts.ts
--
-- A v1 table that v1 only READS could still have moved, because the
-- compatibility view serves a read perfectly well. It is specifically the
-- upserts that make these six undeliverable without touching v1.
--
-- TIMING NOTE, because this phase carries a risk Phase 1 did not: the hourly
-- sync upserts adsv2_meta, adsv2_sync_runs, adsv2_window_snapshots,
-- adsv2_budget_snapshots and adsv2_alerts every hour at 25 past. Between this
-- migration landing and the repointed code deploying, a sync would fail on those
-- upserts. This was applied at 10:45 UTC with the last sync at 10:26 and the next
-- at 11:26, and the deploy followed within minutes. The next sync was watched and
-- its result is recorded in the report.
--
-- Reversible: drop the ten public views, then
--   alter table warehouse.<name> set schema public;   (ten times)
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  moved int := 0;
  old_comment text;
  tables text[] := array[
    'adsv2_dm_facts','adsv2_booking_facts','adsv2_sale_facts',
    'adsv2_sale_resolutions','adsv2_booking_resolutions',
    'adsv2_window_snapshots','adsv2_budget_snapshots',
    'adsv2_alerts','adsv2_sync_runs','adsv2_meta'
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
      '[MOVED to warehouse 2026-08-10 by migration 105, Semantic Layer consolidation Phase 2. ' ||
      'A compatibility view stands at public.' || t || ' for readers on the old name. ' ||
      'Writers must address warehouse.' || t || ' directly, because a view cannot take INSERT ... ON CONFLICT.]');

    execute format('comment on view public.%I is %L', t,
      'COMPATIBILITY VIEW over warehouse.' || t || ', left behind when that table moved on 2026-08-10 ' ||
      '(migration 105, Semantic Layer consolidation Phase 2). Readers only, security_invoker, so it grants ' ||
      'nothing of its own. Anything that writes must address warehouse.' || t || ' directly.');

    moved := moved + 1;
  end loop;
  raise notice 'moved % tables into warehouse', moved;
end
$$;

-- Repoint the SQL functions that hard-code a public prefix. Same method as
-- migration 102: regenerate each function from its own stored definition with the
-- prefix swapped by pattern, never retyped. The trailing character class is what
-- keeps one table name from matching a longer one that starts the same way.
do $$
declare
  fn record; newdef text; t text; rewritten int := 0;
  tables text[] := array[
    'adsv2_dm_facts','adsv2_booking_facts','adsv2_sale_facts',
    'adsv2_sale_resolutions','adsv2_booking_resolutions',
    'adsv2_window_snapshots','adsv2_budget_snapshots',
    'adsv2_alerts','adsv2_sync_runs','adsv2_meta'
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
-- looks in warehouse first, rather than a risky regex over their bodies.
do $$
declare
  fn record; fixed int := 0;
  tables text[] := array[
    'adsv2_dm_facts','adsv2_booking_facts','adsv2_sale_facts',
    'adsv2_sale_resolutions','adsv2_booking_resolutions',
    'adsv2_window_snapshots','adsv2_budget_snapshots',
    'adsv2_alerts','adsv2_sync_runs','adsv2_meta'
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

-- Take these away from the browser key. Every reader and writer of all ten is
-- server side and uses service_role: checked file by file before running this,
-- and none of the nineteen files involved imports the browser client or sits in
-- a client component. Nine of the twenty-two publicly readable tables reported
-- after Phase 1 are closed right here, including adsv2_sale_facts, which is cash.
do $$
declare
  t text;
  tables text[] := array[
    'adsv2_dm_facts','adsv2_booking_facts','adsv2_sale_facts',
    'adsv2_sale_resolutions','adsv2_booking_resolutions',
    'adsv2_window_snapshots','adsv2_budget_snapshots',
    'adsv2_alerts','adsv2_sync_runs','adsv2_meta'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all on warehouse.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- The migration 103 lesson, applied without being asked twice: default
-- privileges do not reach tables that were MOVED in, so the boundary credential
-- has to be granted them explicitly, every phase.
grant select on all tables in schema warehouse to ai_marketing_readonly;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema warehouse from ai_marketing_readonly;
