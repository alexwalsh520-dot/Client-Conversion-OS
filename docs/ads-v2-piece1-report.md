# Ads v2 - Piece 1 - build report

Date: 2026-07-23. Route: `/ads-v2` (behind the same login gate as every CCOS tab). v1 stays untouched and running at `/ads`.

Active clients surfaced: Tyson and Jake only. No other creator appears anywhere in v2.

This report is written plainly for a non-technical owner. It states what was built, what the numbers say, and where the honest limits are. No em dashes, no italics.

---

## 1. What was built

A clean, sturdy data product. The whole thing is one deterministic attribution pass computed in the background, written to a granular facts store, and read back as precomputed window snapshots. The page only ever does an indexed read. Nothing on a page load calls an external service or recomputes history.

Delivered in scope:

- Account dropdown (All, Tyson, Jake). All is the sum of the two clients and never merges keywords across them.
- Active / Finished / All status pills.
- Date selector with presets (today, yesterday, last 3, last 7, last 14, last 30, this month, last month) and a two-click custom calendar. Every preset resolves to an exact Eastern-time range.
- Campaign Performance table at Campaign / Ad set / Ad levels.
- Daily budget column (new), reading the real configured budget from Meta.
- Working behaviors: tri-state column sorting that actually cycles (ascending, descending, default), image-cell hover preview, hover on booked calls / calls taken / show rate showing the named people behind the number with reschedules grouped under one person, an info hover on every column with a one-sentence plain-English definition, row selection with select-all, and a correct TOTAL row computed as formulas over the union (never a sum of row ratios).
- Settings gear: the Organic Keywords manager (Tyson, Jake) and a "How your numbers work" panel that renders directly from the same single definitions registry that powers the column hovers.
- Paid ads only. Organic, keywordless bookings, and anything unprovable appear nowhere in this view (they are still captured internally for later pieces).

Everything above was verified in a browser against real data before shipping (screenshots taken during the build).

---

## 2. The data, checked before building (with corrections)

The five pre-verified facts were re-checked against the live database. Two need honest correction:

- Fact 1 and 2 (spend is Eastern-time native): CONFIRMED for the served accounts. Tyson (3,027 rows) and Jake (348 rows) are 100 percent Eastern-time marked. The "662 dirty rows dated Jun 18 to Jul 16 without the marker" are entirely Antwan, who is inactive and is not served by v2. So the served windows are already uniformly Eastern time, and the homogenization gate passes with zero work needed on Tyson or Jake. Antwan / Keith / Lucy unmarked rows stay in the database for v1 history and are never read by v2. Re-syncing Antwan is out of v2 scope and is also blocked by a missing local token, so it was not attempted.
- Fact 3 (calendar scoping): CONFIRMED and applied. See section 5.
- Fact 4 (keyword coverage on real sales bookings is "effectively total", 98 of 98): CORRECTED. On Tyson's Strategy Session calendar over the last 30 days there were 126 distinct people booked but only 65 carry a keyword. About half of the bookings on the sales calendar have an empty `utm_content` (organic, direct, or a DM that never sent a keyword). This is a real capture gap, not an extraction bug: the keyword sits in `raw_payload.contact.attributionSource.utmContent` and is correctly derived, and the empty ones genuinely have no value. Per the spec these keywordless bookings show nowhere in the paid view and are flagged in the nightly self-check. The "98 of 98" figure came from a pre-derived booked-call event stream that already filtered to keyword-carriers; v2 counts the calendar directly, which is stricter and more honest.
- Fact 5 (ad name equals keyword): CONFIRMED. Tyson's ad names are all clean single keywords. The only mismatches in the last 14 days are Jake's four ads (`Add 1/2/3 Free Course` all map to `course`, and `Direct Video Ad 7` maps to `7`). Since Jake has no DM or booking funnel connected yet, this does not affect any attributed number today; it is flagged for when Jake's funnel comes online.

Jake reality: Jake has real ad spend, impressions, clicks, and budgets, but zero DMs, zero bookings, zero sales anywhere in the data (his ManyChat and GoHighLevel are not wired to the attribution chain yet). v2 renders his spend and budget honestly and shows empty (not errors) for the funnel, with a plain notice.

---

## 3. Architecture

