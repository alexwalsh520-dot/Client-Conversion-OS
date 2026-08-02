-- 067_registry_seed.sql
-- TRUTH LAYER, Brick 1 (4 of 4): the SEED.
--
-- Entity and definition seeds live in functions so they can be re-run at any
-- time (scripts/seed-registries.mjs) without re-running DDL. Every seed is an
-- upsert by primary key: re-running is a no-op, never a duplicate.
--
-- EVIDENCE DISCIPLINE: every alias below was read out of the live data or the
-- code that writes it. Sources, per alias system:
--   dm_capture       dm_conversation_messages.client
--   warehouse        client_key in ads_meta_insights_daily / ads_keyword_events / adsv2_dm_facts
--   manychat_account substring of sales_tracker_rows.manychat_link
--   tracker_offer    sales_tracker_rows.offer  (verbatim, misspellings included)
--   meta_ad_account  ads_meta_insights_daily.ad_account_id
--   ig_scoped_id     the constant party id in dm_conversation_messages.raw_payload
--   match_token      src/lib/creators.ts matchTokens
--   tracker_person   sales_tracker_rows.closer / .setter
--   dm_setter        setter_name in ads_keyword_events / adsv2_dm_facts / dm_conversation_messages
--   keychain_token   macOS Keychain entry name (operational, not in-DB)
--
-- Where no key could be found, the alias is simply absent and a note says so.
-- Nothing here is guessed.
--
-- Idempotent: safe to run twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.registry_seed_entities()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_signer     CONSTANT TEXT  := 'Alex Walsh (definitions signoff v3, relayed via Fable)';
  v_signed_at  CONSTANT TIMESTAMPTZ := '2026-08-02'::TIMESTAMPTZ;
  -- One price book across creators (signed: pricing_currency).
  v_prices     CONSTANT JSONB := '{"3mo": 120000, "6mo_standard": 240000, "6mo_frequent_close": 220000}'::JSONB;
  v_econ       CONSTANT JSONB := '{"closer_pct": 10, "setter_pct_min": 3, "setter_pct_max": 5, "will_override_pct": 2.5, "coaching_cost_per_month_cents": 3000, "breakeven_croas": 1.35, "ltgp_cac_target": 9, "ltgp_cac_floor": 3}'::JSONB;
  v_count      INT;
  v_dupe       TEXT;
