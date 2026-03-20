-- 003_mozi_metrics.sql
-- Mozi Metrics (Hormozi unit economics) tables
-- All monetary values stored in cents (integer)
-- Prefixed with mozi_ to avoid conflicts with existing CCOS tables

-- ============================================================
-- mozi_stripe_charges
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_stripe_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_id       text UNIQUE NOT NULL,
  influencer      text CHECK (influencer IN ('keith', 'tyson')),
  stripe_account  text,
  amount          int NOT NULL,            -- cents
  currency        text DEFAULT 'usd',
  status          text,
  customer_id     text,
  customer_email  text,
  refunded        boolean DEFAULT false,
  refund_amount   int DEFAULT 0,           -- cents
  disputed        boolean DEFAULT false,
  created_at      timestamptz,
  synced_at       timestamptz DEFAULT now()
);

-- ============================================================
-- mozi_whop_payments
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_whop_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_id         text UNIQUE NOT NULL,
  influencer      text,
  amount          int NOT NULL,            -- cents
  status          text,
  customer_email  text,
  created_at      timestamptz,
  synced_at       timestamptz DEFAULT now()
);

-- ============================================================
-- mozi_mercury_balances
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_mercury_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account         text CHECK (account IN ('coreshift', 'forge')),
  balance         int NOT NULL,            -- cents
  snapshot_date   date NOT NULL,
  synced_at       timestamptz DEFAULT now(),
  UNIQUE (account, snapshot_date)
);

-- ============================================================
-- mozi_mercury_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_mercury_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mercury_id      text UNIQUE NOT NULL,
  account         text,
  amount          int NOT NULL,            -- cents
  counterparty    text,
  description     text,
  posted_at       timestamptz,
  synced_at       timestamptz DEFAULT now()
);

-- ============================================================
-- mozi_meta_ad_spend
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_meta_ad_spend (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer      text DEFAULT 'tyson',
  ad_account_id   text,
  date            date NOT NULL,
  spend           int NOT NULL DEFAULT 0,  -- cents
  impressions     int DEFAULT 0,
  clicks          int DEFAULT 0,
  synced_at       timestamptz DEFAULT now(),
  UNIQUE (influencer, date)
);

-- ============================================================
-- mozi_ghl_contacts
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_ghl_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_id          text UNIQUE NOT NULL,
  email           text,
  name            text,
  stage           text,
  pipeline        text,
  tags            text[],
  status          text,
  monetary_value  int DEFAULT 0,           -- cents
  created_at      timestamptz,
  updated_at      timestamptz,
  synced_at       timestamptz DEFAULT now()
);

-- ============================================================
-- mozi_sheet_data
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_sheet_data (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_name      text,
  sheet_id        text,
  tab_name        text,
  row_data        jsonb,
  row_index       int,
  synced_at       timestamptz DEFAULT now()
);

-- ============================================================
-- mozi_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text UNIQUE NOT NULL,
  value           jsonb,
  updated_at      timestamptz DEFAULT now()
);

-- Default settings rows
INSERT INTO mozi_settings (key, value) VALUES
  ('business_type', '{"level": 3, "required_ratio": 9}'::jsonb),
  ('costs',         '{"coaching_per_client": 21800, "software_per_client": 2400, "payment_fee_pct": 2.9, "refund_rate_pct": 5, "chargeback_rate_pct": 1}'::jsonb),
  ('targets',       '{"new_clients_monthly": 25, "close_rate": 35, "show_rate": 75, "book_rate": 25, "churn_rate": 6}'::jsonb),
  ('coaches',       '[{"name": "Tyler", "current_clients": 38, "max_clients": 40}, {"name": "Kai", "current_clients": 42, "max_clients": 40}, {"name": "Daniela", "current_clients": 32, "max_clients": 40}, {"name": "Sam", "current_clients": 30, "max_clients": 40}]'::jsonb),
  ('overhead',      '{"ghl": 29700, "whop": 0, "other_software": 5000, "owner_draw": 0, "admin_payroll": 0, "other_fixed": 0}'::jsonb),
  ('sheet_ids',     '{}'::jsonb);

-- ============================================================
-- mozi_sync_log
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL,
  status          text CHECK (status IN ('success', 'error', 'running')),
  records_synced  int DEFAULT 0,
  error_message   text,
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

-- ============================================================
-- mozi_daily_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS mozi_daily_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date UNIQUE NOT NULL,
  gp30            int,                     -- cents
  cac             int,                     -- cents
  ltgp            int,                     -- cents
  ratio           numeric,
  payback30       int,                     -- cents
  capacity_pct    int,
  runway_months   numeric,
  cash_on_hand    int,                     -- cents
  monthly_burn    int,                     -- cents
  status          text,
  by_influencer   jsonb,
  created_at      timestamptz DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_mozi_stripe_charges_influencer  ON mozi_stripe_charges (influencer);
CREATE INDEX IF NOT EXISTS idx_mozi_stripe_charges_created_at  ON mozi_stripe_charges (created_at);
CREATE INDEX IF NOT EXISTS idx_mozi_whop_payments_influencer   ON mozi_whop_payments (influencer);
CREATE INDEX IF NOT EXISTS idx_mozi_mercury_tx_posted_at       ON mozi_mercury_transactions (posted_at);
CREATE INDEX IF NOT EXISTS idx_mozi_meta_ad_spend_date         ON mozi_meta_ad_spend (date);
CREATE INDEX IF NOT EXISTS idx_mozi_daily_snapshots_date       ON mozi_daily_snapshots (date);
CREATE INDEX IF NOT EXISTS idx_mozi_sync_log_source_started    ON mozi_sync_log (source, started_at);
