-- 076_registry_ruleset_zakk.sql
-- TRUTH LAYER, Brick 3: the FIRST NAMED RULESET.
--
-- Brick 3's architectural law, from the owner (Alex, 2026-08-05):
--   "I want to give this to Jeremy AI and let it make decisions differently
--    than I have... I want the decision rules to evolve."
--
-- So facts and judgment are separated. kill_scale_read's `facts` mode returns
-- the certified decision inputs with NO verdicts; `decide` mode applies a
-- NAMED, VERSIONED ruleset and labels every verdict with it. The facts are the
-- truth; a verdict is advice under a lens.
--
-- This registers the FIRST lens. ruleset_zakk v1 does not invent any rule: it
-- NAMES the already-signed definitions that together are Zakk's rules, and it
-- carries the few numbers the kill/scale read applies that were previously
-- written down only in prose (the protect and KPI-line ROI bands, the CAC
-- share of ticket, the close-rate basis). Registering them here is what makes
-- Brick 3's threshold law enforceable: the verdict engine reads every number
-- it applies from this registry and hardcodes none of them, so a future
-- jeremy_v1 is a new signed row plus a branch keyed by ruleset name, never a
-- restructure.
--
-- Additive and idempotent: one INSERT ... ON CONFLICT DO NOTHING. No schema
-- change, no existing row touched, nothing dropped.

BEGIN;

DO $$
DECLARE
  v_signer TEXT := 'alex_walsh';
  v_signed_at DATE := DATE '2026-08-07';
BEGIN

  INSERT INTO public.registry_definitions
    (name, version, statement, details, signed_by, signed_at, status)
  VALUES

  ('ruleset_zakk', 1,
   'Ruleset zakk_v1 is the standing kill/scale lens: the already-signed verdict_floors_kill_tree, scaling_ladder, decision_cadence, daily_run_rate, touch_floor_72h, learning_phase_awareness, structure_rules, roi_window, sales_lag, unit_economics and pricing_currency, applied together. Under it: collected ROI at or above 3x is PROTECT; 2x to 3x is the KPI LINE; below 2x enters the signed kill tree. The CAC target is 20% of the standard ticket (the 6-month standard price), and the target cost per booked call is that CAC target multiplied by the creator''s trailing 90-day close rate, computed over at least 20 taken calls or else falling back to the account-wide rate and saying so. "About 3 expected bookings" in verdict_floors_kill_tree is read as the nearest whole number, which is what makes a $685 ad at a $270 target cost per call kill-eligible rather than starved. A verdict under this ruleset is ADVICE UNDER A LENS and never the truth; the facts are the truth, and facts mode returns them with no verdict at all.',
   '{
      "ruleset_key": "zakk_v1",
      "components": [
        "verdict_floors_kill_tree",
        "scaling_ladder",
        "decision_cadence",
        "daily_run_rate",
        "touch_floor_72h",
        "learning_phase_awareness",
        "structure_rules",
        "roi_window",
        "sales_lag",
        "unit_economics",
        "pricing_currency"
      ],
      "protect_min_collected_roi": 3,
      "kpi_line_min_collected_roi": 2,
      "cac_pct_of_ticket": 20,
      "standard_ticket_price_book_key": "6mo_standard",
      "expected_bookings_rounding": "nearest",
      "close_rate_trailing_days": 90,
      "close_rate_min_taken_calls": 20,
      "cost_per_dm_baseline_days": 28,
      "cost_per_dm_flag_multiple": 2,
      "spend_pace_flag_pct": 25,
      "verdict_is_advice_not_truth": true,
      "evidence": {
        "hand_verified_session": "2026-07-31 kill review",
        "cost_per_call_target_check": "20% of $2,400 = $480 CAC target; $480 x tyson trailing-90d close rate 0.5563 = $267, which is the $270 target the 2026-07-31 session used by hand",
        "direct_cta_kill": "$1,204 spend / $270 target = 4.5 expected bookings, 1 actual, 0 closes, no 2x history -> kill"
      }
    }'::JSONB,
   v_signer, v_signed_at, 'signed')

  ON CONFLICT (name, version) DO NOTHING;

END $$;

COMMIT;
