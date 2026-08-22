-- ─────────────────────────────────────────────────────────────────────────
-- 113 — METRICS ENGINE: one ledger + one event log powering the marketing,
-- sales, and rep dashboards.
--
-- Design (inherits the 054 design laws: integer cents, ET days, natural
-- unique keys, immutable history; and the 083 identity laws: links carry
-- evidence, merges are explicit and never automatic):
--
--   warehouse.metrics_leads — the PERSON-LEVEL LEDGER. One row per lead per
--     client. A lead is someone WE messaged first (an inbound DM we never
--     answered is not a lead). lead_key is a stable natural id derived from
--     the strongest identity we hold: 'mc:<manychat_subscriber_id>' when the
--     person has a ManyChat identity, else 'ig:<instagram_scoped_id>'.
--     origin_source is the FIRST categorization ever and is immutable once
--     set to a real value; conversion_source is the MOST RECENT
--     categorization event ('unclassified' is a legal stored state that
--     dashboards fold into 'misc').
--
--   warehouse.metrics_lead_events — the EVENT LOG. One row per fact about a
--     lead (lead_created, categorization, lm_optin, dial, pickup, booking,
--     reschedule, show, no_show, close, payment). Natural unique key
--     (source, source_row_key) makes ingestion idempotent. lead_key is
--     nullable because events can arrive before identity resolves (they
--     still count in activity totals; they cannot count in cohort views).
--     The build job rewrites a rolling recent window (delete+insert, the 054
--     pattern), so older history is immutable in practice.
--
--   warehouse.metrics_manual_entries — REP-CONSOLE submissions (outcome /
--     reschedule / show_fix / cash / note) from the public tokenized rep
--     console. The build job merges outcome/cash entries into the event log
--     as override events with source 'manual' and stamps applied = true.
--
-- Reads/writes are service-role only: RLS is enabled with NO anon policies.
-- Compatibility views stand in public with security_invoker (the 106
-- pattern) so generic tooling can find the tables under their plain names;
-- app code addresses warehouse.<table> directly.
--
-- Idempotent and additive. Safe to run twice. There is no migration runner:
-- this file is pasted into the Supabase SQL editor by hand, and all app code
-- tolerates these tables not existing yet (empty results +
-- migration_pending: true).
-- ─────────────────────────────────────────────────────────────────────────

create schema if not exists warehouse;

-- ── The person-level ledger ──────────────────────────────────────────────

create table if not exists warehouse.metrics_leads (
  id uuid primary key default gen_random_uuid(),

  -- Short canonical creator key ('tyson', 'jake').
  client_key text not null,
  -- Stable natural id: 'mc:<subscriber_id>' else 'ig:<ig_scoped_id>'.
  lead_key text not null,

  -- Optional link into registry_persons (the identity bridge). Never joined
  -- by name; only set when a hard-key path resolved it.
  person_id uuid,

  -- The raw identities behind lead_key, for joins and display.
  manychat_subscriber_id text,
  ig_scoped_id text,
  ig_handle text,
  ghl_contact_ids text[] not null default '{}',
  display_name text,

  -- When WE first messaged them (first outbound message / ManyChat new_lead).
  acquired_at timestamptz not null,
  acquired_et_day date not null,

  -- FIRST categorization ever. Immutable once set to a non-'unclassified'
  -- value. 'unclassified' is a temporary stored state; dashboards fold it
  -- into 'misc'.
  origin_source text not null default 'unclassified'
    check (origin_source in ('ad','organic','follower','misc','unclassified')),
  origin_keyword text,

  -- MOST RECENT categorization event (the conversion lens reads the event
  -- log for time-accurate answers; these columns are the current snapshot).
  conversion_source text
    check (conversion_source is null
           or conversion_source in ('ad','organic','follower','misc','unclassified')),
  conversion_keyword text,
  conversion_source_at timestamptz,

  -- Lead-magnet (Skool) opt-in moment — starts the 60-second dial clock.
  lm_optin_at timestamptz,

  -- Which stored rows proved this row's identities and categorization.
  evidence jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (client_key, lead_key)
);

