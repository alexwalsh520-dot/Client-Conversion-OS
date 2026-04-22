-- 015_accountant_finance_planning.sql
-- Manual finance-planning inputs for the Accountant tab.
-- Paste this into the Supabase SQL editor for project `bostjayrguulwaltnbgt`.

CREATE TABLE IF NOT EXISTS accountant_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accountant_client_periods (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key                  text NOT NULL,
  client_name                 text NOT NULL,
  period_start                date NOT NULL,
  period_end                  date NOT NULL,
  status                      text NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'ready', 'sent', 'paid')),
  cash_collected_cents        int,
  net_cash_cents              int,
  ad_spend_cents              int,
  sales_team_line_cents       int,
  program_months_sold         int,
  coaching_line_cents         int,
  coaching_reserve_cents      int,
  forecast_fulfillment_cents  int,
  software_fee_cents          int,
  profit_share_cents          int,
  invoice_total_cents         int,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_key, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS accountant_manual_obligations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label            text NOT NULL,
  obligation_type  text NOT NULL,
  payee_name       text,
  client_name      text,
  due_date         date NOT NULL,
  amount_cents     int NOT NULL,
  status           text NOT NULL DEFAULT 'owed'
                     CHECK (status IN ('owed', 'scheduled', 'paid')),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO accountant_settings (key, value) VALUES
  ('sales_team_invoice_pct', to_jsonb(15)),
  ('coaching_line_per_program_month_cents', to_jsonb(3000)),
  ('coaching_target_per_active_client_cents', to_jsonb(2400)),
  ('coaching_hard_cap_per_active_client_cents', to_jsonb(2100)),
  ('product_manager_base_monthly_cents', to_jsonb(400000)),
  ('software_monthly_cents', to_jsonb(150000))
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_accountant_client_periods_period
  ON accountant_client_periods (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_accountant_manual_obligations_due_date
  ON accountant_manual_obligations (due_date, status);
