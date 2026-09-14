create table public.everfit_v2_reports (
 id uuid primary key default gen_random_uuid(),
 coach_name text not null,
 review_date date not null,
 document jsonb not null check (document->>'schema_version' = '2'),
 source_hash text not null unique,
 uploaded_by text not null,
 uploaded_at timestamptz not null default now()
);
create index everfit_v2_reports_coach_date_idx on public.everfit_v2_reports(coach_name, review_date desc);
alter table public.everfit_v2_reports enable row level security;
revoke all on public.everfit_v2_reports from public, anon, authenticated;
grant select, insert, update on public.everfit_v2_reports to service_role;
