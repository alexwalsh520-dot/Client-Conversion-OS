-- Attribution workspace (applied live 2026-08-19 as attribution_keyword_options_rpc).
-- The keyword picker's option list: every keyword that ever fired a DM event,
-- with the client it belongs to (keywords are unique across clients, so
-- picking one decides the client). The workspace's writes go to the existing
-- warehouse.adsv2_sale_resolutions table (adsv2_sale_resolutions_store), and
-- the existing labeler adsv2_label_sale_origins applies them to the facts
-- with evidence_key 'human_resolution'.
create or replace function public.attribution_keyword_options()
returns table(client_key text, keyword_normalized text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select distinct e.client_key, e.keyword_normalized
    from warehouse.ads_keyword_events e
   where e.keyword_normalized is not null
     and e.client_key is not null
   order by 1, 2;
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
