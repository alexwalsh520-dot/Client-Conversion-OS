-- 025_app_settings_table.sql
-- Generic key-value table for editable app config that doesn't justify
-- a dedicated table. First use case: the per-client invoice/delivery rate
-- on the Expenses tab — historically hardcoded at $30, now editable
-- via the Coaching Hub UI. Same rate drives both the Invoice Calculation
-- math and the new Cash Reserve card.
--
-- Schema is intentionally minimal. If a setting needs structure, encode
-- it as JSON in `value` and parse server-side. If a setting needs history,
-- add a separate audit table — this one only tracks the current value.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO public.app_settings (key, value)
VALUES ('invoice_rate_per_client', '30')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_settings IS
  'Editable app-wide configuration values. Single row per key, current value only (no history). Add an audit trail table if a specific setting needs history.';

COMMENT ON COLUMN public.app_settings.value IS
  'Stored as TEXT. Numeric values are parsed at read time. Use JSON for structured values.';

COMMIT;
