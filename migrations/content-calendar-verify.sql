-- Content Calendar: per-client timezone + the verification model.
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

-- 1. Every client keeps their own clock. All day-bucketing, "today", end-of-day and reconciliation
--    read this, so a creator in another zone is never judged against New York midnight.
alter table content_cadences
  add column if not exists timezone text not null default 'America/New_York';

-- 2. One row per client per local day, written by the reconcile cron.
--    reconciled_at = the last time we compared the day's slots against what was actually posted.
--    finalized     = the day is closed (only set >=6h after the local day ended, so a late scrape
--                    can still turn a CLAIMED slot into VERIFIED). Finalized days are never re-run.
create table if not exists content_calendar_days (
  id bigserial primary key,
  client_key text not null,
  for_date date not null,
  reconciled_at timestamptz,
  finalized boolean not null default false,
  unique (client_key, for_date)
);

create index if not exists content_calendar_days_lookup
  on content_calendar_days (client_key, for_date);

-- Note: Sunday remains a REST day for STORIES ONLY (story_schedule.sun stays null). Reels and
-- carousels are expected at full quota every day including Sunday — that is handled in the slot
-- logic, not here, so no cadence data change is required.
