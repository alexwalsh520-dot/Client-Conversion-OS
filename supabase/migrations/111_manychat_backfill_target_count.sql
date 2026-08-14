-- ─────────────────────────────────────────────────────────────────────────
-- 111 — how many the Phase 4 backfill still has to ask about
--
-- Exists because of a bug the dry run caught. The API in front of the database
-- caps any single response at 1,000 rows, so the work-list function cannot be
-- used to answer "how many are left": it would answer 1,000 forever, and a run
-- would report itself finished while thousands were still waiting. This counts
-- in the database and returns one number, which no row cap can truncate.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.manychat_backfill_target_count(p_client text default null)
returns bigint
language sql
stable security definer
set search_path to 'warehouse', 'public', 'pg_temp'
as $function$
  with senders as (
    select distinct e.client_key, e.subscriber_id::text as mc_id
    from warehouse.ads_keyword_events e
    where e.subscriber_id is not null
      and (p_client is null or e.client_key = p_client)
  )
  select count(*)
  from senders s
  where not exists (
          select 1 from warehouse.instagram_lead_links l
          where l.manychat_subscriber_id::text = s.mc_id and l.instagram_user_id is not null)
    and not exists (
          select 1 from warehouse.registry_persons p
          where p.merged_into is null
            and s.mc_id = any(p.manychat_ids)
            and cardinality(coalesce(p.ig_scoped_ids, '{}')) > 0)
    and not exists (
          select 1 from warehouse.manychat_identity_backfill b
          where b.manychat_id = s.mc_id);
$function$;

comment on function public.manychat_backfill_target_count(text) is
  'How many keyword senders the Semantic Layer Phase 4 identity backfill still has to ask ManyChat about. Counts in the database because the row cap on the work-list function makes it useless for counting.';

grant execute on function public.manychat_backfill_target_count(text) to service_role;
revoke execute on function public.manychat_backfill_target_count(text) from anon, authenticated;
