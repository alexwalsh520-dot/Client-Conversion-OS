-- retention_cycles: allow 'retained_manual' outcome
--
-- MAS 2026-09-17: coaches need an "add manual increase" button on the V3
-- Retentions tab for cases the 4wk / 12wk presets don't cover (partial
-- extensions, comps, edge-case retentions). The action stamps
-- outcome='retained_manual' once the pushed end_date clears the 14-day
-- window; before that the cycle stays open, same as the existing +4/+12
-- flow.
--
-- The Conversion Rate KPI treats retained_manual as a retention (matches
-- retained_4wk / retained_12wk).

ALTER TABLE public.retention_cycles
  DROP CONSTRAINT IF EXISTS retention_cycles_outcome_check;

ALTER TABLE public.retention_cycles
  ADD CONSTRAINT retention_cycles_outcome_check
  CHECK (outcome IN (
    'opp_lost',
    'retained_4wk',
    'retained_12wk',
    'retained_manual',
    'left_window'
  ));
