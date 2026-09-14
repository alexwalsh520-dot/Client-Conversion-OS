begin;
alter table public.everfit_inbox_conversations add column recent_activity jsonb not null default '[]'::jsonb check(jsonb_typeof(recent_activity)='array'), add column activity_captured_at timestamptz;
create or replace function public.capture_everfit_inbox(p_run uuid,p_actor text,p_capture jsonb,p_coach text,p_client bigint)
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
 if coalesce((p_capture->>'activityCaptured')::boolean,false) then
  update public.everfit_inbox_conversations set recent_activity=coalesce(p_capture->'updates','[]'::jsonb),activity_captured_at=stamp where everfit_id=c.everfit_id;
 end if;
 return jsonb_build_object('saved',true,'complete',done);
end;
$$;
revoke all on function public.capture_everfit_inbox(uuid,text,jsonb,text,bigint) from public,anon,authenticated;
grant execute on function public.capture_everfit_inbox(uuid,text,jsonb,text,bigint) to service_role;
commit;
