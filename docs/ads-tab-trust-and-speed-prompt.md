# EXECUTION PROMPT: Ads tab — one truth, fast, never silently stale

> Repo: CCOS dashboard. Diagnosis was done 2026-07-09 with evidence; build against these root
> causes, in this order. The Ads tab UI lives in the static file public/ads-tracker-export.html
> (rendered via iframe by src/app/ads/page.tsx); the computation is
> src/lib/ads-tracker/server.ts served by /api/ads-tracker (force-dynamic, no-store).

## Root causes (verified — do not re-litigate)

1. **Refresh shows different numbers** because failures swap sources silently, in two layers:
   - Client: public/ads-tracker-export.html loadDashboard (~line 10748) falls back to a
     localStorage snapshot when the live fetch fails, with only a subtle fromCache flag. The
     live call fails often because of root cause 2, so users alternate between live data and
     old snapshots without knowing.
   - Server: sales rows come from a 3-way source chain (synced copy if synced within 20 min,
     else live Google Sheet, else DB copy — server.ts fetchSalesRowsFast ~line 1031). Different
     requests can be served by different sources.
2. **The API is brutally slow** (measured 100-240s, frequent timeouts): /api/ads-tracker
   recomputes the entire attribution pipeline (meta rows, keyword events, origin promotions,
   GHL supplements, sales joins, alerts) on EVERY request with no server-side caching. The
   current "live data unavailable" banner users see is this endpoint timing out.
3. **"Doesn't match Ads Manager"** is mostly consequence of 1 (stale snapshots being compared
   against live Ads Manager) plus unlabeled window/timezone semantics (Meta rows are bucketed
   by the AD ACCOUNT's day — America/Los_Angeles for both creators — while users assume EST)
   plus intended definitional differences (our DM counts come from ManyChat events, not Meta's
   inflated messaging metric; booked calls from GHL; revenue from the sales tracker). Once the
   tab always shows one fresh labeled source, remaining differences must be explainable and
   documented in-UI.

## Build

### 1. Server-side snapshot cache (kills the slowness and the timeouts)
- New table ads_dashboard_snapshots: (id, account text, date_from date, date_to date, level
  text, status text, payload jsonb, computed_at timestamptz, compute_ms int,
  unique(account, date_from, date_to, level, status)).
- A compute job builds getAdsTrackerDashboard for the standard windows (each account incl.
  "all": last 7d, 14d, 30d, month-to-date, plus any window requested in the last 24h) and
  upserts snapshots. Trigger it: (a) at the end of the existing hourly
  /api/cron/ads-tracker-sync, (b) from the manual "Sync Now" button, (c) lazily — see below.
- /api/ads-tracker request path: serve the matching snapshot instantly (target < 1s) with
  computed_at in the payload. If no snapshot matches (custom window): compute once, store,
  serve — and if computation exceeds the platform timeout, split the pipeline so the heavy
  attribution pass is reused across windows (attribution events don't depend on the display
  window; only the aggregation does). Profile where the 100-240s actually goes (log stage
  timings into compute_ms/brief log) and fix the top offender — nothing in this pipeline
  justifies minutes.
- Requests never trigger the live Google Sheet. Sales rows in the compute job come from the
  synced copy ONLY; raise SALES_COPY_FRESH_MS to tolerate the real sync cadence, and if the
  copy is genuinely stale, the payload carries a staleness flag instead of switching sources.
  One request = one source, always labeled.

### 2. Honest freshness in the UI (kills silent divergence)
- Every render shows a small fixed freshness line: "Data as of 3:40 AM ET · sales synced
  3:40 · Meta synced 3:01" (from payload metadata).
- The localStorage fallback stays as a last resort but becomes LOUD: a full-width amber banner
  "Live data failed to load. Showing your device's saved copy from [time]. Numbers may be
  old." Never render cached data without the banner. With the snapshot cache in place this
  should almost never trigger.
- Remove the possibility of two tabs disagreeing: all surfaces that show tracker numbers
  (Ads tab iframe, Deep Dive, any React metrics component) read the SAME snapshot payload for
  the same window. Grep for other callers of /api/ads-tracker and any component computing its
  own variant; unify.

### 3. Window/timezone clarity vs Ads Manager
- The date-range control gets one permanent caption: "Spend uses Meta's ad-account day
  (Pacific), matching Ads Manager. DMs, calls, and sales use Eastern days." (Plain text, no
  em dashes, no italics.)
- Add a "compare with Ads Manager" note in the info popover: to reproduce a number in Ads
  Manager, set the same date range there; expect DM counts to differ by design (we count
  unique ManyChat subscribers, Meta counts conversations started, which inflates 2.4-3x).
- Verify the sync writes Meta rows keyed by the account-timezone date (they are); ensure the
  tab's dateFrom/dateTo filtering of meta rows does not shift them by a day (spot-check a
  single ad's yesterday spend against Ads Manager for both accounts and document the result
  in the PR).

### 4. Filter and label UX
- Ad set filter becomes multi-select: checkbox list with select-all/none; selecting one ad set
  must NOT hide the others from the picker; the table shows the union of selected. Same for
  campaign filter if it shares the single-select behavior.
- Ad-level rows: stop prefixing names with long numeric id strings. Show the keyword (or ad
  name) as the primary label; put ids in a tooltip/expanded row only. If ids are currently
  part of uniqueness keys in the UI, keep them under the hood.

## Guardrails
- Do not change attribution logic, money math, or source precedence semantics beyond what is
  specified (single-source-per-render + labeling). No new dependencies. The static HTML file
  is concurrently edited by other agents sometimes — make edits surgical and keep the file
  working after every commit.
- Plain language in all new UI text. No em dashes. No italics. Show raw true numbers; never
  hide a metric behind a floor.

## Verify
1. Cold-load the Ads tab twice in a row and after a hard refresh: identical numbers all three
   times, freshness line visible, loads in under 2s from snapshot.
2. Kill the network mid-session and reload: the amber saved-copy banner shows unmistakably.
3. Pick one ad, yesterday, both creators: spend matches Ads Manager for the same range (same
   account-day); document the comparison in the PR description.
4. Multi-select two ad sets: both remain visible; the others stay available in the picker.
5. Ad-level table shows keyword-first labels, no leading id strings anywhere.
6. Hourly cron + Sync Now both refresh snapshots; computed_at advances; custom window computes
   once then serves cached on the second request.
7. grep changed files for "—" and italic: zero hits.
