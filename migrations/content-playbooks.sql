-- Content playbooks (the Playbook tab's daily filming sheet, both operator + creator views).
-- One row per creator per refresh: 20 ready-to-film talking-head hooks (each with a presentation note)
-- plus 10-14 topics that hit the ICP. Newest version wins; history kept.
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

create table if not exists content_playbooks (
  id bigserial primary key,
  client_key text not null,
  version int not null,
  icp_version int,
  trend_version int,
  playbook jsonb not null,
  model text,
  generated_at timestamptz default now(),
  unique (client_key, version)
);
