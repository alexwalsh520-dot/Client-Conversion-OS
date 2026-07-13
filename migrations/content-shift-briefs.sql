-- Content shift briefs (the Playbook header analysis on the creator page).
-- One row per creator per refresh: who the creator's content is pulling in today vs the ICP that
-- actually pays, and the concrete shifts to close that gap. Newest version wins; history kept.
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

create table if not exists content_shift_briefs (
  id bigserial primary key,
  client_key text not null,
  version int not null,
  icp_version int,
  brief jsonb not null,
  model text,
  generated_at timestamptz default now(),
  unique (client_key, version)
);
