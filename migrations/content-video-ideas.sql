-- Content video ideas + trend briefs (Buyers / Playbook sections of the Content tab).
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

-- One row per creator per refresh: what is working on social right now to attract this
-- creator's buyer type. Newest version wins; older versions kept for history.
create table if not exists content_trend_briefs (
  id bigserial primary key,
  client_key text not null,
  version int not null,
  brief jsonb not null,
  searched boolean default false,
  model text,
  searched_at timestamptz default now(),
  unique (client_key, version)
);

-- 10 filmable video ideas per qualifying buyer (person_key set) and 10 for the ICP as a
-- whole (person_key null). Each idea carries the execution attributes plus a trend grade
-- against the current trend brief.
create table if not exists content_video_ideas (
  id bigserial primary key,
  client_key text not null,
  person_key text,
  icp_version int,
  batch_id text,
  sort_order int default 0,
  title text,
  format text,
  hook text,
  environment text,
  attire text,
  expression text,
  word_choice text,
  rationale text,
  grounded_in text,
  trend_score int,
  trend_take text,
  trend_version int,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists content_video_ideas_client_person
  on content_video_ideas (client_key, person_key);
