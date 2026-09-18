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
- Non-call Jeremy runs are tracked in `mm_review_runs` with kind `digest`
  (the only non-call value `mm_review_runs_kind_check` allows) and
  `fathom_id = "marketing:<date>"` / `"weekly:<monday>"`; the prefix picks the
  finalizer and keeps them clear of the digest's unique `digest_date`.
  Re-running a period skips briefs that already completed unless `?force=1`.

## Watchdog (nightly)

Fires into `#a-sales-manager` when: no call reached CCOS in 3+ days, a closer
key returns non-200, a closer on the roster has no key, a closer took calls
per the tracker but fewer recordings reached Fathom ("not recording"), or
review runs failed in the last 24h.

## Env

`FATHOM_API_KEY_WILL`, `FATHOM_API_KEY_BROZ`, `FATHOM_API_KEY_CHRIS`,
`FATHOM_API_KEY_WOBBE` (Vercel production, added 2026-09-19). Austin's key is
pending; Erin left the team (2026-09-19). `FATHOM_API_KEY` (Matthew), `JEREMY_MCP_TOKEN`,
`SLACK_CHANNEL_SALES_MANAGER`, `CRON_SECRET` unchanged.

## Setter DM Review (added 2026-09-19)

`/api/cron/dm-reviews` at `15 3 * * *` UTC (11:15pm ET). For the ET day it
collects every Instagram conversation with activity, keeps the **engaged** ones
(the lead replied at least twice and a setter/automation replied), attributes
each to a setter (tracker setter, else the latest ManyChat tag `setter_name`,
else "Unassigned"), and sends one message per setter to Jeremy with the raw
threads (split into parts above ~80k chars). Jeremy returns the SETTER BRIEF
body + a JSON footer with a grade per conversation. Header numbers (engaged
count, call links sent, booked, median reply time) are rendered by code.

- Posts: one `*SETTER BRIEF* | date | setter` message per setter (and part) to
  `#a-sales-manager`. Stored in `mm_reports` (kind `setter`, period
  `<date>:<setter>`), per-conversation grades in `mm_dm_conversation_reviews`.
- Runs are tracked in `mm_review_runs` as kind `digest` with
  `fathom_id = "setter:<date>:<setter>[:pN]"`; the 30-minute call-reviews tick
  collects any that did not finish inline. `?date=`, `?setter=`, `?force=1`.
- No Claude API in the loop: Jeremy is the reviewer (Matthew's call).
- Known gap: conversations with no `instagram_lead_links` row (about a quarter
  of a day's engaged threads on 2026-09-17) land in "Unassigned".

## Tracker Autofill — shadow mode (added 2026-09-19)

`/api/cron/tracker-autofill-shadow` every 30 min (last 3 days) and once a day
with `?report=1` (last 7 days, posts the side-by-side). `src/lib/tracker-autofill.ts`.
**The Google Sheet is never written** unless `TRACKER_AUTOFILL_WRITE=1`, and
even then only HARD cells that are BLANK on the sheet (never over a human).
The service account `ccos-sheets-reader@nerve-488206.iam.gserviceaccount.com`
must be added as an **editor** on the tracker first (it is read-only today).

Hard keys (the certainty rule):

| Cell | Source | Certain when |
| --- | --- | --- |
| identity | GHL appointment | exactly one Strategy/Onboarding booking matches name + date (±1 day) |
| Call Taken / Recorded / Recording Link | Fathom | a recording lists the booking's contact **email** as invitee within 6h of the booking |
| Call Length | Fathom duration | recording did not start >3 min before the booking (else ask) |
| Outcome WIN / Cash / Method | Stripe **The Forge LLP** account (`STRIPE_KEY_TYSON_LLP`, not synced to `stripe_payments`) | a paid charge ≥ $100 with the booking's email, from 1 day before to 3 days after the call; affirm/klarna → AFFIRM/KLARNA, subscription invoice → MONTHLY; one-off card/link → ask PIF vs I.H.P.P. |
| CANCELLED | GHL status | appointment cancelled |
| NS/RS | GHL | a later booking for the same contact on the **same** calendar |
| Call Notes | Jeremy call summary | always, prefixed `[AI]` |

Everything else (no-show with no evidence, LOST/PCFU/NOT A FIT, objection,
program length off Stripe, name-only Stripe or Fathom matches, ambiguous
bookings) is an **ask**: listed in the report with the evidence gathered from
`#call-updates` (bot is a member of `C09KKCU3S65`) and SendBlue.

Dry run 2026-09-15..18 (50 rows): 41 keyed, 2 ambiguous, 7 no booking; every
HARD cell agreed with the closers (Call Taken 10/10, Outcome 10/10, Cash 10/10);
57 asks. Closers were not yet recording on their own Fathom accounts, so
Recorded/Length/Link were mostly blank on the system side.
