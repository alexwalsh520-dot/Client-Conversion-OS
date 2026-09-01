# Jake Archive Plan (2026-09-01)

Goal: Jake is no longer a client. Remove him from every active view, picker, and sync in CCOS so the app is Tyson-only, while keeping 100% of his historical data exactly where it is. Nothing gets deleted. Nothing even gets moved: the app already has a "retired creator" pattern (used for Keith, Lucy, and Antwan) where the data stays in place under his key and one status flag hides him everywhere.

## Current state (verified today)

- Jake's ads are ALL OFF in Meta. 0 active ads, last data day 2026-08-31. No spend risk.
- His data footprint in Supabase (stays untouched, keyed `client_key = 'jake'`):
  - ads_meta_insights_daily: 1,304 rows (spend history)
  - ad_day: 1,156 / warehouse.ads: 811 / ad_state: 112 ad-keyword rows
  - ads_keyword_events: 638 DM lead events
  - adsv2_dm_facts: 623 / adsv2_booking_facts: 61 / adsv2_sale_facts: 32
  - creator_content: 658 rows, registry_keywords: 123 keywords
- warehouse.registry_entities: jake = status `active` (Antwan, Keith, Lucy are `former`)
- warehouse.registry_keywords: 87 of his keywords still marked `active` (Keith and Lucy's were all flipped to `retired` when they left)
- The app's creator list is hardcoded in `src/lib/creators.ts`. Jake is entry 5 with `active: true` at line 105. Flipping that one flag is the same move that retired the other three (commit 5f5285d).
- `ccos_clients` table does not exist in production, so there is no DB client-registry row to touch. The code flag is the whole story on the app side.

## The plan (6 steps)

### 1. Code: flip Jake to retired
- `src/lib/creators.ts:105`: `active: true` -> `active: false, // no longer a client (Sep 2026)`. Keep his entry, keys, matchTokens, AUD currency, and timezone so all history keeps resolving and AUD -> USD conversion keeps working.
- `src/lib/creators.test.ts:50`: add `"jake"` to the retired-creators test loop.
- This alone removes him from: ads leaderboard, content tab, live-ads polling, buyer-DNA routes, daily reports, CMO agent proposals, warm snapshot matrix, and the fallback client registry (about 8 of the 10 creator-iterating surfaces).
- Deploy = commit + push to main (auto-builds on Vercel).

### 2. Vercel: remove Jake's Meta env vars
- Delete `META_ACCESS_TOKEN_JAKE_DIVLJAK` and `META_AD_ACCOUNT_JAKE_DIVLJAK` (and the short `_JAKE` variants if present) from the Vercel project.
- This is what actually stops the two syncs that iterate the FULL creator list regardless of the active flag:
  - `/api/sync/ads-tracker` (hourly Meta insights pull)
  - `/api/ads/creative-copy/backfill-all` (every 2h)
- Both skip a creator whose env vars are missing, so removal is the clean off switch. This copies the Antwan precedent (his sync also stopped via missing prod env).
- Note: fx-sync will keep pulling AUD rates. That is correct, historical Jake reads need them.

### 3. Supabase: registry status flips (data changes, no schema, nothing moved)
```sql
update warehouse.registry_entities
set status = 'former', status_since = '2026-08-28',
    notes = 'FORMER creator, dropped 2026-08-28 (Alex). All ads OFF as of 2026-08-31, zero active. Data retained under client_key jake. Trailing sales label as former_creator_ad.'
where canonical_key = 'jake';

update warehouse.registry_keywords
set status = 'retired'
where client_key = 'jake' and status = 'active';
```
- Exactly what Keith and Lucy's rows look like today. His keywords stay in the table forever, so the all-time keyword-uniqueness rule keeps working (no future client can reuse them).
- Mirror the keyword flip in `public.registry_keywords` if that copy is still read anywhere.

### 4. Zapier: turn off Jake's Skool zap (needs Alex or Matt)
- The Skool signup -> `/api/sales-hub/skool-signup-webhook` Zap posts `client: "jake"`. The webhook itself is config-driven, but the Zap lives in Zapier and should be turned off there.
- I cannot do this one, it is in the Zapier account.

### 5. Skills + memory: roster says Tyson only
- Update `~/.claude/skills/cmo/SKILL.md` (and ad-copywriter if it names Jake) from "Tyson + Jake" to "Tyson only", then run `scripts/sync-skills.mjs` so `public/skills-data.json` regenerates.
- Claude memory already updated to Tyson-only.

### 6. Small piggyback fix (optional but free)
- `src/app/live-ads/page.tsx:9` and `ShareLiveAdsButton.tsx:13` still default the share button to `account="antwan"`, stale since his retirement. Change default to `tyson`.

## What deliberately stays untouched
- Every Supabase row keyed `jake` (all counts above), in both `public` and `warehouse`.
- His registry entity, aliases (including the tracker misspelling "Jake Divijak"), and keyword reservations.
- `matchTokens` in creators.ts, so old tracker rows and transcripts keep attributing to him.
- One-off scripts (`seed-jake-first-responder-ads.mjs`, `tmp-lm30-*.mjs`), dead code, harmless.
- FX AUD syncing (history needs it).
- The Meta ad account itself: ads are already OFF, nothing to pause or delete there.

## Order of operations
1 (code flip) -> deploy -> 3 (SQL flips) -> 2 (Vercel env) -> 5 (skills) -> 4 (Zapier, Alex/Matt) -> 6 (optional fix, can ride the same commit as 1).

Rollback at any point = flip `active` back to true, restore the two env vars, set registry status back to active. Nothing destructive anywhere in this plan.