comment on table warehouse.metrics_leads is
  'Metrics engine ledger: one row per lead (someone WE messaged first) per client. origin_source = first categorization ever (immutable once set); conversion_source = latest categorization snapshot. Written only by the metrics-ledger-build job (service role).';

create index if not exists idx_metrics_leads_client_acquired
  on warehouse.metrics_leads (client_key, acquired_et_day);
create index if not exists idx_metrics_leads_manychat
  on warehouse.metrics_leads (manychat_subscriber_id);
create index if not exists idx_metrics_leads_lead_key
  on warehouse.metrics_leads (lead_key);

-- ── The event log ────────────────────────────────────────────────────────

create table if not exists warehouse.metrics_lead_events (
  id uuid primary key default gen_random_uuid(),

  client_key text not null,
  -- Nullable: an event can arrive before identity resolves. It still counts
  -- in activity totals; it cannot count in cohort views.
  lead_key text,

  event_type text not null check (event_type in
    ('lead_created','categorization','lm_optin','dial','pickup','booking',
     'reschedule','show','no_show','close','payment')),

  -- Booking channel. lm buckets are decided by first-dial timing against
  -- lm_optin_at; with no dial source yet, lm leads default to the gt60
  -- bucket (recorded in metadata.channel_basis).
  channel text check (channel is null
    or channel in ('dm','lm_outbound_lt60','lm_outbound_gt60','outbound')),

  -- Short rep key from src/lib/metrics-engine/team.ts, when a rep owns the
  -- event (bookings, outcomes). Null when no rep applies.
  rep_key text,

  occurred_at timestamptz not null,
  et_day date not null,

  -- Money is integer USD cents. Only payment events carry an amount.
  amount_cents bigint,

  -- Where this event came from ('manychat', 'ads_keyword_events',
  -- 'dm_conversation_messages', 'skool', 'ghl_appointments', 'sheet',
  -- 'manual', later 'stripe'/'whop') and the natural key of the source row.
  source text not null,
  source_row_key text not null,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  unique (source, source_row_key)
);

comment on table warehouse.metrics_lead_events is
  'Metrics engine event log: one row per fact about a lead. Idempotent by (source, source_row_key). The build job rewrites a rolling recent window; older rows are immutable in practice.';

create index if not exists idx_metrics_lead_events_client_day
  on warehouse.metrics_lead_events (client_key, et_day);
create index if not exists idx_metrics_lead_events_type
  on warehouse.metrics_lead_events (event_type, et_day);
create index if not exists idx_metrics_lead_events_lead
  on warehouse.metrics_lead_events (lead_key, occurred_at);

-- ── Rep-console manual entries ───────────────────────────────────────────

create table if not exists warehouse.metrics_manual_entries (
  id uuid primary key default gen_random_uuid(),

  client_key text not null,
  -- The GHL appointment this entry is about, when it is about one.
  appointment_key text,
  -- Direct lead reference, when known (else derived from appointment_key).
  lead_key text,

  entry_type text not null check (entry_type in
    ('outcome','reschedule','show_fix','cash','note')),

  -- Flexible payload, validated by the API:
  --   outcome:    { "outcome": "show" | "no_show" | "close",
  --                 "cash_cents"?: number, "occurred_at"?: iso }
  --   reschedule: { "occurred_at"?: iso, "note"?: string }
  --   show_fix:   { "occurred_at"?: iso }
  --   cash:       { "amount_cents": number, "occurred_at"?: iso }
  --   note:       { "note": string }
  value jsonb not null default '{}'::jsonb,

  rep_name text,
  -- The public_share_links token the submission arrived through (audit).
  share_token text,
  entered_at timestamptz not null default now(),
  -- Stamped true once the build job has merged this entry into the event log.
  applied boolean not null default false
);