BEGIN
  INSERT INTO public.registry_entities AS e
    (canonical_key, display_name, kind, status, status_since, aliases, currency,
     price_book, economics, notes, signed_by, signed_at)
  VALUES
  -- ── CREATORS ──────────────────────────────────────────────────────────
  ('tyson', 'Tyson Sonnek', 'creator', 'active', NULL,
   '[{"system":"dm_capture","value":"tyson_sonnek"},
      {"system":"warehouse","value":"tyson"},
      {"system":"manychat_account","value":"fb1024471"},
      {"system":"tracker_offer","value":"Tyson Sonnek"},
      {"system":"meta_ad_account","value":"act_176726311"},
      {"system":"ig_scoped_id","value":"17841400987609293"},
      {"system":"keychain_token","value":"tyson-meta-token"},
      {"system":"match_token","value":"sonnek"},
      {"system":"match_token","value":"(ts)"}]'::JSONB,
   '{"ad_account": "USD", "revenue": "USD"}'::JSONB, v_prices, v_econ,
   'Active creator. Program = The Forge. 417 tracker rows carry manychat_link fb1024471; one outlier row carries fb3858284 (single row, not adopted as an alias).',
   v_signer, v_signed_at),

  ('jake', 'Jake Divljak', 'creator', 'active', '2026-07-29',
   '[{"system":"dm_capture","value":"jake_divljak"},
      {"system":"warehouse","value":"jake"},
      {"system":"manychat_account","value":"fb107310014324540"},
      {"system":"tracker_offer","value":"Jake Divijak"},
      {"system":"meta_ad_account","value":"act_304988118349730"},
      {"system":"ig_scoped_id","value":"17841435534052839"},
      {"system":"keychain_token","value":"jake-meta-token"},
      {"system":"match_token","value":"divljak"},
      {"system":"match_token","value":"recruit ready"},
      {"system":"match_token","value":"recruitready"},
      {"system":"match_token","value":"rrf"}]'::JSONB,
   '{"ad_account": "AUD", "revenue": "USD"}'::JSONB, v_prices, v_econ,
   'Active creator (RecruitReady Fitness, RRF V2). Ad account bills AUD, revenue reports USD. NOTE: the sales tracker spells the offer "Jake Divijak" (missing the l) - the misspelling is recorded verbatim as the alias because it is what the source actually contains. This is exactly the jake vs jake_divljak class of break the registry exists to fix.',
   v_signer, v_signed_at),

  ('antwan', 'Antwan Rarcus', 'creator', 'former', '2026-07-21',
   '[{"system":"dm_capture","value":"antwan_rarcus"},
      {"system":"warehouse","value":"antwan"},
      {"system":"manychat_account","value":"fb1409488"},
      {"system":"tracker_offer","value":"Antwan Rarcus"},
      {"system":"meta_ad_account","value":"act_275999723846625"},
      {"system":"ig_scoped_id","value":"17841401520122483"},
      {"system":"match_token","value":"rarcus"},
      {"system":"match_token","value":"against all odds"},
      {"system":"match_token","value":"(ar)"}]'::JSONB,
   '{"ad_account": "USD", "revenue": "USD"}'::JSONB, NULL, NULL,
   'FORMER creator. Campaign paused mid-July; ad insights stop 2026-07-16 and the account has zero ACTIVE ad rows. Trailing sales label as former_creator_ad.',
   v_signer, v_signed_at),

  ('keith', 'Keith Holland', 'creator', 'former', '2026-06-06',
   '[{"system":"dm_capture","value":"keith_holland"},
      {"system":"warehouse","value":"keith"},
      {"system":"manychat_account","value":"fb2658494"},
      {"system":"tracker_offer","value":"Keith Holland"},
      {"system":"meta_ad_account","value":"act_861990450801193"},
      {"system":"match_token","value":"holland"},
      {"system":"match_token","value":"(kh)"}]'::JSONB,
   '{"ad_account": "USD", "revenue": "USD"}'::JSONB, NULL, NULL,
   'FORMER creator. Ad insights stop 2026-06-05. No ig_scoped_id: his dm_conversation_messages rows carry no sender/recipient ids, so none was recorded rather than guessed.',
   v_signer, v_signed_at),

  -- Lucy is NOT on the signoff sheet's creator list, but her key is live in
  -- the data (191 insight rows, 47 keyword events, 4 tracker rows). She is
  -- registered as former so that every client_key in every source resolves.
  -- Standing note in project memory says "Lucy = NOT a client"; the data says
  -- her key exists. Both facts are recorded here rather than reconciled
  -- silently. Flagged for the owner.
  ('lucy', 'Lucy Hubbard', 'creator', 'former', '2026-06-09',
   '[{"system":"warehouse","value":"lucy"},
      {"system":"manychat_account","value":"fb4608469"},
      {"system":"tracker_offer","value":"Lucy Hubbard"},
      {"system":"meta_ad_account","value":"act_616852470282141"},
      {"system":"match_token","value":"hubbard"},
      {"system":"match_token","value":"(lh)"}]'::JSONB,
   '{"ad_account": "USD", "revenue": "USD"}'::JSONB, NULL, NULL,
   'FORMER. NEEDS OWNER CONFIRM: project memory records "Lucy = NOT a client", but client_key lucy is present in ads_meta_insights_daily (191 rows, through 2026-06-09), ads_keyword_events (47) and the tracker offer "Lucy Hubbard" (4 rows). Registered as former so enumeration sweeps resolve; her status label is the owner call. No dm_capture key exists for her.',
   v_signer, v_signed_at),

  -- The tracker records Zoe and Emily JOINTLY as one offer string. No
  -- per-person key exists in any system. Two entities both claiming the same
  -- alias would make resolution ambiguous, so they are registered as the one
  -- entity the data actually contains.
  ('zoe_and_emily', 'Zoe and Emily', 'creator', 'former', NULL,
   '[{"system":"tracker_offer","value":"Zoe and Emily"}]'::JSONB,
   NULL, NULL, NULL,
   'FORMER. The only evidence is a single JOINT tracker offer string "Zoe and Emily" (22 rows). No separate zoe / emily key exists in dm capture, insights, keyword events or ad accounts, so no per-person rows were invented. Split into two entities only if the owner supplies distinct keys.',
   v_signer, v_signed_at),

  -- ── CLOSERS ───────────────────────────────────────────────────────────
  ('closer_broz', 'BROZ', 'closer', 'active', NULL,
   '[{"system":"tracker_person","value":"BROZ"}]'::JSONB, NULL, NULL, NULL,
   '369 tracker rows.', v_signer, v_signed_at),
  ('closer_will', 'WILL', 'closer', 'active', NULL,
   '[{"system":"tracker_person","value":"WILL"}]'::JSONB, NULL, NULL, NULL,
   '350 tracker rows. Carries the 2.5% override in unit economics.', v_signer, v_signed_at),
  ('closer_austin', 'AUSTIN', 'closer', 'active', NULL,
   '[{"system":"tracker_person","value":"AUSTIN"}]'::JSONB, NULL, NULL, NULL,
   '224 tracker rows.', v_signer, v_signed_at),
  ('closer_chris', 'CHRIS', 'closer', 'active', NULL,
   '[{"system":"tracker_person","value":"CHRIS"}]'::JSONB, NULL, NULL, NULL,
   '26 tracker rows.', v_signer, v_signed_at),
  ('closer_wobbe', 'WOBBE', 'closer', 'active', NULL,
   '[{"system":"tracker_person","value":"WOBBE"}]'::JSONB, NULL, NULL, NULL,
   '68 tracker rows.', v_signer, v_signed_at),
  ('closer_aaron', 'AARON', 'closer', 'active', NULL,
   '[]'::JSONB, NULL, NULL, NULL,
   'ON THE SIGNED ROSTER BUT ABSENT FROM THE DATA: a full DISTINCT sweep of sales_tracker_rows.closer returns zero AARON rows. Registered with EMPTY aliases rather than a guessed spelling. Needs the owner to supply the exact tracker string, or to confirm Aaron has not closed since the tracker began.',
   v_signer, v_signed_at),

  -- ── SETTERS ───────────────────────────────────────────────────────────
  -- Each setter also appears in the CLOSER column in uppercase. One person,
  -- one canonical key: the uppercase closer spelling resolves to the same
  -- person. `kind` records their signed primary role, not their only role.
  ('setter_amara', 'Amara', 'setter', 'active', NULL,
   '[{"system":"tracker_person","value":"Amara"},
      {"system":"dm_setter","value":"amara"},
      {"system":"manychat_tag","value":"setter_amara"}]'::JSONB,
   NULL, NULL, NULL,
   '654 tracker setter rows, 4,099 keyword events. DUAL ROLE: also appears as closer "AMARA" on 68 tracker rows.',
   v_signer, v_signed_at),
  ('setter_erin', 'Erin', 'setter', 'active', NULL,
   '[{"system":"tracker_person","value":"Erin"},
      {"system":"dm_setter","value":"erin"},
      {"system":"manychat_tag","value":"setter_erin"}]'::JSONB,
   NULL, NULL, NULL,
   '92 tracker setter rows, 939 keyword events. DUAL ROLE: also closer "ERIN" on 4 rows.',
   v_signer, v_signed_at),
  ('setter_debbie', 'Debbie', 'setter', 'active', NULL,
   '[{"system":"tracker_person","value":"Debbie"},
      {"system":"dm_setter","value":"debbie"},
      {"system":"manychat_tag","value":"setter_debbie"}]'::JSONB,
   NULL, NULL, NULL,
   '114 tracker setter rows, 738 keyword events. DUAL ROLE: also closer "DEBBIE" on 12 rows.',
   v_signer, v_signed_at),
  ('setter_gideon', 'Gideon', 'setter', 'active', NULL,
   '[{"system":"tracker_person","value":"Gideon"},
      {"system":"dm_setter","value":"gideon"},
      {"system":"manychat_tag","value":"setter_gideon"}]'::JSONB,
   NULL, NULL, NULL,
   '110 tracker setter rows, 1,597 keyword events. The original miss that motivated this registry: a sampled query omitted Gideon from a roster answer. DUAL ROLE: also closer "GIDEON" on 7 rows.',
   v_signer, v_signed_at),
  ('setter_kelechi', 'Kelechi', 'setter', 'active', NULL,
   '[{"system":"tracker_person","value":"Kelechi"},
      {"system":"dm_setter","value":"kelechi"},
      {"system":"manychat_tag","value":"setter_kelechi"}]'::JSONB,
   NULL, NULL, NULL,
   'PENDING OWNER CONFIRM (signoff 5b, 2026-08-02): surfaced by the full-source sweep, not on the originally recalled roster. 161 tracker setter rows, 397 keyword events. DUAL ROLE: also closer "KELECHI" on 19 rows. Confirm current vs former.',
   v_signer, v_signed_at),

  -- Matthew Conder: the signoff sheet guessed "creator, former". The data
  -- disagrees and the data wins. See notes.
  ('setter_matthew_conder', 'Matthew Conder', 'setter', 'former', NULL,
   '[{"system":"dm_capture","value":"matthew_conder"},
      {"system":"dm_setter","value":"Matthew Conder"}]'::JSONB,
   NULL, NULL, NULL,
   'CORRECTED FROM THE SIGNOFF SHEET ON EVIDENCE. The sheet listed matthew_conder as a former CREATOR. He is not: all 14 dm_conversation_messages rows keyed client=matthew_conder carry Tyson''s IG id (17841400987609293) or Antwan''s (17841401520122483) as the account party, and the same rows carry setter_name="Matthew Conder". So those are Tyson/Antwan conversations that a setter''s name was mis-written into the client column. He has no ad account, no ManyChat account, no tracker offer. Registered as a former SETTER. Needs owner confirm, and the 14 mis-keyed rows are a data-quality item logged for later (not touched here).',
   v_signer, v_signed_at)

  ON CONFLICT (canonical_key) DO UPDATE
    SET display_name       = EXCLUDED.display_name,
        kind               = EXCLUDED.kind,
        status             = EXCLUDED.status,
        status_since       = EXCLUDED.status_since,
        aliases            = EXCLUDED.aliases,
        currency           = EXCLUDED.currency,
        price_book         = EXCLUDED.price_book,
        economics          = EXCLUDED.economics,
        pixel_status       = EXCLUDED.pixel_status,
        conversion_source  = EXCLUDED.conversion_source,
        attribution_source = EXCLUDED.attribution_source,
        notes              = EXCLUDED.notes,
        signed_by          = EXCLUDED.signed_by,
        signed_at          = EXCLUDED.signed_at,
        updated_at         = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- INTEGRITY GUARD: resolution must be deterministic. If one alias value ever
  -- maps to two entities, the resolver would silently pick one - the exact
  -- failure mode this brick exists to eliminate. Fail the seed instead.
  SELECT STRING_AGG(alias_value || ' -> ' || keys, '; ')
    INTO v_dupe
    FROM (
      SELECT alias_value, STRING_AGG(canonical_key, ', ' ORDER BY canonical_key) AS keys
        FROM public.registry_entity_alias_index
       GROUP BY alias_value
      HAVING COUNT(DISTINCT canonical_key) > 1
    ) d;

  IF v_dupe IS NOT NULL THEN
    RAISE EXCEPTION 'Ambiguous alias(es) would break entity resolution: %', v_dupe;
  END IF;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.registry_seed_entities() IS
  'Re-runnable owner-signed entity seed (upsert by canonical_key). Raises if any alias value maps to more than one entity.';

