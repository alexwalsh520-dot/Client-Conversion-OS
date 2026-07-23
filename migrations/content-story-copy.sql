-- Team-written story copy per creator per day. We write the story copy; the creator reads it on
-- their calendar and posts it. One row per (client, day); empty copy clears it in place.
--
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

create table if not exists content_story_copy (
  id bigserial primary key,
  client_key text not null,
  for_date date not null,
  copy text not null,
  updated_by text,
  updated_at timestamptz default now(),
  unique (client_key, for_date)
);

create index if not exists content_story_copy_lookup
  on content_story_copy (client_key, for_date);
