begin;
create table public.everfit_sync_runs (
  id uuid primary key default gen_random_uuid(), actor text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check(status in ('running','completed','partial','cancelled')),
  plan jsonb not null check(jsonb_typeof(plan)='array' and jsonb_array_length(plan) between 1 and 2000),
  report_ids uuid[] not null default '{}'
);
create unique index everfit_sync_one_active_actor on public.everfit_sync_runs(actor) where status='running';
create table public.everfit_sync_items (
  run_id uuid not null references public.everfit_sync_runs(id),
  everfit_id text not null check(everfit_id ~ '^[a-f0-9]{24}$'),
  status text not null check(status in ('processing','completed','failed')),
  captured_at timestamptz not null default now(), lease_until timestamptz,
  capture jsonb, brief jsonb, coach_name text, error text,
  primary key(run_id,everfit_id)
);
create index everfit_sync_items_history on public.everfit_sync_items(everfit_id,captured_at desc);
alter table public.everfit_sync_runs enable row level security;
alter table public.everfit_sync_items enable row level security;
revoke all on public.everfit_sync_runs,public.everfit_sync_items from public,anon,authenticated;
grant select,insert,update on public.everfit_sync_runs,public.everfit_sync_items to service_role;
create function public.claim_everfit_sync_item(p_run uuid,p_client text,p_capture jsonb,p_actor text)
returns text language plpgsql security invoker set search_path='' as $$
declare item public.everfit_sync_items%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_run::text||p_client,0));
  if not exists(select 1 from public.everfit_sync_runs r where r.id=p_run and r.actor=p_actor and r.status='running'
    and exists(select 1 from jsonb_array_elements(r.plan) p where p->>'id'=p_client and p->>'owner'=p_capture->>'owner')) then
    raise exception 'Sync unavailable';
  end if;
  select * into item from public.everfit_sync_items where run_id=p_run and everfit_id=p_client;
  if item.status='completed' then return 'completed'; end if;
  if item.status='processing' and item.lease_until>now() then return 'busy'; end if;
  insert into public.everfit_sync_items(run_id,everfit_id,status,capture,lease_until)
  values(p_run,p_client,'processing',p_capture,now()+interval '3 minutes')
  on conflict(run_id,everfit_id) do update set status='processing',capture=p_capture,lease_until=now()+interval '3 minutes',captured_at=now(),error=null;
  return 'claimed';
end; $$;
revoke all on function public.claim_everfit_sync_item(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_everfit_sync_item(uuid,text,jsonb,text) to service_role;
commit;