- Facts store (individual rows, namespaced `adsv2_`): `adsv2_dm_facts` (one row per keyword DM), `adsv2_booking_facts` (one row per sales-calendar appointment), `adsv2_sale_facts` (one row per sales-tracker row). Each carries its keyword, link method, evidence, Eastern-time day, and whether it is organic or awaiting review. Window tables are aggregations over this store, never a replacement.
- Budget snapshot: `adsv2_budget_snapshots`, one immutable row per entity per Eastern-time day. This is the only new external sync.
- Window cache: `adsv2_window_snapshots`, keyed by account, window, level, status, and stamped with a data version. `adsv2_meta` holds the version; a sync bumps it; reads revalidate on change.
- Attribution core: `src/lib/ads-v2/attribution.ts`, a few hundred lines of pure, unit-tested functions. Every rule is one sentence and those sentences live in one registry (`src/lib/ads-v2/definitions.ts`) that powers both the column hovers and the gear panel. A build-time test fails if any displayed column lacks a registry entry.
- Aggregation is done by the database in set-based SQL (`adsv2_window_leaves`, `adsv2_budget_asof`). The serving code only assembles the small pre-aggregated result into the campaign tree. No request fetches thousands of rows to sum in JavaScript.
- Money is integer cents end to end, formatted to dollars only at render. Non-USD spend (Jake, AUD) is converted to USD per Eastern-time day inside the aggregation, using the reference rate for the day the money moved.
- Time is Eastern-time everywhere through one shared bucketing function.
- Background jobs: `/api/cron/ads-v2-sync` (budget snapshot, then facts pass, then version bump, then precompute the standard matrix) runs at minute 25 each hour behind a lock so runs never overlap. `/api/cron/ads-v2-selfcheck` runs nightly.

---

## 4. Attribution rules (the one-sentence registry)

Revenue ties to a keyword by hard key only, in this order: the pasted ManyChat subscriber id on the sale row, then the stored GoHighLevel-to-ManyChat bridge, then the subscriber's own ManyChat profile keyword (accepted only for keywords with real paid spend). A human workspace decision outranks all of them. Matching by name is never used for attribution; names are display only. Everything unprovable is stored as awaiting review and is not displayed in this piece.

Count people, not paperwork: booked calls are distinct people on the sales calendar, with reschedules grouped under one person. Calls taken are the sales-tracker rows where the call actually happened. Show rate is distinct people taken divided by distinct people booked minus upcoming, in the same window, and it can pass 100 percent through cross-window carryover (the column note says so).

Organic collision: a word marked organic is treated as organic only outside a paid ad's run plus a 30-day cool-down; while a paid ad runs the word, paid wins.

---

## 5. Calendar scoping (fact 3)

Distinct GoHighLevel calendars were listed from the data. The sales (Strategy Session) calendars were pinned in configuration, not guessed.

Included as sales bookings:

- Tyson: `Strategy Session (TS)` id `M4z9iTPUiT9rjk0QKOvD` (521 appointments all-time) and the near-duplicate `Strategy Session - (TS)` id `IeKPrRYzD2RS9ne3fOqT` (6 appointments).
- Jake: none. No sales calendar is connected in GoHighLevel for Jake yet, so his booked count is honestly empty.

Excluded (not sales bookings), with all-time counts on Tyson's records: `Onboarding Call with The Forge` (103), `7 Day schedule - Onboarding Call w/ The Forge` (145), `Onboarding Call w/ The Forge` (52), `Will Reschedule` (27), `1:1 With Coach Jacob` (11), `Andrew Personal Calendar` (9), `Broz Reschedule` (4), and other personal or other-creator calendars. Onboarding and personal calendars are post-sale or unrelated and would double count if included.

Gap flagged (fact 4): on the Strategy Session calendar, keyword coverage is about 52 percent, not near-total. The keywordless bookings are reported nightly for the humans to fix at source.

---

## 6. Accuracy gates (run 2026-07-23, all green)

Gate 1 - Sales reconciliation (attributed revenue is a subset of the sales tracker, never exceeds it):

- Last 7 days: attributed collected 699,900 cents ($6,999) vs sales-tracker total 1,139,700 cents ($11,397). Pass.
- Last 30 days: attributed collected 3,582,900 cents ($35,829) vs sales-tracker total 6,502,500 cents ($65,025). Pass. Every attributed sale stores its link method, keyword, and dates as evidence, shown in the revenue attribution and hover.

Gate 2 - Spend reconciliation:

- Zero unmarked (non-Eastern-time) spend rows remain in any served window (checked over the last 30 days). Pass.
- v2 window spend totals are exactly the set-based SQL sum over `ads_meta_insights_daily` for the same Eastern-time dates, because the aggregation function is that sum.
- Boundary note: Tyson's account reports on Pacific time and Jake's on Sydney time, so a single day in Ads Manager can differ slightly from a single Eastern-time day; multi-day totals match. The spend hover carries this note.

