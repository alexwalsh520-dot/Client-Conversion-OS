-- ─────────────────────────────────────────────────────────────────────────
-- 114 — GOOGLE MEET JOIN EVENTS: the raw copy of "who actually entered the
-- room" for every sales call, so show / no_show stops depending on a closer
-- typing Yes into a sheet.
--
-- Source: Google Admin Reports API (Meet audit activity, one row per
-- participant session, eventName call_ended). Synced by
-- /api/cron/gmeet-join-sync, which stays silently disabled until the
-- Google Workspace service-account env vars exist (the closers are being
-- moved onto a company domain first; personal-gmail hosts are invisible to
-- the Reports API, verified 8/23).
--
-- Consumed by the metrics-engine build job: an appointment whose Meet code
-- has a non-host participant session becomes a SHOW; host-only sessions
-- after the call window becomes a NO_SHOW; no data at all falls back to the
-- sheet (which also keeps close/payment authority always).
--
-- Same posture as 113: floor-2 copy table, RLS on with NO anon policies,
-- service-role writes only, boundary read role gets select, public
-- security_invoker compatibility view. Idempotent; pasted by hand or
-- applied via MCP.
-- ─────────────────────────────────────────────────────────────────────────

create schema if not exists warehouse;

create table if not exists warehouse.gmeet_join_events (
  id uuid primary key default gen_random_uuid(),

  -- Meet code with dashes stripped, lowercased ('fyyitvhgoa'), so it joins
  -- against links parsed from ghl_appointments regardless of formatting.
  meeting_code text not null,

  -- Participant identity as the audit log reports it: an email for
  -- workspace/google accounts, else a display name, else 'anonymous'.
  participant_identifier text,
  participant_display_name text,
  -- True when the audit log marks the participant outside the workspace
  -- (the prospect); hosts and reps are internal.
  is_external boolean,

  -- Session timing from the audit event.
  joined_at timestamptz,
  left_at timestamptz,
  duration_seconds integer,
  device_type text,

  -- The organizer (host) email the audit event names, when present.
  organizer_email text,

  -- Reports API activity uniqueQualifier + event time: the idempotency key.
  source_event_key text not null unique,

  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

comment on table warehouse.gmeet_join_events is
  'Raw Google Meet participant sessions from the Admin Reports API (one row per participant per call). Written only by /api/cron/gmeet-join-sync (service role). The metrics-engine build derives show/no_show from these; the sheet is the fallback.';

create index if not exists idx_gmeet_join_events_code
  on warehouse.gmeet_join_events (meeting_code, joined_at);
create index if not exists idx_gmeet_join_events_synced
  on warehouse.gmeet_join_events (synced_at desc);

alter table warehouse.gmeet_join_events enable row level security;

grant select, insert, update, delete on warehouse.gmeet_join_events to service_role;

create or replace view public.gmeet_join_events
  with (security_invoker = true) as select * from warehouse.gmeet_join_events;
grant select on public.gmeet_join_events to service_role;

comment on view public.gmeet_join_events is
  'COMPATIBILITY VIEW over warehouse.gmeet_join_events (migration 114). Readers only, security_invoker. Writers must address warehouse.gmeet_join_events.';

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ai_marketing_readonly') then
    grant select on warehouse.gmeet_join_events to ai_marketing_readonly;
    revoke insert, update, delete, truncate, references, trigger
      on warehouse.gmeet_join_events from ai_marketing_readonly;
  end if;
end $$;
