# EXECUTION PROMPT: Ads tab keyword lineage view

> Context for the executing agent: this spec replaced a longer one after the owner rejected
> most of it. His display philosophy, which governs this build and any future Ads tab work:
> the tab shows RAW TRUE NUMBERS, always. Never hide a metric (no minimum-spend floors on
> ROAS), never decorate real counts with warning asterisks, never suggest operational actions
> in the display. Small samples are the owner's judgment call, not the UI's. The job of the
> display is to organize truth intuitively, not to editorialize it.

## Background (verified facts, 2026-07-08)

The Ads tab groups performance by `keyword_normalized`. A keyword is the durable identity of
a creative: the team deliberately moves/relaunches the same ad across campaigns and ad sets
(verified: antwan LEGEND = one creative with identical on-image OCR living in 3 ad placements
over time; tyson PRO = one creative in 2 placements). Keyword-level attribution correctly
survives these moves. What's missing: the tab gives no way to see WHERE a keyword's spend
lives, so "LEGEND $33" in the tab vs "$5.36" on one ad in Ads Manager reads like a bug when
it's actually one creative's total across placements.

## The build (one feature, display only)

In the Ads tab (and Deep Dive keyword views), make each keyword row expandable to show its
**placement lineage**: one line per `ad_id` that has EVER spent on that keyword, showing:

- campaign_name, adset_name (verbatim)
- ad_id
- current ad_effective_status (ACTIVE / PAUSED / etc.)
- first spend date, last spend date
- spend in the currently selected window, and all-time spend
- link clicks in window (already in ads_meta_insights_daily)

Sort: currently ACTIVE placements first, then by last spend date descending. On the collapsed
row, when more than one ad_id has spend in the selected window, show a small neutral chip:
"N placements". No warning colors, no advice text. Data source: `ads_meta_insights_daily`
grouped by (keyword_normalized, ad_id) — all fields listed exist on that table.

Attribution note: do NOT attempt to split DMs/booked/closed/revenue per placement. Leads fire
a keyword, not an ad_id; the keyword level is the truth for funnel and money. Lineage rows
carry spend-side fields only.

## Rules

- Display layer only. Do not modify attribution, sync, or any API contract other than adding
  the lineage data to the tracker payload (extend `getAdsTrackerDashboard` output additively;
  nothing existing changes shape).
- No new dependencies. Match existing component patterns in the Ads tab.
- Plain language, no em dashes, no italics in any new UI text.
- Do not add: ROAS/LTGP spend floors, carryover asterisks on funnel counts, collision
  warnings, pause suggestions, or cross-creator keyword flags. All were explicitly rejected.

## Verify

1. antwan keyword LEGEND, any window covering July: chip shows placements; expanding lists
   3 ads ("7/1 - TEST - Warm - Pain Angles" ACTIVE with the recent spend, "Warm Audience
   Stack - Content ICP" with ~$5.36, and the dead 6/11-campaign row at $0.01). The keyword
   row's totals are unchanged from before this feature.
2. tyson PRO: 2 placements ("7/1 - SCALE - Revived Winners" and "TEST · Direct CTA · 50
   (6/24)").
3. tyson FIT 14d: renders exactly as before, single placement, no chip.
4. No other row, metric, or number anywhere in the tab changed value.
5. Search changed files for "—" and "italic": zero hits.