Gate 3 - Booked reconciliation (last 7 days, two sampled keywords):

- Keyword `fit`: 7 distinct people from 8 appointment records. The extra record is a reschedule (Jordan Gonzalez booked twice), grouped under the one person. People: Aaron Maynard, Jennifer Hansen, Jordan Gonzalez, Leo Baez, Michael Salgado, Quinn Edwards, Zeferino Garcia.
- Keyword `gym`: 2 distinct people (Brian Pagan, Shane O'Quinn), 2 records.
- Pass. Reschedules collapse to one person; the hover lists every record.

Gate 4 - Cross-window invariants: 0 violations. Nested windows (1 day inside 3 inside 7 inside 30) never show an additive metric shrinking as the window grows. A regression test covers the nested-window bounds, and any violation writes an alert row.

Gate 5 - Determinism: the response is a cached, version-stamped snapshot. Repeated identical requests return the byte-identical stored payload until a sync bumps the data version. The compute itself is deterministic (stable ordering, fixed facts).

Gate 6 - Budget column (as configured on 2026-07-23):

- Ad set `FIT - Warm Audience Stack (relaunch 7/21)`: $115.00/day, active (ABO). Matches Ads Manager.
- Ad set `7/1 - SCALE - Revived Winners`: $100.00/day, active (ABO). Matches Ads Manager.
- Campaign example (CBO): `CBO: oMessage - DIRECT CTA - Video/Images` holds $1,200.00/day (paused). ABO campaigns (the active SCALING and TESTING) correctly show a dash because their budget lives on the ad set. Every ad row shows a dash. Pass.

Gate 7 - v1 vs v2 difference (Tyson, one 7-day window, why v2 differs and why it is right):

v2 answers to the primary sources, not to v1. The expected and observed differences all come from named v2 rules:

- Booked drops where v1 counted reschedule duplicates. Example: Jordan Gonzalez on keyword `fit` is 2 appointment records but 1 booked person in v2.
- Booked drops where v1 counted non-sales-calendar records. v2 counts only the Strategy Session calendar; onboarding, reschedule, and personal calendars are excluded.
- Booked drops where a booking has no keyword. v2 shows paid keywords only; keywordless bookings (about half of the calendar) are excluded from the paid view and flagged instead.
- Taken and revenue are tied to a keyword by hard key only, so anything v1 attached by name falls out of the paid rows and into awaiting review.

Net effect: v2's paid numbers are smaller and cleaner than v1's, by design.

Anomalies surfaced by the nightly self-check (reported for humans, never excluded from counts): 11 appointments whose scheduled time precedes their booking record timestamp, and 12 keywordless bookings on the sales calendar in the last 7 days. These are written to `adsv2_alerts`.

---

## 7. Honest limits and blocked items

- Jake budget: his Meta access token is not set in this environment, so his budget snapshot is skipped with a recorded reason. Spend, impressions, and clicks still flow (they come from the existing insights sync). When his token is added as an env var, the budget sync picks him up with no code change.
- Jake funnel: no DMs, bookings, or sales are connected for Jake yet, so his funnel columns are honestly empty. This is configuration, not code.
- Antwan homogenization: the 662 unmarked spend rows are Antwan (inactive, not served by v2) and re-syncing them needs a token that is not available locally. v2 never reads them, so no served number is affected.
- Performance: the full background sync (budget, facts, precompute of 72 windows) runs in a few minutes when driven from a laptop, because each window makes several round trips to the database and laptop-to-database latency dominates. On Vercel, in the same region as the database, that latency is a few milliseconds and the sync is well under a minute. As a safety net, the precompute has a wall-clock budget and warms the most-used windows first; any window it does not warm is built on demand in a couple of seconds and then cached. The request path itself is an indexed read and is fast.

---

## 8. Deploy

- Tests: 30 unit tests pass (attribution core, definitions registry, Eastern-time math, derived metrics).
- Types: `tsc --noEmit` clean across the whole project.
- Production build: compiled successfully with `/ads-v2`, `/api/ads-v2`, `/api/cron/ads-v2-sync`, and `/api/cron/ads-v2-selfcheck` present.
- Crons added to `vercel.json`: `ads-v2-sync` hourly at minute 25, `ads-v2-selfcheck` nightly at 07:45.
- Migrations applied: 054 (schema), 055 to 057 (aggregation functions and index).

The final commit is pushed to `main`; production serves it via the Vercel GitHub integration.
