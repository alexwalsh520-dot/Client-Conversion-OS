# UTARI MCP v2 spec (condensed; written by Fable 2026-07-13, updated 07-14)

Server: src/app/api/mcp/utari/route.ts (bearer UTARI_MCP_TOKEN). Existing tools keep working:
list_ads, get_ad, get_dms_for_ad (already returns verbatim threads via dm_ad_links ->
dm_conversation_messages; REUSE its dmsForAd helper + client-name mapping), get_ad_day,
list_sales, get_sales_with_ad (canonical per-sale attribution landed in e67cac2; verify it
meets the status contract below), freshness, factory tools.

HARD RULES: read stored layers only (ads_dashboard_snapshots, ad_state, dm_ad_links,
dm_conversation_messages, fathom_calls, creator_content, content_grades); never live-recompute
attribution or wide raw-table queries (DB statement timeout); money only from canonical
snapshot payloads; DM counts = unique ManyChat subscribers, never Meta messaging metrics; no
fuzzy identity matching (hard keys or linkage_status:"unlinked"); read-only business tables;
responses capped ~100KB with limit/cursor pagination + explicit truncation flags.

SCHEMA CONTRACT (all tools, retrofit existing): one name per concept (spend, dms, cost_per_dm,
booked_calls, cost_per_booked_call, calls_taken, show_rate, closes, close_rate, cash_collected,
roas); ISO 8601 dates + echoed window + note that spend uses the ad account's day (Pacific);
every sale carries attribution_status: "machine_attributed" | "resolved_organic" | "unresolved"
(never a bare null keyword); untracked metrics return "not_tracked", never 0/null; every
response ends with data_freshness (per-source sync times) + coverage (% of window cash
machine-attributed).

NEW TOOLS:
1. business_snapshot: per creator + combined, current + prior week funnel, top/bottom 3 funded
   ads, count of funded zero-DM ads; source ads_dashboard_snapshots; <15KB.
2. get_ad_full: keyword + window -> ONE object: canonical funnel row, placement lineage (every
   ad_id/campaign/adset/status/spend), on-image + primary copy from ad_creative_copy, per-day
   spend/DM series, thread digests (subscriber, first DM, msg count, booked?, 2-line excerpt);
   full threads stay one call away via get_dms_for_ad; <60KB.
3. get_call_transcripts: list mode = summaries + ids from fathom_calls; single-id mode = full
   transcript; sale/keyword linkage only via hard keys else linkage_status:"unlinked".
4. get_organic_content: creator + window + optional grade filter; per post: date, type, caption
   excerpt, engagement counts, permalink, buyer-fit grade + band + top miss (content_grades);
   full transcript in single-post mode only.
5. describe_schema: static versioned docs of every tool, field semantics, attribution_status
   meanings, DM-count definition, known accuracy ceilings (historical DM-to-sale stitch is
   partial; forward capture improving). This replaces any pasted operating manual.

VERIFY against the deployed endpoint with the real token, outputs in PR: business_snapshot
matches the Ads tab to the dollar (same window); get_ad_full for tyson GYM = funnel + lineage +
digests in one call, no status-less nulls; keyword-less sale shows "unresolved"; freshness +
coverage on every response; size caps hold; existing tool shapes unchanged or versioned.
