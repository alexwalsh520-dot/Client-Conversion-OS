-- Content buyer voice (the aggregate overview at the top of the creator Buyers tab).
-- One row per creator per refresh: the collective voice across everyone who bought — what they keep
-- saying, what they notably don't, the most common pains + objections, and a synopsis. History kept.
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

create table if not exists content_buyer_voice (
  id bigserial primary key,
  client_key text not null,
  version int not null,
  icp_version int,
  buyer_count int,
  voice jsonb not null,
  model text,
  generated_at timestamptz default now(),
  unique (client_key, version)
);
