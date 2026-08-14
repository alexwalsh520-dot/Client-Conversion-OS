-- ─────────────────────────────────────────────────────────────────────────
-- 112 — THE HEADLINE MEASURE for Phase 4
--
-- "Thread readable" means this person sent a magic word AND their ManyChat id
-- can be followed to an Instagram id that actually appears in the stored DM
-- threads. That is the difference between knowing somebody messaged and being
-- able to read what they said.
--
-- Defined once, here, so the before number and the after number are measured the
-- same way and the comparison means something.
--
-- BASELINE, 2026-08-14, before any backfill ran:
--   all      2,605 of 7,846   33.2%
--   tyson    2,152 of 6,084   35.4%
--   jake       171 of   171  100.0%   (the forward capture already works)
--   antwan     282 of   390   72.3%
--   keith        0 of 1,154    0.0%
--   lucy         0 of    48    0.0%
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.manychat_identity_coverage()
returns table(client text, keyword_senders bigint, thread_readable bigint, still_unlinked bigint)
language sql
stable security definer
set search_path to 'warehouse', 'public', 'pg_temp'
as $function$
  with senders as (
    select distinct e.client_key, e.subscriber_id::text as mc_id
    from warehouse.ads_keyword_events e
    where e.subscriber_id is not null
  ),
  bridge as (
    select distinct l.manychat_subscriber_id::text as mc_id, l.instagram_user_id::text as ig_id
    from warehouse.instagram_lead_links l where l.instagram_user_id is not null
    union
    select distinct m, i
    from warehouse.registry_persons p, unnest(p.manychat_ids) m, unnest(p.ig_scoped_ids) i
    where p.merged_into is null
  ),
  threads as (
    select distinct d.subscriber_id::text as ig_id
    from warehouse.dm_conversation_messages d where d.subscriber_id is not null
  ),
  scored as (
    select s.client_key,
           s.mc_id,
           exists (select 1 from bridge b join threads t on t.ig_id = b.ig_id where b.mc_id = s.mc_id) as readable,
           exists (select 1 from bridge b where b.mc_id = s.mc_id) as bridged
    from senders s
  )
  select coalesce(client_key, '(ALL)') as client,
         count(*) as keyword_senders,
         count(*) filter (where readable) as thread_readable,
         count(*) filter (where not bridged) as still_unlinked
  from scored
  group by rollup(client_key)
  order by count(*) desc;
$function$;

comment on function public.manychat_identity_coverage() is
  'The headline measure for Semantic Layer Phase 4: keyword senders that can be followed from their ManyChat id to an Instagram id that really appears in the stored DM threads. Defined once so the before and after numbers are comparable. Baseline 2026-08-14 before any backfill: 2,605 of 7,846 = 33.2% overall, tyson 35.4%, jake 100%, keith 0%.';

grant execute on function public.manychat_identity_coverage() to service_role;
grant execute on function public.manychat_identity_coverage() to ai_marketing_readonly;
revoke execute on function public.manychat_identity_coverage() from anon, authenticated;
