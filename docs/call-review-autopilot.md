# Call Review Autopilot (v2, 2026-09-19)

Jeremy (the AI sales manager persona, reached over the Utari MCP) reviews every
sales call, and the system turns those reviews into three things: a per-call
coaching post, a nightly sales brief for Matt plus a marketing brief for Alex,
and a Monday weekly pattern report. Everything posts to `#a-sales-manager`.

## Why v2 existed

Between Aug 26 and Sep 18 the pipeline reviewed **zero closer calls**. The only
Fathom key on file was Matthew's, and a Fathom API key only lists the meetings
*that user* recorded. The three reviews it produced were Matthew's own calls
(a setter interview graded as a sales call). Meanwhile the closers moved to new
Fathom accounts on `@thefitnessprotocol.com` (created ~Sep 16). v2 holds one
key per closer and attributes each call to the key that fetched it.

## Layers

| Layer | Route | Schedule (UTC) | What |
| --- | --- | --- | --- |
| 1 | `/api/cron/call-reviews` | `7,37 * * * *` | Sync every Fathom key → dispatch sales calls to Jeremy → collect finished reviews → per-call Slack post |
| 2 | `/api/cron/call-reviews-digest` | `30 2 * * *` (10:30pm ET) | DAILY SALES BRIEF (Matt) + DAILY MARKETING BRIEF (Alex) + watchdog |
| 3 | `/api/cron/call-reviews-weekly` | `0 12 * * 1` (Mon 8am ET) | WEEKLY PATTERN REPORT |

All three take `Authorization: Bearer $CRON_SECRET`. Debug hooks:
`call-reviews?dry=1&fathomId=<id>` returns the prompt a call would get without
sending; `call-reviews-digest?date=YYYY-MM-DD` and
`call-reviews-weekly?weekStart=YYYY-MM-DD` re-run a period.

## Data flow per call

1. **Fathom sync** (`fathomPullSync`): for each key (`FATHOM_API_KEY_<CODE>`
   per closer, plus the shared `FATHOM_API_KEY` labelled TEAM) list the last 7
   days without transcripts, then fetch transcripts only for recordings we do
   not have. Row lands in `fathom_calls` with `raw.ccos_closer = <CODE>`.
2. **Classification** (`looksLikeSalesCall`): closer-recorded calls count
   unless internal (huddles, 1:1s, Fathom's demo), too short (< 8 min), too
   thin (< 1,500 chars), all-team attendees, or all-client attendees.
   "Onboarding Call" is the $50-app upsell and counts when a closer runs it.
   Calls from the TEAM key count only when titled as a booked sales call.
3. **Context** (`buildCallContext`):
   - tracker row from `sales_tracker_rows` (name + date ±1 day + closer) →
     outcome, cash, program, payment, objection tag, setter, notes;
   - setter DM thread: tracker `manychat_subscriber_id` →
     `instagram_lead_links.instagram_user_id` → `dm_conversation_messages`
     (measured Sep 2026: 88 of 112 tracker rows link, all linked IDs have
     messages); fallbacks `metrics_leads`, then lead name;
   - closer 14-day history from `mm_call_reviews` (avg, last 5, trend).
4. **Prompt**: `SALES_MANAGER_PROMPT` (12-section Stop/Start/Keep review the
   Deal Analysis page parses) + guardrails + the closer-facing rule (never
   blame leads in the rep-facing sections) + context blocks + the JSON footer
   spec in `call-review-format.ts`.
5. **Finalize**: `mm_call_reviews` row (review_md, grade, closer, outcome …)
   plus `fields` (the footer merged with tracker/history facts). Closer comes
   from the key, outcome from the tracker when filled. Per-call Slack post
   (`renderCallPost`) links to `/micromanager?deal=<fathomId>`.

## Rules baked into the prompts

- Closers own every outcome. Lead quality, setter gaps and ad mismatch go only
  into `systemic_flags` / `setter_handoff` / `ad_to_call_mismatch`, which feed
  FLAG FOR MANAGEMENT in Matt's brief and the marketing brief. Never the rep's
  sections.
- Never advise changing offer, price, script or process (guardrails row in
  `mm_scripts`, else `DEFAULT_GUARDRAILS`).
- Confident directives, no "consider".
- Numeric headers (calls, cash, close %, show %) are rendered by code from the
  tracker, never by the model. Definitions are printed in the brief.

## Storage

- `mm_call_reviews.fields jsonb` and `mm_reports` come from
  `supabase/migrations/20260919120000_call_review_v2.sql` (paste by hand). The
  code tolerates their absence: reviews save and Slack posts go out, but the
  marketing brief and weekly report are thin without `fields`.
- Non-call Jeremy runs are tracked in `mm_review_runs` with
  `fathom_id = "marketing:<date>"` / `"weekly:<monday>"` so they never collide
  with the digest's unique `digest_date`.

## Watchdog (nightly)

Fires into `#a-sales-manager` when: no call reached CCOS in 3+ days, a closer
key returns non-200, a closer on the roster has no key, a closer took calls
per the tracker but fewer recordings reached Fathom ("not recording"), or
review runs failed in the last 24h.

## Env

`FATHOM_API_KEY_WILL`, `FATHOM_API_KEY_BROZ`, `FATHOM_API_KEY_CHRIS`,
`FATHOM_API_KEY_WOBBE` (Vercel production, added 2026-09-19). Austin and Erin
have no key yet. `FATHOM_API_KEY` (Matthew), `JEREMY_MCP_TOKEN`,
`SLACK_CHANNEL_SALES_MANAGER`, `CRON_SECRET` unchanged.
