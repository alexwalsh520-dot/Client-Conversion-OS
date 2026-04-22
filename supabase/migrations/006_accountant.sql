-- 006_accountant.sql
-- Tables for the Accountant tab: monthly financial reports + transaction categories.
-- Reads live from existing mozi_mercury_balances / mozi_mercury_transactions.

-- ============================================================
-- accountant_monthly_reports
-- One row per account per month. Generated on the 1st of each month.
-- ============================================================
CREATE TABLE IF NOT EXISTS accountant_monthly_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account         text NOT NULL,            -- 'coreshift' | 'forge' | 'combined'
  period_start    date NOT NULL,            -- first day of month
  period_end      date NOT NULL,            -- last day of month
  opening_balance int NOT NULL DEFAULT 0,   -- cents
  closing_balance int NOT NULL DEFAULT 0,   -- cents
  income          int NOT NULL DEFAULT 0,   -- cents (sum of positive tx)
  expenses        int NOT NULL DEFAULT 0,   -- cents (sum of abs(negative tx))
  net             int NOT NULL DEFAULT 0,   -- cents (income - expenses)
  tx_count        int NOT NULL DEFAULT 0,
  by_category     jsonb,                    -- { "category": { "income": int, "expenses": int, "count": int } }
  top_counterparties jsonb,                 -- [{ "counterparty": str, "amount": int, "count": int }]
  generated_at    timestamptz DEFAULT now(),
  UNIQUE (account, period_start)
);

-- ============================================================
-- accountant_categories
-- Simple keyword → category mapping for auto-categorizing transactions.
-- Matched against counterparty or description (case-insensitive, substring).
-- ============================================================
CREATE TABLE IF NOT EXISTS accountant_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword         text NOT NULL,
  category        text NOT NULL,
  kind            text CHECK (kind IN ('income', 'expense', 'transfer')) DEFAULT 'expense',
  created_at      timestamptz DEFAULT now(),
  UNIQUE (keyword)
);

-- Seed a few reasonable defaults (can be edited later via UI/SQL).
INSERT INTO accountant_categories (keyword, category, kind) VALUES
  ('stripe',          'Revenue',         'income'),
  ('whop',            'Revenue',         'income'),
  ('paypal',          'Revenue',         'income'),
  ('meta platforms',  'Ads - Meta',      'expense'),
  ('facebook',        'Ads - Meta',      'expense'),
  ('google ads',      'Ads - Google',    'expense'),
  ('tiktok',          'Ads - TikTok',    'expense'),
  ('openai',          'Software / AI',   'expense'),
  ('anthropic',       'Software / AI',   'expense'),
  ('vercel',          'Software / AI',   'expense'),
  ('supabase',        'Software / AI',   'expense'),
  ('gohighlevel',     'Software / AI',   'expense'),
  ('manychat',        'Software / AI',   'expense'),
  ('slack',           'Software / AI',   'expense'),
  ('google',          'Software / AI',   'expense'),
  ('notion',          'Software / AI',   'expense'),
  ('gusto',           'Payroll',         'expense'),
  ('rippling',        'Payroll',         'expense'),
  ('deel',            'Payroll',         'expense'),
  ('mercury',         'Bank / Fees',     'expense'),
  ('wire fee',        'Bank / Fees',     'expense'),
  ('transfer',        'Transfer',        'transfer'),
  ('owner draw',      'Owner Draw',      'expense'),
  ('matthew conder',  'Owner Draw',      'expense')
ON CONFLICT (keyword) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_accountant_monthly_account_period ON accountant_monthly_reports (account, period_start);
