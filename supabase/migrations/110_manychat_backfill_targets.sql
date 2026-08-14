-- ─────────────────────────────────────────────────────────────────────────
-- 110 — the work list for the Phase 4 identity backfill
--
-- Every keyword sender that has no Instagram link yet AND has never been asked
-- about. Computed here rather than in the script because the "already linked"
-- test spans three tables and pulling them into node to intersect would be silly.
--
-- Excluding anyone already attempted, whatever the outcome, is what makes the
-- backfill resumable: a rate limit costs nothing that was already done.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.manychat_backfill_targets(p_client text default null, p_limit integer default null)
returns table(client_key text, manychat_id text)
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
  select s.client_key, s.mc_id
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
          where b.manychat_id = s.mc_id)
  order by s.client_key, s.mc_id
  limit coalesce(p_limit, 2147483647);
$function$;

comment on function public.manychat_backfill_targets(text, integer) is
  'The work list for the Semantic Layer Phase 4 identity backfill: keyword senders with no Instagram link and no previous attempt. Excluding anyone already attempted, whatever the outcome, is what makes the backfill resumable and stops a rate limit costing anything already done.';

grant execute on function public.manychat_backfill_targets(text, integer) to service_role;
revoke execute on function public.manychat_backfill_targets(text, integer) from anon, authenticated;
