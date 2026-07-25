# Warehouse Build 2 — audit handoff

Executed 2026-07-25 by Opus 5 from `CCOS-Build2-Opus-Prompt.md`.
Branch `warehouse-build2`, pushed fast-forward to `main` in five commits.
Blueprint: https://claude.ai/code/artifact/9a5d355b-8ecd-491d-b10b-24bf382012cc

---

## Migrations applied (in order)

| # | Name | Phase |
|---|------|-------|
| 1 | `warehouse_ad_changes` | 1 |
| 2 | `warehouse_ad_changes_ingest_rpc` | 1 |
| 3 | `warehouse_ad_changes_snapshot_diff` | 1 |
| 4 | `warehouse_ad_changes_levels_in_scope` | 1 (correction) |
| 5 | `adsv2_latest_budget_state_rpc` | 2 |
| 6 | `adsv2_facts_evidence_and_setter` | 3 |
| 7 | `adsv2_count_facts_missing_setter` | 3 |
| 8 | `adsv2_stamp_facts_setters` | 3 (correction) |
| 9 | `warehouse_people` | 4 |
| 10 | `warehouse_people_refresh` | 4 |
| 11 | `warehouse_ads` | 4 |
| 12 | `warehouse_ads_refresh` | 4 |
| 13 | `warehouse_people_normalise_client_key` | 4 (correction) |
| 14 | `warehouse_definitions` | 5 |
| 15 | `warehouse_people_refresh_faster` | 4 (correction) |

All new tables are REAL tables in `warehouse`, RLS enabled, no policies
(service-role and SECURITY DEFINER only). Every table and column carries a
plain-English `COMMENT` in the Build 1 style. **The `public` + `adsv2_` fallback
was not needed.**

## Files touched

| File | Change |
|------|--------|
| `src/lib/ads-v2/activity-sync.ts` | NEW — change-log mapper, forward capture, resumable backfill |
| `src/lib/ads-v2/activity-sync.test.ts` | NEW — 13 tests, pins Meta's legacy naming + both idempotency failure modes |
| `src/lib/ads-v2/warehouse-sync.ts` | NEW — refreshes people / ads / definitions |
| `src/app/api/cron/ads-v2-activity-backfill/route.ts` | NEW — one-time resumable history pull |
| `src/lib/ads-v2/sync.ts` | `runIsolatedStep` (own timeout + try/catch + alert); steps 6 and 7; `factsOnly` dry-run mode |
| `src/lib/ads-v2/budget-sync.ts` | active-daily / changed-only writing; reports seen vs written |
| `src/lib/ads-v2/facts.ts` | evidence stamps, blank reasons, setter stamping, bare-link recovery |
| `src/lib/ads-v2/attribution.ts` | `stampDm`, `stampBooking`, `stampSale` (pure, tested) |
| `src/lib/ads-v2/attribution.test.ts` | +14 tests for the stamping rules |
| `src/lib/ads-v2/selfcheck.ts` | two new nightly rules |
| `src/app/api/cron/ads-v2-sync/route.ts` | `?factsOnly=1` |

## Gate results

**Phase 1 — ad change log**
- 13,655 rows. Coverage: Tyson from **2024-09-30**, Jake from **2024-08-03**. Backfill ended on three consecutive empty windows; nothing exists earlier.
- Join: **3,504 / 3,504** ad-level and **327 / 327** adset-level changes that have results in `ads_meta_insights_daily` carry the parent ids. 7,487 changes are on ads that never spent in our records, so there is nothing to join to (honest blank, not a gap).
- Sample join proved on real money: FOCUS cut $115 → $50/day on 2026-06-23, average daily spend $103.36 → $57.17.
- Ground truth reproduced: campaign `52570597860064` "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)" created 2026-06-17 22:09:44 UTC by Tyson Sonnek, activated 22:23:30; FIT / FOCUS / HEALTHY each created at **11500 cents = $115.00/day**.
- Idempotency: re-fetched 4 held windows, **6,253 records read, 0 inserted**.

**Phase 2 — budget snapshots**
- Before: **370 rows written/day** (only 9–10 active). After: **9 written**, from 370 seen. Breakdown `{active: 9, changed: 0, firstSeen: 0}`.
- Nothing deleted or rewritten; all three prior days still hold their 370 rows.
- Reader `adsv2_budget_asof` uses `distinct on … order by et_day desc` (as-of semantics), so skipped identical repeats cannot change any answer.

**Phase 3 — airtight attribution (the money gate)**
- **100% explained: 0 rows with neither stamp nor reason** across dm 2,325 / booking 212 / sale 359 = 2,896 rows.
- **Dry run first**: `?factsOnly=1` rebuilt facts without bumping the version or precomputing. Money-bearing fingerprints **byte-identical**:
  - dm `35514184a3b8bdc08cfedd5a1f6ef06a` (2,325)
  - booking `c43a73d46efe1057aba5cbaaf20f77a4` (212)
  - sale `48537a37fda86f42ffb140d8e018c4b2` (359)
  - **Every delta: none.** Live snapshots were written only after this.
