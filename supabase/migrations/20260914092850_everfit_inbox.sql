begin;
create table public.everfit_inbox_conversations (
 everfit_id text primary key check(everfit_id ~ '^[a-f0-9]{24}$'),
 name text not null,
 owner text not null,
 coach_name text,
 client_id bigint references public.clients(id) on delete restrict,
 last_captured_at timestamptz,
 synced_through timestamptz,
 history_complete boolean not null default false,
 checkpoint_id text,
 message_count integer not null default 0
);
create index everfit_inbox_coach_idx on public.everfit_inbox_conversations(coach_name, everfit_id);
create index everfit_inbox_client_idx on public.everfit_inbox_conversations(client_id);
create table public.everfit_inbox_messages (
 everfit_id text not null references public.everfit_inbox_conversations(everfit_id) on delete restrict,
 message_id text not null,
 sender text not null check(sender in ('coach','client','unknown')),
 text text not null,
 date text not null,
 time text not null,
 attachments boolean not null,
 observed_at timestamptz not null,
 primary key(everfit_id,message_id)
);
create table public.everfit_inbox_runs (
 id uuid primary key default gen_random_uuid(),
 actor text not null,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 status text not null default 'running' check(status in ('running','completed','partial')),
 roster_complete boolean not null,
 plan jsonb not null check(jsonb_typeof(plan)='array' and jsonb_array_length(plan) between 1 and 2000)
);
create table public.everfit_inbox_items (
 run_id uuid not null references public.everfit_inbox_runs(id) on delete restrict,
 everfit_id text not null,
 complete boolean not null,
 captured_at timestamptz not null,
 notes jsonb not null,
 primary key(run_id,everfit_id)
);
create index everfit_inbox_runs_actor_idx on public.everfit_inbox_runs(actor,started_at desc);
alter table public.everfit_inbox_conversations enable row level security;
alter table public.everfit_inbox_messages enable row level security;
alter table public.everfit_inbox_runs enable row level security;
alter table public.everfit_inbox_items enable row level security;
revoke all on public.everfit_inbox_conversations,public.everfit_inbox_messages,public.everfit_inbox_runs,public.everfit_inbox_items from public,anon,authenticated;
grant select,insert,update on public.everfit_inbox_conversations,public.everfit_inbox_messages,public.everfit_inbox_runs,public.everfit_inbox_items to service_role;
create function public.capture_everfit_inbox(p_run uuid,p_actor text,p_capture jsonb,p_coach text,p_client bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.everfit_inbox_runs; c public.everfit_inbox_conversations; planned jsonb; done boolean; stamp timestamptz; latest text;
begin
 select * into r from public.everfit_inbox_runs where id=p_run and actor=p_actor for update;
 if not found or r.status<>'running' then raise exception 'Run unavailable'; end if;
 select value into planned from jsonb_array_elements(r.plan) where value->>'id'=p_capture->>'id';
 if planned is null or planned->>'owner'<>p_capture->>'owner' then raise exception 'Roster mismatch'; end if;
 stamp := (p_capture->>'capturedAt')::timestamptz;
 if stamp<r.started_at or stamp>now()+interval '5 minutes' then raise exception 'Capture outside run'; end if;
 insert into public.everfit_inbox_conversations(everfit_id,name,owner,coach_name,client_id)
 values(p_capture->>'id',planned->>'name',planned->>'owner',p_coach,p_client) on conflict do nothing;
 select * into c from public.everfit_inbox_conversations where everfit_id=p_capture->>'id' for update;
 if c.last_captured_at>stamp then raise exception 'Stale capture'; end if;
 -- A name alone is never sufficient to link a CCOS client. Server verifies email.
 if c.client_id is not null and p_client is distinct from c.client_id then raise exception 'Client identity changed; review required'; end if;
 done := coalesce((p_capture->>'newestReached')::boolean,false) and
   (coalesce((p_capture->>'historyStartReached')::boolean,false) or
    (c.checkpoint_id is not null and exists(select 1 from jsonb_array_elements(p_capture->'messages') m where m->>'id'=c.checkpoint_id)));
 insert into public.everfit_inbox_messages(everfit_id,message_id,sender,text,date,time,attachments,observed_at)
 select c.everfit_id,m->>'id',m->>'sender',m->>'text',m->>'date',m->>'time',(m->>'attachments')::boolean,stamp
 from jsonb_array_elements(p_capture->'messages') m
 on conflict(everfit_id,message_id) do update set sender=excluded.sender,text=excluded.text,date=excluded.date,time=excluded.time,attachments=excluded.attachments,observed_at=excluded.observed_at;
 -- Collector supplies oldest to newest source order; checkpoint is an observed ID, never a parsed display date.
 select m->>'id' into latest from jsonb_array_elements(p_capture->'messages') with ordinality t(m,n) order by n desc limit 1;
 update public.everfit_inbox_conversations set name=planned->>'name',owner=planned->>'owner',coach_name=p_coach,client_id=p_client,
 last_captured_at=stamp, synced_through=case when done then stamp else synced_through end,
 history_complete=history_complete or (done and coalesce((p_capture->>'historyStartReached')::boolean,false)),
 checkpoint_id=case when done then coalesce(latest,checkpoint_id) else checkpoint_id end,
 message_count=(select count(*) from public.everfit_inbox_messages where everfit_id=c.everfit_id)
 where everfit_id=c.everfit_id;
 insert into public.everfit_inbox_items values(p_run,c.everfit_id,done,stamp,p_capture->'notes')
 on conflict(run_id,everfit_id) do update set complete=excluded.complete,captured_at=excluded.captured_at,notes=excluded.notes;
 return jsonb_build_object('saved',true,'complete',done);
end;
$$;
revoke all on function public.capture_everfit_inbox(uuid,text,jsonb,text,bigint) from public,anon,authenticated;
grant execute on function public.capture_everfit_inbox(uuid,text,jsonb,text,bigint) to service_role;
create function public.finish_everfit_inbox(p_run uuid,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.everfit_inbox_runs; n integer; total integer; result text;
begin
 select * into r from public.everfit_inbox_runs where id=p_run and actor=p_actor for update;
 if not found then raise exception 'Run unavailable'; end if;
 total := jsonb_array_length(r.plan);
 select count(*) into n from public.everfit_inbox_items where run_id=p_run and complete;
 result := case when n=total and r.roster_complete then 'completed' else 'partial' end;
 update public.everfit_inbox_runs set status=result,finished_at=coalesce(finished_at,now()) where id=p_run;
 return jsonb_build_object('status',result,'complete',n,'total',total,'asOf',r.started_at);
end;
$$;
revoke all on function public.finish_everfit_inbox(uuid,text) from public,anon,authenticated;
grant execute on function public.finish_everfit_inbox(uuid,text) to service_role;
commit;
