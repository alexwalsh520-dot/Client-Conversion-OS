-- NextAuth sessions are checked by server routes. No browser Supabase access.
begin;
create table public.everfit_reports (
  id uuid primary key default gen_random_uuid(),
  coach_name text not null check (length(coach_name) between 1 and 100),
  review_date date not null,
  imported_at timestamptz not null default now(),
  imported_by text not null,
  content_hash text not null unique check (length(content_hash) = 64),
  preliminary boolean not null default true,
  client_count integer not null check (client_count between 1 and 600),
  document jsonb not null check (jsonb_typeof(document) = 'object')
);
create index everfit_reports_coach_date_idx on public.everfit_reports(coach_name, review_date desc, imported_at desc);
-- Only verified links are written here; candidate IDs remain in the snapshot.
create table public.everfit_client_links (
  report_id uuid not null references public.everfit_reports(id) on delete cascade,
  everfit_client_id text not null,
  client_id bigint not null references public.clients(id) on delete restrict,
  primary key(report_id, everfit_client_id),
  unique(report_id, client_id)
);
create index everfit_client_links_client_idx on public.everfit_client_links(client_id);
create table public.everfit_coach_access (
  email text not null check(email = lower(trim(email))),
  coach_name text not null check(length(coach_name) between 1 and 100),
  created_at timestamptz not null default now(),
  created_by text not null,
  primary key(email, coach_name)
);
alter table public.everfit_reports enable row level security;
alter table public.everfit_client_links enable row level security;
alter table public.everfit_coach_access enable row level security;
revoke all on public.everfit_reports, public.everfit_client_links, public.everfit_coach_access from public, anon, authenticated;
grant select, insert on public.everfit_reports, public.everfit_client_links to service_role;
grant select, insert, update, delete on public.everfit_coach_access to service_role;
-- Atomic report + FK links; retries return the original immutable snapshot.
create function public.import_everfit_report(p_document jsonb, p_hash text, p_actor text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  insert into public.everfit_reports(coach_name, review_date, imported_by, content_hash, preliminary, client_count, document)
  values(p_document->>'coach_name', (p_document->>'review_date')::date, p_actor, p_hash,
    (p_document->>'preliminary')::boolean, jsonb_array_length(p_document->'clients'), p_document)
  on conflict(content_hash) do nothing returning id into result;
  if result is null then
    select id into result from public.everfit_reports where content_hash = p_hash;
    return result;
  end if;
  insert into public.everfit_client_links(report_id, everfit_client_id, client_id)
  select result, c->>'everfit_id', (c->>'linked_client_id')::bigint
  from jsonb_array_elements(p_document->'clients') c
  where c->>'linked_client_id' is not null;
  return result;
end;
$$;
revoke all on function public.import_everfit_report(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.import_everfit_report(jsonb, text, text) to service_role;
create table public.everfit_questions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.everfit_reports(id) on delete cascade,
  everfit_client_id text not null,
  asked_by text not null,
  asked_at timestamptz not null default now(),
  question text not null check(length(question) between 1 and 1500),
  answer text,
  model text,
  status text not null default 'pending' check(status in ('pending','completed','failed'))
);
create index everfit_questions_actor_time_idx on public.everfit_questions(asked_by, asked_at desc);
create index everfit_questions_report_idx on public.everfit_questions(report_id);
alter table public.everfit_questions enable row level security;
revoke all on public.everfit_questions from public, anon, authenticated;
grant select, insert, update on public.everfit_questions to service_role;
create function public.reserve_everfit_question(p_report uuid, p_client text, p_question text, p_actor text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor, 0));
  if (select count(*) from public.everfit_questions where asked_by = p_actor and asked_at > now() - interval '1 minute') >= 5 then
    return null;
  end if;
  insert into public.everfit_questions(report_id, everfit_client_id, question, asked_by)
    values(p_report, p_client, p_question, p_actor) returning id into result;
  return result;
end;
$$;
revoke all on function public.reserve_everfit_question(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_everfit_question(uuid, text, text, text) to service_role;
commit;
