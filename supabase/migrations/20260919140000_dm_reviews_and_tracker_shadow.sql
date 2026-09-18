-- Setter DM reviews (Jeremy) + tracker autofill shadow (2026-09-19).
-- Paste into the Supabase SQL editor.

-- Per-conversation grades from Jeremy's nightly setter review. One row per
-- conversation per review day; the Setter Brief text lives in mm_reports
-- (kind 'setter', period_key '<date>:<setter>').
create table if not exists mm_dm_conversation_reviews (
  id bigserial primary key,
  review_date date not null,
  setter text not null,
  ig_subscriber_id text not null,
  manychat_subscriber_id text,
  lead_name text,
  grade integer,
  stage text,
  fields jsonb,
  model text,
  created_at timestamptz not null default now(),
  unique (review_date, ig_subscriber_id)
);
create index if not exists idx_mm_dm_conversation_reviews_setter_date on mm_dm_conversation_reviews (setter, review_date);
alter table mm_dm_conversation_reviews enable row level security;

-- What the tracker autofill WOULD write for each tracker row, with the source
-- and certainty of every cell, and how it compares to what the closer typed.
-- Nothing here touches the Google Sheet until TRACKER_AUTOFILL_WRITE=1.
create table if not exists tracker_autofill_shadow (
  sheet_row_key text primary key,
  row_date date not null,
  prospect text,
  closer text,
  proposal jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_tracker_autofill_shadow_date on tracker_autofill_shadow (row_date);
alter table tracker_autofill_shadow enable row level security;
