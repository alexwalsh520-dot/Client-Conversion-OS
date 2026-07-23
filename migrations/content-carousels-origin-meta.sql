-- Provenance for carousels so an externally-generated set (the Jeremy/Utari worker) is
-- distinguishable from CCOS's own generation, and can carry the objection + source it was built from.
--   origin : 'internal' (CCOS pipeline) | 'external' (the content worker)
--   meta   : freeform per-slot bag — the worker stores { objection, source } here
--
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

alter table content_carousels
  add column if not exists origin text not null default 'internal';

alter table content_carousels
  add column if not exists meta jsonb;
