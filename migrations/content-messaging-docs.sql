-- Master Messaging / ICP documents a creator gives us, stored so the generators can treat the
-- creator's own words as ground truth even before they have any buyers or ingested posts.
--
-- SCHEMA ONLY lives in this repo (the repo is public). The document TEXT is inserted directly into
-- Supabase out-of-band and never committed here.
--
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

create table if not exists content_messaging_docs (
  id bigserial primary key,
  client_key text not null,
  version int not null,
  title text,
  doc_text text not null,
  uploaded_at timestamptz default now(),
  unique (client_key, version)
);

create index if not exists content_messaging_docs_lookup
  on content_messaging_docs (client_key, version desc);
