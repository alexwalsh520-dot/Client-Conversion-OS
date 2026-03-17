# ICP Qualification — Bare Minimum Criteria

## Who We're Looking For

Fitness influencers who follow major fitness brands on Instagram and have a discoverable email address.

## Qualification Filters (Current)

| Criteria | Threshold | Source |
|----------|-----------|--------|
| Has email | Required (IG bio, website, or YouTube description) | Enrichment pipeline |
| Not previously delivered | Email not in `delivered_emails` table | Dedup check |
| Has Instagram username | Required for DM outreach fallback | Apify scrape |
| Follows a target brand | At least one brand from the Brand Bank | Follower scrape |

## What's Captured But Not Filtered

These fields exist on every lead but are **not** currently used as qualification gates:

- **Follower count** — captured, not filtered
- **Business account status** — captured, not filtered
- **Business category** — captured, not filtered
- **Biography content** — used for email extraction only
- **Website** — used for email extraction only

## Disqualification (Auto-Removed)

- Duplicate email (already delivered in a previous run)
- Duplicate email (appears twice in same batch)
- Missing both email AND Instagram username (skipped at outreach import)

## Data Sources Per Lead

1. **Instagram follower scrape** — username, followers, bio, website, business category, business account flag
2. **Email enrichment** — regex extraction from bio, website URL, direct email fields
3. **YouTube Deep Dive** — channel discovery + description email mining (for profiles missing IG email)

## The Pipeline in One Line

Brand followers → enrich for email → deduplicate against delivered → qualify if email OR username exists → import to GHL + Smartlead + ColdDMs
