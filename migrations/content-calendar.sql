-- Content Calendar tab (operator accountability hub): tracks each creator against a posting quota.
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

-- One row per creator: the weekly posting cadence they're held to. Editable in the UI.
-- story_schedule is keyed mon..sun; each value is {"label": "..."} for a post day, or null for a
-- rest day (Sunday by default). All timezone reasoning is America/New_York.
create table if not exists content_cadences (
  client_key text primary key,
  reels_per_day int not null default 6,
  carousels_per_day int not null default 1,
  story_schedule jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per manually-toggled slot. Detection (from creator_content) fills slots automatically;
-- a mark here OVERRIDES detection in both directions (done=true forces green, done=false forces
-- not-covered even if a post exists). slot_type is 'reel' | 'carousel' | 'story'.
create table if not exists content_calendar_marks (
  id bigserial primary key,
  client_key text not null,
  for_date date not null,
  slot_type text not null,
  slot_index int not null,
  done boolean not null default true,
  marked_by text,
  updated_at timestamptz not null default now(),
  unique (client_key, for_date, slot_type, slot_index)
);

create index if not exists content_calendar_marks_lookup
  on content_calendar_marks (client_key, for_date);

-- Seed both creators with the default cadence: 6 ICP reels/day, 1 carousel/day, and the themed
-- story schedule (Sunday is rest — null).
insert into content_cadences (client_key, reels_per_day, carousels_per_day, story_schedule)
values
  ('tyson', 6, 1, '{
     "mon": {"label": "Direct CTA to coaching (made by us)"},
     "tue": {"label": "Testimonials from the weekend"},
     "wed": {"label": "Connection (personal story / life update / Q&A / family)"},
     "thu": {"label": "CTA to lead magnet (written by us)"},
     "fri": {"label": "Testimonials from the week"},
     "sat": {"label": "Connection"},
     "sun": null
   }'::jsonb),
  ('antwan', 6, 1, '{
     "mon": {"label": "Direct CTA to coaching (made by us)"},
     "tue": {"label": "Testimonials from the weekend"},
     "wed": {"label": "Connection (personal story / life update / Q&A / family)"},
     "thu": {"label": "CTA to lead magnet (written by us)"},
     "fri": {"label": "Testimonials from the week"},
     "sat": {"label": "Connection"},
     "sun": null
   }'::jsonb)
on conflict (client_key) do nothing;

-- Stale-source alerting needs to remember when it last SHOUTED (not just when it observed), so the
-- Slack notice fires once per cooldown window instead of every two hours.
alter table source_freshness_alerts add column if not exists notified_at timestamptz;
