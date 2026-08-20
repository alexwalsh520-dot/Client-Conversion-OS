-- Attribution workspace (applied live 2026-08-19 as attribution_keyword_options_rpc).
-- The keyword picker's option list: every keyword that ever fired a DM event,
-- with the client it belongs to (keywords are unique across clients, so
-- picking one decides the client). The workspace's writes go to the existing
-- warehouse.adsv2_sale_resolutions table (adsv2_sale_resolutions_store), and
-- the existing labeler adsv2_label_sale_origins applies them to the facts
-- with evidence_key 'human_resolution'.
-- 2026-08-20 upgrade (applied live as attribution_keyword_options_activity):
-- the option list now carries activity so the picker shows what is firing
-- RIGHT NOW first, not an alphabetical wall of 199. last_seen_day = the last
-- day the keyword fired a DM event; events_30d = DM events in the last 30
-- days (0 = quiet). Return type changed, so drop + recreate.
drop function if exists public.attribution_keyword_options();

create function public.attribution_keyword_options()
returns table(client_key text, keyword_normalized text, last_seen_day date, events_30d bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select e.client_key,
         e.keyword_normalized,
         max(e.event_at)::date as last_seen_day,
         count(*) filter (where e.event_at >= now() - interval '30 days') as events_30d
    from warehouse.ads_keyword_events e
   where e.keyword_normalized is not null
     and e.client_key is not null
   group by 1, 2
   order by count(*) filter (where e.event_at >= now() - interval '30 days') desc,
            max(e.event_at) desc,
            e.keyword_normalized;
$$;

revoke execute on function public.attribution_keyword_options() from public;
revoke execute on function public.attribution_keyword_options() from anon;
grant execute on function public.attribution_keyword_options() to authenticated, service_role;

-- Applied live 2026-08-19 as share_links_allow_business_wide_attribution.
-- The attribution share link is business-wide by design: the queue lists wins
-- that have no creator yet (that is WHY they need review), so kind
-- 'attribution' carries no client_key. Every other kind keeps its scope rule.
alter table public.public_share_links drop constraint public_share_links_scope_ck;
alter table public.public_share_links add constraint public_share_links_scope_ck check (
  ((kind = 'factory') and (project_id is not null))
  or (kind = 'attribution')
  or ((kind not in ('factory', 'attribution')) and (client_key is not null))
);
