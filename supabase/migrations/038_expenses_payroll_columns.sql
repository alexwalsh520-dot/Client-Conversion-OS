-- 038_expenses_payroll_columns.sql
-- Add payroll workflow columns to the Monthly Expenses table.
--
-- Context: Alex (CEO) wants to use the Expenses tab as a single-pane
-- payroll workflow. Each row is a team member to pay this month;
-- columns now answer "how much, how, how often, paid yet?" in one
-- glance.
--
-- New columns:
--   paid             — has this expense been paid out yet?
--   payment_via      — Upwork vs Direct (free-form text)
--   payment_cadence  — Monthly / Twice Monthly / Weekly / Biweekly etc
--
-- A computed "Total Owed" column (base + commissions) is rendered
-- client-side; no DB column needed for it.

BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_via TEXT,
  ADD COLUMN IF NOT EXISTS payment_cadence TEXT;

COMMENT ON COLUMN public.expenses.paid IS
  'Has this expense been paid out for the month? Toggled inline from the Monthly Expenses table.';
COMMENT ON COLUMN public.expenses.payment_via IS
  'How the team member receives payment: typically "Upwork" or "Direct" (bank transfer / wire). Free-form text.';
COMMENT ON COLUMN public.expenses.payment_cadence IS
  'How often the team member is paid: e.g. "Monthly", "Twice Monthly", "Weekly", "Biweekly". Free-form text.';

COMMIT;
