# Ads v2 — verified data findings (2026-07-23)

Project: Supabase `bostjayrguulwaltnbgt`. Worktree branch `ads-v2-piece1` off origin/main (09cea68).

## Accounts (active v2 clients)
- Tyson: `client_key='tyson'`, ad_account `act_176726311`, account_timezone `America/Los_Angeles`, currency USD.
- Jake: `client_key='jake'`, ad_account `act_304988118349730`, account_timezone `Australia/Sydney`, currency AUD (convert to USD at read; origin/main commit d8569b4 already does non-USD->USD; reuse `src/lib/fx`).

## Spend table `ads_meta_insights_daily` (ET-native marker = raw_payload->>'reporting_timezone' = 'America/New_York')
- Tyson: 3027 rows, 100% ET-marked, 2026-04-01..2026-07-23.
- Jake: 348 rows, 100% ET-marked, 2026-06-09..2026-07-23.
- Antwan: 662 rows, 0% ET-marked, 2026-06-18..2026-07-16 (INACTIVE, NOT served by v2). <-- this is fact-2's "dirty pocket"; it is entirely Antwan.
- Keith: 1060 unmarked (inactive). Lucy: 191 unmarked (inactive).
- CONCLUSION: v2's served accounts (Tyson, Jake) are already 100% ET. Gate-2 "zero unmarked rows in served windows" passes with no homogenization needed. Serving query still filters to ET-marked rows defensively; nightly check flags any unmarked in served windows. Antwan re-sync is out of v2 scope + blocked (token not local) -> document.
- Columns: spend_cents (int), impressions, link_clicks, ad/adset/campaign id+name, keyword_raw, keyword_normalized, date, ad_effective_status, ad_configured_status, campaign_effective_status, campaign_configured_status, account_timezone, raw_payload.
- Status vocab: ad_effective_status in {ACTIVE, ADSET_PAUSED, CAMPAIGN_PAUSED, PAUSED}; campaign_effective_status in {ACTIVE, PAUSED}. Active pill = ad_effective_status='ACTIVE'.
- No CPM/clicks-cost columns: CPM derived = spend/impressions*1000. link_clicks is the click count.

## Jake reality
- Jake has spend/impressions/clicks only. ZERO dm_keyword events, ZERO booked_call, ZERO ghl_appointments, ZERO sales. ManyChat/GHL not wired.
- v2 renders Jake: real spend/impressions/clicks/CPM/budget; honest empty ("No booking data yet"/0) for DMs/booked/taken/show/revenue.

## Booked calls = ghl_appointments scoped to SALES calendars, DISTINCT PEOPLE (contact_id), keyword-carrying only for paid view
- Keyword source path in raw_payload: `contact.attributionSource.utmContent` (also in `.url` ?utm_content=). `mediumId` = calendar_id. Column `keyword_normalized` is ALREADY correctly derived (FIT->fit). Trust the column; scope by calendar_id.
- Tyson SALES calendar(s): `Strategy Session (TS)` id `M4z9iTPUiT9rjk0QKOvD` (521 appts) + variant `Strategy Session - (TS)` id `IeKPrRYzD2RS9ne3fOqT` (6 appts).
- EXCLUDED (not sales bookings): all Onboarding Call* (post-sale), *Reschedule (Will/Broz/Austin), 1:1 With Coach Jacob, *Personal*, Strategy Session With Matt, other-creator strategy sessions.
- Jake SALES calendar: none present yet (no Jake appointments). Config leaves Jake calendars empty -> booked=0 honest.
- Tyson last-30d on sales calendar: 129 rows, 126 distinct people, **66 distinct people carry a keyword**. ~60 keywordless (empty utm_content) = GENUINE capture gap (organic/direct/DM-no-keyword). Corrects fact-4's "98/98"; reality ~52% keyword coverage on the Strategy Session calendar. Keywordless bookings displayed NOWHERE (paid-only); flagged in nightly report.

## Revenue = sales_tracker_rows (month tabs, no creator column)
- sheet_tab = MONTH (APRIL..JULY). Creator derived via keyword->ad->client chain (keywords unique per creator).
- Cols: date, prospect_name, call_taken (bool), call_taken_status, outcome, closer, setter, contracted_revenue_cents (bigint), collected_revenue_cents (bigint), recording_link, manychat_link, manychat_subscriber_id.
- manychat_subscriber_id coverage: JUNE 209/238, JULY 178/181, MAY 58/208, APRIL/MARCH 0. Recent months well-covered.

## Attribution hard keys (priority order per spec)
1. sales_tracker_rows.manychat_subscriber_id (pasted) -> ads_keyword_events.subscriber_id -> keyword_normalized.
2. manychat_contact_links (client, subscriber_id, ghl_contact_id) bridge.
3. manychat_origin_checks (client_key, subscriber_id, from_ad, origin_keyword, is_control) = origin evidence, auto-resolution, only for keywords with real paid spend.
- Human workspace resolutions outrank all (future piece; store supports it).
- Name matching BANNED as attribution.

## Existing v1 stores (reference only; v2 namespaced adsv2_)
- ads_attribution_facts (v1), ads_dashboard_snapshots (v1 snapshot cache), ads_keyword_events (canonical event stream: dm_keyword, booked_call, manual_booked_calls), ads_sync_runs, ads_client_failures.
