-- ICP tab (/icp) — the veteran voice-of-customer corpus.
--
-- Verbatim prospect quotes pulled out of fathom_calls. Populated by
-- scripts/sync-icp-corpus.mjs, which uses scripts/lib/icp-extract.mjs so the
-- app and the markdown corpus stay identical.
--
-- Personal disclosure from recorded sales calls (drinking, divorce,
-- depression). Service-role only: no anon/authenticated grants, and RLS on
-- with no permissive policy so a leaked browser key reads nothing.

create table if not exists public.icp_people (
  fathom_id      text primary key,
  name           text not null,
  call_title     text,
  closer         text,
  recorded_on    date,
  duration_sec   integer,
  words_spoken   integer not null default 0,
  quote_count    integer not null default 0,
  -- how he said he served, verbatim
  vet_lines      jsonb not null default '[]'::jsonb,
  -- every line he spoke, in order, unfiltered
  raw_lines      jsonb not null default '[]'::jsonb,
  synced_at      timestamptz not null default now()
);

create table if not exists public.icp_quotes (
  id          bigserial primary key,
  fathom_id   text not null references public.icp_people(fathom_id) on delete cascade,
  theme       text not null,
  -- his words, exactly as transcribed
  quote       text not null,
  -- our closer's preceding line, kept only so his answer has context
  context     text,
  position    integer not null default 0
);

create index if not exists icp_quotes_theme_idx  on public.icp_quotes (theme);
create index if not exists icp_quotes_person_idx on public.icp_quotes (fathom_id);
create index if not exists icp_people_count_idx  on public.icp_people (quote_count desc);

alter table public.icp_people enable row level security;
alter table public.icp_quotes enable row level security;

revoke all on public.icp_people from anon, authenticated;
revoke all on public.icp_quotes from anon, authenticated;
