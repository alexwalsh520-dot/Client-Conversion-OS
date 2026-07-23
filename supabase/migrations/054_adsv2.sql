-- ─────────────────────────────────────────────────────────────────────────
-- Ads v2 (Piece 1) — a clean, granular facts store + budget snapshots +
-- window cache. Everything is namespaced adsv2_ so nothing collides with v1.
--
-- Design laws honored here:
--   * The facts store keeps INDIVIDUAL-level rows (every DM, booking, sale),
--     each with its keyword, link method, evidence, and Eastern-time day.
--   * Window tables are aggregations OVER the facts store, never a replacement.
--   * Idempotency by schema: every table has a natural unique key + upsert.
--   * Money is integer cents. Native currency is kept AND a USD copy stored.
--   * Historical facts are written once; the sync only ever rewrites a rolling
--     recent window, so yesterday's rows stay immutable.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Budget settings snapshot (the ONLY new external sync in v2) ────────────
-- One row per entity (campaign or ad set) per Eastern-time day. With ABO the
-- budget sits on the ad set; with CBO it sits on the campaign; ads never hold
-- a budget. "holds_budget" records which level actually carries it that day.
-- Raising a budget today only ever writes today's row — past days are never
-- re-fetched, so budget history is immutable exactly like spend.
create table if not exists adsv2_budget_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_key text not null,
  entity_level text not null check (entity_level in ('campaign','adset')),
  entity_id text not null,
  entity_name text,
  campaign_id text,
  et_day date not null,
  currency text not null default 'USD',
  daily_budget_cents bigint,              -- native minor units; null if none at this level
  lifetime_budget_cents bigint,
  daily_budget_usd_cents bigint,          -- converted for that ET day
  lifetime_budget_usd_cents bigint,
  holds_budget boolean not null default false,
  effective_status text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (entity_level, entity_id, et_day)
);
create index if not exists adsv2_budget_client_day on adsv2_budget_snapshots (client_key, et_day);
create index if not exists adsv2_budget_entity_day on adsv2_budget_snapshots (entity_id, et_day);

-- ── DM facts: one row per ManyChat keyword DM event ────────────────────────
-- Counts of "messages" are distinct subscribers per keyword per window taken
-- over these rows. Organic + awaiting-review rows are stored but not displayed.
create table if not exists adsv2_dm_facts (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,         -- stable id from ads_keyword_events
  client_key text not null,
  subscriber_id text,
  subscriber_name text,
  keyword_normalized text,
  is_organic boolean not null default false,
  awaiting_review boolean not null default false,
  et_day date not null,                   -- ET day of the DM event
  evidence jsonb,
  computed_at timestamptz not null default now()
);
create index if not exists adsv2_dm_client_day_kw on adsv2_dm_facts (client_key, et_day, keyword_normalized);
create index if not exists adsv2_dm_client_sub on adsv2_dm_facts (client_key, subscriber_id);

-- ── Booking facts: one row per sales-calendar appointment ──────────────────
-- Booked calls count DISTINCT PEOPLE (contact_id) per keyword per window.
-- booked_et_day = the ET day the call is SCHEDULED for (start_time), so it
-- lines up with calls-taken (same call day) and show rate stays coherent.
-- is_upcoming is derived (start_time in the future) and refreshed each sync.
create table if not exists adsv2_booking_facts (
  id uuid primary key default gen_random_uuid(),
  appointment_key text not null unique,   -- ghl appointment_id
  client_key text not null,
  contact_id text,
  person_name text,
  keyword_normalized text,
  is_organic boolean not null default false,
  awaiting_review boolean not null default false,  -- keywordless / unresolved
  calendar_id text,
  calendar_name text,
  booked_et_day date not null,            -- etDay(start_time)
  dm_et_day date,                         -- when they DMed, if known (hover)
  is_upcoming boolean not null default false,
  status text,
  start_time timestamptz,
  created_time timestamptz,
  evidence jsonb,
  computed_at timestamptz not null default now()
);
create index if not exists adsv2_booking_client_day_kw on adsv2_booking_facts (client_key, booked_et_day, keyword_normalized);
create index if not exists adsv2_booking_client_contact on adsv2_booking_facts (client_key, contact_id);

-- ── Sale facts: one row per sales-tracker row ──────────────────────────────
-- Revenue + calls-taken + new-clients. Attributed to a keyword by HARD KEY
-- only (method column records which). Unprovable rows are awaiting_review and
-- never displayed in this piece. Money kept native + USD.
create table if not exists adsv2_sale_facts (
  id uuid primary key default gen_random_uuid(),
  sale_key text not null unique,
  client_key text,                        -- creator that owns the attributed keyword
  keyword_normalized text,                -- null when unattributed
  method text not null default 'none',    -- link_booking|link_dm|origin_check|human|organic|none
  is_organic boolean not null default false,
  awaiting_review boolean not null default false,
  call_taken boolean not null default false,
  is_win boolean not null default false,
  currency text not null default 'USD',
  collected_cents bigint not null default 0,
  contracted_cents bigint not null default 0,
  collected_usd_cents bigint not null default 0,
  contracted_usd_cents bigint not null default 0,
  prospect_name text,
  subscriber_id text,
  closer text,
  sale_et_day date not null,              -- sales_tracker_rows.date
  evidence jsonb,
  computed_at timestamptz not null default now()
);
create index if not exists adsv2_sale_client_day_kw on adsv2_sale_facts (client_key, sale_et_day, keyword_normalized);
create index if not exists adsv2_sale_subscriber on adsv2_sale_facts (subscriber_id);

-- ── Window snapshot cache (precomputed, version-stamped) ───────────────────
create table if not exists adsv2_window_snapshots (
  id uuid primary key default gen_random_uuid(),
  account text not null,                  -- 'all' | 'tyson' | 'jake'
  date_from date not null,
  date_to date not null,
  level text not null,                    -- 'campaign' | 'adset' | 'ad'
  status text not null,                   -- 'active' | 'finished' | 'all'
  data_version bigint not null,
  payload jsonb not null,
  compute_ms integer,
  computed_at timestamptz not null default now(),
  unique (account, date_from, date_to, level, status)
);
create index if not exists adsv2_window_lookup on adsv2_window_snapshots (account, date_from, date_to, level, status);

-- ── Small key/value store for the current data version + freshness stamps ──
create table if not exists adsv2_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into adsv2_meta (key, value)
  values ('data_version', '1'::jsonb)
  on conflict (key) do nothing;

-- ── Sync run log (per source, isolated, for failure containment + freshness)
create table if not exists adsv2_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                   -- budget | facts | precompute | selfcheck
  status text not null,                   -- ok | error
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  rows integer,
  duration_ms integer,
  detail jsonb,
  error text
);
create index if not exists adsv2_sync_runs_source on adsv2_sync_runs (source, started_at desc);

-- ── Self-check alerts (reported for humans, never silently excluded) ───────
create table if not exists adsv2_alerts (
  id uuid primary key default gen_random_uuid(),
  et_day date not null,
  alert_type text not null,
  client_key text,
  severity text not null default 'warn',
  dedupe_key text not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  unique (dedupe_key)
);
create index if not exists adsv2_alerts_day_type on adsv2_alerts (et_day desc, alert_type);
