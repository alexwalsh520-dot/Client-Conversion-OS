-- Applied live 2026-08-22 as ripdrip_events_table.
-- RipDrip webhook events: raw copies of what the AI setter platform tells us.
-- One row per webhook POST to /api/ripdrip/webhook. The identity key is
-- lead_username (the lead's Instagram handle) — the thread that re-welds
-- bookings to conversations after the 2026-08-13 attribution break.
create table public.ripdrip_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_type text,
  lead_username text,
  lead_name text,
  platform text,
  lead_email text,
  conversation_link text,
  -- true = HMAC checked out; false = failed; null = no secret configured yet
  signature_valid boolean,
  payload jsonb not null
);

create index ripdrip_events_received_at_idx on public.ripdrip_events (received_at);
create index ripdrip_events_lead_username_idx on public.ripdrip_events (lead_username);

comment on table public.ripdrip_events is
  'COPY OF REALITY: raw RipDrip (AI DM setter) webhook events. Written only by /api/ripdrip/webhook (service role). Identity key = lead_username (IG handle). Created 2026-08-22 for the attribution rebuild.';

alter table public.ripdrip_events enable row level security;
