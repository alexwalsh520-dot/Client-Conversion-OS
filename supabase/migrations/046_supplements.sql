-- 046_supplements.sql
-- Supplements vertical: nutrition-consult funnel + supplement/coaching revenue,
-- every record tagged with the customer's acquisition path (A or B).
--
-- This is an EVENT model, not a metric-snapshot model — the dashboard computes
-- every KPI live by aggregating these tables, sliced by customer_path, product_type
-- and time period. Paste into the Supabase SQL editor (no programmatic DDL path).

-- ── Customers (identity across GHL + Shopify) ───────────────────────────────────
create table if not exists supplements_customers (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  phone               text,
  full_name           text,
  -- 'A' = closed coaching, then booked consult; 'B' = unclosed prospect, comp consult
  customer_path       text check (customer_path in ('A','B')),
  ghl_contact_id      text,
  shopify_customer_id text,
  first_seen_at       timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create unique index if not exists uq_supp_customers_email on supplements_customers (lower(email)) where email is not null;
create index if not exists idx_supp_customers_ghl on supplements_customers (ghl_contact_id);
create index if not exists idx_supp_customers_shopify on supplements_customers (shopify_customer_id);

-- ── Appointments (nutrition consults) ───────────────────────────────────────────
create table if not exists supplements_appointments (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid references supplements_customers(id) on delete set null,
  ghl_appointment_id text unique,
  customer_path      text check (customer_path in ('A','B')),
  booked_at          timestamptz,
  scheduled_for      timestamptz,
  status             text,            -- booked | showed | no_show | cancelled
  showed             boolean,
  closed             boolean,         -- did a supplement sale result?
  calendar           text,            -- source calendar id / name
  created_at         timestamptz default now()
);
create index if not exists idx_supp_appts_booked on supplements_appointments (booked_at);
create index if not exists idx_supp_appts_path on supplements_appointments (customer_path);

-- ── Payments (cash collected; supplements AND coaching, kept separate) ───────────
create table if not exists supplements_payments (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references supplements_customers(id) on delete set null,
  customer_path  text check (customer_path in ('A','B')),
  -- the split that must never be blended in the UI:
  product_type   text not null check (product_type in ('supplement','coaching')),
  source         text,             -- 'shopify' | 'stripe'
  external_id    text,             -- shopify order id / stripe charge id
  amount_cents   integer not null,
  refunded_cents integer default 0,
  is_recurring   boolean default false,  -- feeds MRR/ARR
  is_first_order boolean default false,  -- feeds Cash Collected Day 0
  occurred_at    timestamptz not null,
  created_at     timestamptz default now(),
  unique (source, external_id)
);
create index if not exists idx_supp_payments_occurred on supplements_payments (occurred_at);
create index if not exists idx_supp_payments_path on supplements_payments (customer_path);
create index if not exists idx_supp_payments_product on supplements_payments (product_type);

-- ── COGS (per-SKU unit cost; powers Profit / 30-Day GP / LTGP) ───────────────────
create table if not exists supplements_cogs (
  id               uuid primary key default gen_random_uuid(),
  sku              text,
  product_name     text,
  unit_cost_cents  integer,
  effective_from   date,
  created_at       timestamptz default now()
);

-- ── Funnel events (denominators for Booking Rate) ───────────────────────────────
-- 'coaching_closed' → Path A booking-rate denominator
-- 'comp_offer'      → Path B booking-rate denominator
-- 'consult_booked'  → numerator (mirrors an appointment)
create table if not exists supplements_funnel_events (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references supplements_customers(id) on delete set null,
  customer_path text check (customer_path in ('A','B')),
  event_type    text not null check (event_type in ('coaching_closed','comp_offer','consult_booked')),
  occurred_at   timestamptz not null,
  created_at    timestamptz default now()
);
create index if not exists idx_supp_funnel_occurred on supplements_funnel_events (occurred_at);
create index if not exists idx_supp_funnel_type on supplements_funnel_events (event_type);
