-- One database round trip for up to 50 conversations; failures stay isolated.
create function public.capture_everfit_inbox_batch(p_run uuid,p_actor text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; result jsonb; saved integer:=0; verified integer:=0;
 pending jsonb:='[]'; failures jsonb:='[]';
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then
  raise exception 'Batch requires 1–50 conversations';
 end if;
 perform 1 from public.everfit_inbox_runs where id=p_run and actor=p_actor and status='running' for update;
 if not found then raise exception 'Run unavailable'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  begin
   result:=public.capture_everfit_inbox(p_run,p_actor,item->'capture',item->>'coach',(item->>'client')::bigint);
   saved:=saved+1;
   if (result->>'complete')::boolean then verified:=verified+1;
   else pending:=pending||jsonb_build_array(item->'capture'->>'id'); end if;
  exception when others then
   failures:=failures||jsonb_build_array(jsonb_build_object('id',item->'capture'->>'id','error','Capture rejected; check run, identity and capture time.'));
  end;
 end loop;
 return jsonb_build_object('saved',saved,'verified',verified,'needsMore',pending,'failed',failures);
end;
$$;
revoke all on function public.capture_everfit_inbox_batch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.capture_everfit_inbox_batch(uuid,text,jsonb) to service_role;