REVOKE ALL ON FUNCTION public.registry_seed_entities() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_seed_entities() TO service_role;

-- ── Definitions ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registry_seed_definitions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_signer    CONSTANT TEXT := 'Alex Walsh (definitions signoff v3, relayed via Fable)';
  v_signed_at CONSTANT DATE := '2026-08-02';
  v_count     INT;
BEGIN
  INSERT INTO public.registry_definitions AS d
    (name, version, statement, details, signed_by, signed_at, status)
  VALUES

  -- ── Group A: what counts as money ──────────────────────────────────────
  ('win_definition', 1,
   'A win = a sales tracker row with outcome WIN. PCFU is the closers'' follow-up-pending bucket: when a PCFU person later closes, the closer logs a NEW row with outcome WIN, so counting PCFU rows as wins would double-count those people. Cash on ANY row always counts in collected. Cash-bearing PCFU rows surface in answers as "deposits pending close" so they are visible, never lost.',
   '{"win_outcome": "WIN", "pcfu_counts_as_win": false, "cash_counts_on_any_row": true, "surface_cash_pcfu_as": "deposits pending close", "evidence": {"pcfu_rows_since_2026_06_01": 80, "pcfu_rows_with_cash": 1, "verified_examples": ["Will Lindsey PCFU 6/30 then WIN 7/10", "Milton Mancia-Lemus PCFU 5/28 then WIN 6/3", "Marc Crowder PCFU 5/25 then WIN 6/10"]}}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('collected_vs_contracted', 1,
   'Collected = money actually received; decisions ride on this. Contracted = deal size. The two are never mixed in one metric.',
   '{"decision_metric": "collected", "never_mix": true}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('pricing_currency', 1,
   'One price book across creators: 3-month $1,200; 6-month standard $2,400 with frequent $2,200 closes (closer-level flexibility; the tracker is the record). Revenue reports in USD. Jake''s ad account bills in AUD; spend converts at the synced fx rate. Non-USD sale rows convert at sale-date fx.',
   '{"price_book_cents": {"3mo": 120000, "6mo_standard": 240000, "6mo_frequent_close": 220000}, "revenue_currency": "USD", "aud_ad_accounts": ["jake"], "spend_fx": "synced rate", "sale_fx": "sale-date rate"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('unit_economics', 1,
   'gross_profit_pre_adspend = collected minus closer 10% minus setter 3-5% minus Will override 2.5% minus coaching $30 x months (about 74% margin at close). Breakeven collected ROAS about 1.35. LTGP:CAC 9:1 target, 3:1 floor.',
   '{"closer_pct": 10, "setter_pct_min": 3, "setter_pct_max": 5, "will_override_pct": 2.5, "coaching_cost_per_month_cents": 3000, "approx_margin_at_close_pct": 74, "breakeven_collected_roas": 1.35, "ltgp_cac_target": 9, "ltgp_cac_floor": 3, "pinned_for_later": "true-cost categorization via bank-accounts MCP (auto-tagging spend like marketing software into CAC)"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('closer_roster', 1,
   'The closer roster is BROZ, WILL, AUSTIN, CHRIS, WOBBE, AARON.',
   '{"closers": ["BROZ", "WILL", "AUSTIN", "CHRIS", "WOBBE", "AARON"], "data_check_2026_08_02": {"present_in_tracker": ["BROZ", "WILL", "AUSTIN", "CHRIS", "WOBBE"], "absent_from_tracker": ["AARON"], "note": "Setters Amara, Kelechi, Debbie, Gideon and Erin also appear in the closer column in uppercase."}}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('setter_roster', 1,
   'The setter roster is Amara, Erin, Debbie, Gideon, and Kelechi (Kelechi pending owner confirm). The non-person tracker labels "Other" and "Phone Setter 1" map to no setter and must resolve to NULL. Roster and enumeration answers require a DISTINCT sweep of every source system, never a sample; rosters live in the registry from now on.',
   '{"setters": ["Amara", "Erin", "Debbie", "Gideon", "Kelechi"], "pending_confirm": ["Kelechi"], "non_person_labels": ["Other", "Phone Setter 1"], "enumeration_rule": "full DISTINCT sweep of every source, never a sample", "evidence": {"kelechi": {"keyword_events": 397, "tracker_rows": 161}}}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  -- ── Group B: attribution ───────────────────────────────────────────────
  ('attribution_floor', 1,
   'The attribution floor is 2026-05-22. No revenue calculation touches earlier dates.',
   '{"floor_date": "2026-05-22"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('sale_to_ad_chain', 1,
   'Sale-to-ad resolution order: ManyChat subscriber id, then UTM keyword on the booking link, then normalized-name match, then human resolution. "Human resolution" means a recorded entry in the Attribution Workspace store (who decided, when, why; stored in adsv2_sale_resolutions; survives every resync; outranks machine guesses). It is NOT closers typing in the tracker. Meta supplies SPEND ONLY; Meta message and lead counts are never used because they inflate 2.4-3x.',
   '{"order": ["manychat_subscriber_id", "utm_keyword_on_booking_link", "normalized_name_match", "human_resolution"], "human_resolution_store": "adsv2_sale_resolutions", "human_resolution_outranks_machine": true, "meta_supplies": ["spend"], "meta_never_used": ["messaging_conversations_started", "lead_counts"], "meta_inflation_factor": "2.4-3x"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('certainty_buckets', 1,
   'Four buckets. AD: machine-stamped keyword (custom field or UTM) or human-resolved to an ad. ORGANIC: a marked organic keyword (registry) or human-resolved organic. MISC CHAT: the team''s own label (sheet field callType = "Miscellaneous Chat") where the keyword is unknown and ad-vs-organic is not determinable in ManyChat; this is a legitimate CLASSIFIED bucket, not dark data, and the team deliberately does not chase it. AWAITING REVIEW: nobody has looked yet, and it is the only bucket that counts as a gap.',
   '{"buckets": ["AD", "ORGANIC", "MISC_CHAT", "AWAITING_REVIEW"], "gap_bucket": "AWAITING_REVIEW", "misc_chat_source_field": "callType = Miscellaneous Chat", "misc_chat_is_classified": true, "known_caveat": "broken organic-keyword automations have mislabeled some real keyword leads as misc chat; capture_health (Q7) watches for keyword-recoverable misc chats"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('coverage', 1,
   'Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.',
   '{"classified_buckets": ["AD", "ORGANIC", "MISC_CHAT"], "gap_bucket": "AWAITING_REVIEW", "measured_on": ["wins", "cash"], "receipt_must_carry_all_four": true}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('organic_keywords', 1,
   'Organic keywords are a marked list (today: LOCKED and INTERESTED for Tyson, READY for Jake, FREEDOM for Antwan-legacy). Paid use takes precedence while an ad is live; there is a 30-day cooldown before a keyword may be reused organically. Organic sales never enter ad ROAS.',
   '{"marked": [{"client": "tyson", "keywords": ["locked", "interested"]}, {"client": "jake", "keywords": ["ready"]}, {"client": "antwan", "keywords": ["freedom"], "note": "legacy"}], "paid_takes_precedence_while_live": true, "organic_reuse_cooldown_days": 30, "organic_sales_in_ad_roas": false}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('former_creators', 1,
   'Antwan, Keith, Zoe and Emily are former creators. Their trailing sales are labeled former_creator_ad and never counted for or against active ads. The active roster is Tyson and Jake.',
   '{"former": ["antwan", "keith", "zoe_and_emily"], "active": ["tyson", "jake"], "trailing_sale_label": "former_creator_ad", "counts_toward_active_ads": false, "registry_note": "lucy is also registered former; her client_key is live in the data though standing memory says she was never a client. Owner confirm pending."}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  -- ── Group C: windows and time ──────────────────────────────────────────
  ('decision_cadence', 1,
   'Watch daily, decide weekly on a trailing 14 days. Daily watch-mode output is FLAGS ONLY, formatted with no imperative verbs: observation + magnitude + duration + "monitor" or "queued for weekly decide". Never "reduce budget", never "pause". The flag is data; the prescription belongs to decide mode only.',
   '{"watch": "daily", "decide": "weekly", "decide_window_days": 14, "watch_output": "flags only", "watch_forbidden_verbs": ["reduce", "pause", "kill", "scale", "increase"], "watch_allowed_closers": ["monitor", "queued for weekly decide"]}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('roi_window', 1,
   'ROI is 30-day spend against 30-day cash, using the same window on both sides, always.',
   '{"window_days": 30, "same_window_both_sides": true}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('level_vs_trend', 1,
   'Any pace or per-month claim must include the actual calendar month (month-to-date plus prior month) AND the weekly trend shape. A trailing window alone is never a level claim.',
   '{"level_requires": ["calendar_mtd", "prior_month"], "trend_requires": "weekly shape", "trailing_window_alone_is_level_claim": false}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('daily_run_rate', 1,
   'Daily run rate is last-7-day pace, or spend divided by the days actually run. Never a calendar-30 average.',
   '{"basis": "last_7_days_or_days_actually_run", "calendar_30_average_allowed": false}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('sales_lag', 1,
   'Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.',
   '{"median_days": 2, "p90_days": 13, "lag_behind_spend_days": [5, 14], "recent_window_carries_caveat": true, "recent_dip_is_kill_trigger": false}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('touch_floor_72h', 1,
   'No budget change, creative swap, or pause may act on a signal younger than 72 hours sustained. Two hours of bad data is not fatigue; one bad day is not fatigue. The sole exception is technical health failure (campaign stuck in review, rejected, restricted, or delivery dead), which is acted on immediately because it is breakage, not a performance signal.',
   '{"min_signal_age_hours": 72, "applies_to": ["budget_change", "creative_swap", "pause"], "exception": "technical health failure", "exception_examples": ["stuck in review", "rejected", "restricted", "delivery dead"]}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('learning_phase_awareness', 1,
   'Receipts note Meta learning status where the API exposes it, and no verdict lands before 7 days at meaningful spend. For messaging-optimized campaigns the algorithmic signal comes from Meta''s NATIVE MESSAGING CONVERSATION event rather than pixel fires, so learning-phase indicators may not display at all and campaigns can perform without ever showing learning-exit. The 50-conversions-per-week exit threshold therefore does not apply the same way and is recorded as context only. The 7-14 day observation window gates verdicts regardless of what the UI indicator shows.',
   '{"min_days_before_verdict": 7, "observation_window_days": [7, 14], "signal_source": "native_messaging_conversation_event", "pixel_based_learning_applies": false, "meta_50_per_week_threshold": "recorded as context only, not adopted"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  -- ── Group D: decision rules ────────────────────────────────────────────
  ('verdict_floors_kill_tree', 1,
   'Evidence floor, per ad: no verdict of any kind under $100 total spend on that ad. A KILL verdict additionally requires spend sufficient that about 3 bookings were EXPECTED at the target cost-per-call. Below floor the verdict is "too-early" or "starved-untested", never "failed". The per-day-per-campaign framing is rejected because our test sets run many ads sharing one budget, so the floor binds per-ad on TOTAL spend against expected conversions. "Unfixable" is enumerated as a kill tree: sub-2x WITH fatigue signals (2x+ historically, cost per call rising, CTR falling) is FIXABLE via relaunch or refresh, not a kill; sub-2x with fresh creative already tested and KPIs still broken is a KILL; never reached 2x at adequate spend is a KILL; KPIs fine but leads do not show or close is a lead-quality KILL (kill and relaunch proven winners). No naked "unfixable" judgment calls.',
   '{"evidence_floor_cents": 10000, "floor_basis": "per ad, total spend", "kill_requires_expected_bookings": 3, "below_floor_verdicts": ["too-early", "starved-untested"], "rejected_framing": "$100/day per campaign", "kill_tree": [{"condition": "sub-2x with fatigue signals", "verdict": "fixable", "path": "relaunch or refresh"}, {"condition": "sub-2x with fresh creative tested and KPIs still broken", "verdict": "kill"}, {"condition": "never reached 2x at adequate spend", "verdict": "kill"}, {"condition": "KPIs fine but leads do not show or close", "verdict": "kill", "path": "lead-quality kill, relaunch proven winners"}], "example_passing_kill": "2026-07-31 Direct CTA kill: $1,200+ roster spend vs $270/call target with 1 booking"}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('scaling_ladder', 1,
   'Launch at $50/day. Steps are WEEKLY, never daily and never reactive mid-week (the June over-scale that crushed book rate is our own evidence). The bottom of the ladder doubles by necessity: $50 to $100, then $100 to $200, because meaningful data needs meaningful steps. Above about $200/day, steps are +20-33% weekly. At 2x or better cash ROI, budget is a floor and not a cap. Respect proven per-ad-set saturation ceilings.',
   '{"launch_daily_cents": 5000, "step_cadence": "weekly", "reactive_midweek_allowed": false, "bottom_ladder_cents": [5000, 10000, 20000], "above_threshold_cents": 20000, "above_threshold_step_pct": [20, 33], "budget_is_floor_at_cash_roi": 2, "respect_saturation_ceilings": true, "evidence": {"june_over_scale": "12 sets / $1200 crushed book rate", "fit_ceiling_daily_cents": 14000}}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('structure_rules', 1,
   'Group by adset_id and ad_id, never by names. Active means status ACTIVE with recent spend. Paused history is excluded from live decisions unless history is explicitly asked for.',
   '{"group_by": ["adset_id", "ad_id"], "group_by_names": false, "active_means": "status ACTIVE with recent spend", "paused_history_in_live_decisions": false}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  -- ── Group E: identity ──────────────────────────────────────────────────
  ('entity_keys', 1,
   'One canonical key per creator with every alias mapped (jake = jake_divljak, page ids, IG handles, ad accounts, token names). Entity resolution outside the registry is uncertified by definition. Per-client capability fields: pixel_status (none or active), conversion_source (native_messaging_event or pixel), attribution_source (warehouse_only or pixel_assisted). Today every client is none / native_messaging_event / warehouse_only. Any certified question depending on pixel events or value-based optimization carries a conditional path that only fires when pixel_status = active, so a future pixel needs zero restructure.',
   '{"registry_table": "registry_entities", "resolver": "registry_resolve_entity", "resolution_outside_registry": "uncertified", "capability_defaults": {"pixel_status": "none", "conversion_source": "native_messaging_event", "attribution_source": "warehouse_only"}, "pixel_conditional_paths": true}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('person_identity', 1,
   'One person, one spine: ManyChat id, IG-scoped id, GHL contact and tracker spellings are all bridged. A zero-row join across id systems is never evidence of absence.',
   '{"id_systems": ["manychat_id", "ig_scoped_id", "ghl_contact", "tracker_spelling"], "zero_row_join_means_absence": false}'::JSONB,
   v_signer, v_signed_at, 'signed'),

  ('keyword_uniqueness', 1,
   'Ad keywords are all-time-unique across ALL clients, enforced as a constraint. Keywords must be simple, positive and aspirational, and Alex approves them before build.',
   '{"scope": "all clients, all time", "enforced_as": "database constraint", "style": ["simple", "positive", "aspirational"], "owner_approves_before_build": true, "enforcement_status_2026_08_02": "BLOCKED - 9 historical active collisions; fallback index unique(keyword_normalized, client_key) is live. Run registry_enforce_keyword_uniqueness() to arm the full law once resolved.", "collisions": ["bold", "boost", "course", "flex", "fuel", "lift", "spark", "thrive", "vital"]}'::JSONB,
   v_signer, v_signed_at, 'signed')

  ON CONFLICT (name, version) DO UPDATE
    SET statement  = EXCLUDED.statement,
        details    = EXCLUDED.details,
        signed_by  = EXCLUDED.signed_by,
        signed_at  = EXCLUDED.signed_at,
        status     = EXCLUDED.status,
        updated_at = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.registry_seed_definitions() IS
  'Re-runnable owner-signed definition seed (upsert by name+version), transcribed from the Brick 1 definitions signoff sheet v3 (2026-08-02).';

REVOKE ALL ON FUNCTION public.registry_seed_definitions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_seed_definitions() TO service_role;

-- Run the seeds now. Entities first: registry_keywords.client_key references them.
SELECT public.registry_seed_entities();
SELECT public.registry_seed_definitions();
SELECT * FROM public.registry_reseed_keywords();

COMMIT;
