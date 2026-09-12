-- $50 downsell attribution (2026-09-12). Applied in Supabase via MCP as three
-- migrations: stripe_payments_subscriptions_and_renewals,
-- stripe_payments_invoice_id_full_unique, ads_keyword_events_allow_stripe_source.
-- Recorded here for history. Do not re-run blindly.

alter table public.stripe_payments
  alter column checkout_session_id drop not null,
  add column if not exists kind text not null default 'first_payment',
  add column if not exists invoice_id text,
  add column if not exists subscription_id text,
  add column if not exists customer_id text,
  add column if not exists phone text,
  add column if not exists billing_reason text,
  add column if not exists payment_link text,
  add column if not exists redirected_at timestamptz;
alter table public.stripe_payments
  drop constraint if exists stripe_payments_kind_check,
  add constraint stripe_payments_kind_check check (kind in ('first_payment','renewal'));
-- FULL unique index (nulls distinct): supabase-js upsert(onConflict) cannot use a partial one.
create unique index if not exists stripe_payments_invoice_id_uniq on public.stripe_payments (invoice_id);
create index if not exists stripe_payments_subscription_idx on public.stripe_payments (subscription_id);
create index if not exists stripe_payments_paid_at_idx on public.stripe_payments (paid_at);
create index if not exists stripe_payments_email_idx on public.stripe_payments (lower(email));

create table if not exists public.stripe_subscriptions (
  subscription_id text primary key,
  customer_id text,
  checkout_session_id text,
  client_key text not null default 'tyson',
  keyword text,
  subscriber_id text,
  client_reference_id text,
  email text,
  phone text,
  contact_name text,
  status text not null default 'active',
  started_at timestamptz not null,
  canceled_at timestamptz,
  cancel_reason text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stripe_subscriptions_customer_idx on public.stripe_subscriptions (customer_id);
create index if not exists stripe_subscriptions_email_idx on public.stripe_subscriptions (lower(email));
alter table public.stripe_subscriptions enable row level security;

-- Stripe joins manychat + ghl as a canonical keyword-event source.
alter table warehouse.ads_keyword_events
  drop constraint if exists ads_keyword_events_source_check,
  add constraint ads_keyword_events_source_check check (source = any (array['manychat'::text, 'ghl'::text, 'stripe'::text]));