comment on table warehouse.metrics_manual_entries is
  'Rep-console submissions from the public tokenized console. outcome/cash entries are merged into metrics_lead_events as source=manual override events by the build job (applied=true once merged).';

create index if not exists idx_metrics_manual_entries_client
  on warehouse.metrics_manual_entries (client_key, entered_at desc);
create index if not exists idx_metrics_manual_entries_appointment
  on warehouse.metrics_manual_entries (appointment_key);

-- ── RLS: service-role only (no anon policies, on purpose) ────────────────

alter table warehouse.metrics_leads enable row level security;
alter table warehouse.metrics_lead_events enable row level security;
alter table warehouse.metrics_manual_entries enable row level security;

grant select, insert, update, delete on warehouse.metrics_leads to service_role;
grant select, insert, update, delete on warehouse.metrics_lead_events to service_role;
grant select, insert, update, delete on warehouse.metrics_manual_entries to service_role;

-- ── Public compatibility views (the 106 pattern): readers on the plain
--    name see the warehouse table; writers must address warehouse.<table>.
--    security_invoker means the caller's own rights decide, so anon gets
--    nothing (RLS on, no policies).

create or replace view public.metrics_leads
  with (security_invoker = true) as select * from warehouse.metrics_leads;
create or replace view public.metrics_lead_events
  with (security_invoker = true) as select * from warehouse.metrics_lead_events;
create or replace view public.metrics_manual_entries
  with (security_invoker = true) as select * from warehouse.metrics_manual_entries;

grant select on public.metrics_leads to service_role;
grant select on public.metrics_lead_events to service_role;
grant select on public.metrics_manual_entries to service_role;

comment on view public.metrics_leads is
  'COMPATIBILITY VIEW over warehouse.metrics_leads (metrics engine, migration 113). Readers only, security_invoker. Writers must address warehouse.metrics_leads.';
comment on view public.metrics_lead_events is
  'COMPATIBILITY VIEW over warehouse.metrics_lead_events (metrics engine, migration 113). Readers only, security_invoker. Writers must address warehouse.metrics_lead_events.';
comment on view public.metrics_manual_entries is
  'COMPATIBILITY VIEW over warehouse.metrics_manual_entries (metrics engine, migration 113). Readers only, security_invoker. Writers must address warehouse.metrics_manual_entries.';

-- ── Share-link settings (rep console) ────────────────────────────────────
-- The rep console launches VIEW-ONLY: closers keep their spreadsheet while
-- the owner tests the page, then editing is switched on per token. That
-- flag lives on the token row itself: public_share_links.settings jsonb.
--   settings->>'can_edit' = 'true'  → the console accepts manual entries
--                                     (default OFF: absent/anything else)
--   settings->>'rep_key'            → optional: scope the appointment list
--                                     to one rep (null = sees all reps,
--                                     which is what the owner's first token
--                                     uses). The leaderboard always shows
--                                     everyone.
-- public_share_links is a PUBLIC-schema table (migration 049), so this is
-- an additive column there, guarded in case the table is absent.
do $$ begin
  if to_regclass('public.public_share_links') is not null then
    alter table public.public_share_links
      add column if not exists settings jsonb not null default '{}'::jsonb;
  end if;
end $$;

-- Keep the boundary read credential's posture consistent with 106: it may
-- read warehouse tables, never write them. (No-op if the role is absent.)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ai_marketing_readonly') then
    grant select on warehouse.metrics_leads, warehouse.metrics_lead_events,
      warehouse.metrics_manual_entries to ai_marketing_readonly;
    revoke insert, update, delete, truncate, references, trigger
      on warehouse.metrics_leads, warehouse.metrics_lead_events,
         warehouse.metrics_manual_entries from ai_marketing_readonly;
  end if;
end $$;