- Independent check: 30-day window recomputed from post-Phase-3 facts reproduced the pre-Phase-3 stored payload exactly for messages (1,364), taken (70), new clients (31), and **collected cash (3,793,000 cents)**.
- Bare-link recovery: **0 recovered**, not the ~6 the spec expected. See deviations.
- Setter coverage: dm **100%** (2,325/2,325), sale **100%** (359/359), booking **100% of matchable** (78/78); the other 134 bookings have no ManyChat match so no setter exists to copy. Source `ads_keyword_events` is 94.2%.
- Blank-reason distribution (the leak map): bookings 67 `no_utm_on_booking_link`, 31 `keyword_after_booking`, 1 `no_keyword_ever`; sales 135 `unknown`, 17 `no_keyword_ever`; dms 8 `unknown`.
- Both new nightly rules return **0**. Nightly self-check otherwise green (invariants 0, show-rate parity 0, parent/child 0, unmarked spend 0, cron violations 0).

**Phase 4 — merged tables**
- `warehouse.people` 31,784 rows. **Zero lost identities: 0 missing of 14,165 pairs** (manychat_contact_links 9,911; instagram_lead_links 1,764; dm_identity mc+ghl 1,245; dm_identity mc+ig 1,245).
- Conflicts flagged not resolved: **195 (0.61%)** — 189 duplicate GHL contacts, 6 claimed by two creators.
- `warehouse.ads` **1,923 = 1,923** vs `ad_creative_image`, zero in either direction. All 543 ads that ever spent carry copy, image words, and targeting.
- Spot checks pasted for 3 ads and 3 people; all complete, sources listed per row.

**Phase 5 — definitions**
- Registry `COLUMNS.length` = **21**; `warehouse.definitions` = **21**. Content spot-checked (spend, booked, showRate, collected) and matches the hover text verbatim.

## Faults caught by the build's own gates, and fixed

1. **Change-log fingerprint was unstable.** Hashing Meta's raw `extra_data` made re-fetches look new, because Meta re-signs CDN URLs (`oh=`, `oe=`, `_nc_gid`) and recomputes `last_learning_exit` between calls. A re-fetch added 712 rows we already had. Fixed by hashing only the stable payload (volatile keys dropped, URLs reduced to their path, keys sorted). Table emptied and rebuilt clean **with Alex's explicit approval** (see deviations). Two regression tests pin it.
2. **Setter lost to the rolling window.** The in-memory subscriber→setter lookup is built from keyword events inside the 45-day window, so someone who first messaged earlier and booked inside it had no setter. Caught by the new nightly rule on its first run (4 bookings). Fixed with a set-based DB stamp (`adsv2_stamp_facts_setters`) with no window.
3. **Identity conflicts over-flagged 22%.** The bridges spell the creator long (`tyson_sonnek`) while `person_context`/`dm_identity` spell it short (`tyson`), so one creator looked like two. Fixed with `warehouse_client_key()`; 7,118 → 195 real conflicts.
4. **People refresh timed out as the app.** A final `UPDATE` joining 31k×19k rows on array overlap ran fine by hand (admin role, no limit) and always exceeded the service role's 20s. Isolation held: the step was caught, logged to `adsv2_alerts`, and nothing the tab reads was affected. Fixed by folding setter/closer into the main aggregate and giving the function its own `statement_timeout`.

## Deviations from the spec

1. **Bare-link recovery found 0, not ~6.** The spec's rule ("exactly ONE keyword BEFORE the booking moment") was implemented exactly, using `created_time`. Measured alternatives on the same data: by booking **moment** 0; by created **day** 2; by call **day** 2; ignoring time entirely 32. Every candidate booked first and sent a keyword 34–222 hours later. The expected ~6 most likely came from a looser or wider-dated analysis. Reported rather than loosened — a looser rule would have credited 32 bookings to ads that did not earn them.
2. **ACCOUNT-level Meta activity is not ingested.** Initially included as a judgment call, then dropped: billing charges and image-library adds are not changes to an ad/adset/campaign, they are outside the spec's three levels, and their payloads are the unstable ones. Scope now matches the spec exactly.
3. **`warehouse.ad_changes` has 5 columns beyond the spec's list**: `change_uid` (idempotency), `old_budget_cents` / `new_budget_cents` / `currency` (so a budget question is one lookup instead of string parsing), `meta_event_type` (Meta's raw event name kept verbatim).
4. **Writes reach `warehouse` through SECURITY DEFINER functions in `public`**, because PostgREST exposes only `public`. This keeps the real tables in `warehouse` per the Blueprint without a dashboard-wide API change. The approved `public` + `adsv2_` fallback was not used.
5. **One deletion, explicitly approved.** `warehouse.ad_changes` was emptied and re-pulled after fault 1. Alex was asked and chose "empty it and re-pull" over marking rows. The table was 8 minutes old, machine-generated, and Meta returns it identically. No other table was touched.
6. **`?factsOnly=1` added to the sync route** — not in the spec, but required to satisfy the spec's own "dry-run first" instruction.

## Pre-existing, not caused by this build

`src/lib/ads-tracker/dashboard-html.test.ts` fails on pristine `origin/main`
(`public/ads-tracker-export.html` no longer contains a `text/babel` block).
Verified against `git show origin/main:` before any changes. All other 101 tests
pass. Flagged as a separate task; deliberately not fixed here (v1 territory).

## Not done, by instruction

No UI/tab changes. No reader switched to the new tables (Build 5). No archiving,
deleting, or renaming of existing tables. v1, the Sheets, and tokens untouched.
No AI-analysis features. No placement-performance pulls. No ManyChat greeting
column.
