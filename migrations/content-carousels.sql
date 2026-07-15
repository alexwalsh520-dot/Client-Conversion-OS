-- Content carousels (operator-only Carousels tab). One row per creator/date/slot; 5 slots (0-4) per
-- day. slides jsonb = array of slide objects: {text} from generation, plus a persisted {blocks} layout
-- once opened in the editor. Downloads/previews render from blocks when present, else from text.
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

create table if not exists content_carousels (
  id bigserial primary key,
  client_key text not null,
  for_date date not null,
  slot int not null,
  topic text,
  slides jsonb not null,
  edited boolean default false,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (client_key, for_date, slot)
);
