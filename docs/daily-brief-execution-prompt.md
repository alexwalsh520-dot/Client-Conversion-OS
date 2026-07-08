# EXECUTION PROMPT: The Daily Marketing Brief ("Morning Brief")

> **To the executing agent (Opus 4.8):** You are building this inside the CCOS dashboard repo
> (`/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard/`). This spec was
> written by the CMO brain (Fable session, 2026-07-03) which carries months of hard-won context
> about this data. The rules in Section 2 are not suggestions. Each one exists because getting it
> wrong already burned us once. When this spec and your instinct disagree, the spec wins. When the
> spec is ambiguous, leave a `// SPEC-QUESTION:` comment and pick the conservative option rather
> than inventing. Do not "improve" the attribution model.

---

## 1. Mission

Alex (owner, non-technical) wakes at ~10:15 AM Eastern. By then, every day, a brief is waiting
in Slack that gives him the complete, trustworthy state of his marketing: what happened yesterday
(midnight-to-midnight ET), what the DMs actually said per ad, what's anomalous, and how the
funnel is trending across 1/3/7/14-day windows for both creators (Tyson and Antwan). He makes
money decisions off this. A wrong number in this brief is worse than no brief. ~20 families
depend on these decisions being right.

Trust is the product. Accuracy beats completeness, and shown gaps beat hidden ones. Every number
must be traceable to its source, and the brief must loudly say when a source is stale or a number
is a floor rather than a truth.

## 2. Non-negotiable data rules (each learned the hard way)

1. **Revenue attribution comes from the canonical Ads-tab computation only** — the logic in
   `src/lib/ads-tracker/server.ts` (`getAdsTrackerDashboard`). It promotes ManyChat origin-check
   verdicts with a spend guardrail, folds in manual Attribution-Workspace resolutions, and dedupes
   first-hit-wins. Raw `ads_keyword_events` joins UNDERSTATE revenue. Never hand-roll
   sale-to-keyword attribution. Refactor the canonical logic into a reusable function if needed;
   do not fork it.
2. **DM/lead counts are OUR counts**: distinct ManyChat subscribers per keyword from
   `ads_keyword_events` (`event_type='dm_keyword'`), exactly how the Ads tab builds
   `group.messages`. NEVER use Meta's `messaging_conversations_started` — it inflates 2.4-3x.
   Meta is trusted for spend only, never for lead or message counts.
3. **Group by `adset_id`, never by ad set name.** Same names exist across campaigns.
4. **Same window on both sides of every ratio.** Never mix a 3-day numerator with a 7-day
   denominator. On 1-day and 3-day windows, label revenue/ROAS as **"floor"** — the sales cycle
   runs 1–14 days, so short-window ROAS is structurally understated. Booked calls are the honest
   leading indicator on short windows; say so in the brief footer.
5. **Zero-spend or starved ads get no verdicts.** Meta concentrates budget; a starved ad is
   untested, not a loser. The brief lists funded ads (spend ≥ $20 in window) and reports the
   starved count as "N ads still untested."
6. **Timezone honesty.** Sales, DM events, bookings: bucket by `America/New_York` calendar day
   (handles EST/EDT automatically). Meta spend arrives pre-bucketed by the ad account's timezone,
   which is `America/Los_Angeles` for BOTH creators — you cannot re-bucket it. Use Meta's
   account-day as "yesterday's spend" and print this once in the brief footer: "Spend is bucketed
   by Meta's account day (Pacific); everything else is midnight-to-midnight Eastern." Do not
   pretend the skew doesn't exist; do not try to fix it by splitting Meta days.
7. **Freshness gates, enforced in code.** Before rendering, check the last-sync timestamp of every
   source (`ads_meta_insights_daily.synced_at`, `sales_tracker_rows.synced_at`, keyword events,
   GHL appointments, dm_conversation_messages). Any source stale beyond its threshold → the brief opens with a
   RED banner naming the stale source, and every metric derived from it renders as "—" with the
   reason. Never silently report on stale data. (An April-stale table once got cited as current
   in a live report. Firing-level mistake. This gate is why it can't recur.)
8. **Reconcile to the dollar, every day.** The brief's "yesterday collected" must equal the
   sales-tracker sum for that ET day. Assert in code; if it drifts by more than $1, RED banner.
   Also print attribution coverage daily: % of yesterday's collected cash tied to a creator
   machine-certainly. Coverage is a headline metric, not a footnote.
9. **No verdicts in the brief.** The brief informs; kill/scale decisions happen in the weekly
   CMO read with Alex. The brief may flag ("FOCUS booked 0 calls on $431 this week") but never
   instructs ("kill FOCUS").
10. **All prose through the humanizer standard.** No em dashes anywhere. No AI-tell phrasing
    ("not X, it's Y" punchlines, staccato drama, "Read that again"). Plain language, short
    sentences, a person talking. Alex banned AI slop on 2026-07-03; it applies to this brief.

## 3. What exists already (do not rebuild)

- **DB**: Supabase project `bostjayrguulwaltnbgt`. Key tables: `ads_meta_insights_daily` (per-ad
  daily spend, keyword_normalized, statuses), `ads_keyword_events` (canonical DM/booked events,
  subscriber_id), `sales_tracker_rows` (cash, manychat_subscriber_id, closer, outcome,
  call_taken), `ghl_appointments` (booked calls per keyword), `dm_transcripts` (setter-pasted,
  sparse, often stale — treat as supplementary only), `fathom_calls`, `ad_creative_copy`
  (on_image_text OCR per ad — use it to describe what each ad says).
- **Canonical attribution**: `src/lib/ads-tracker/server.ts` — the source of truth (rule 1).
- **ManyChat webhook**: `src/app/api/sales-hub/manychat-webhook/route.ts` — writes
  `ads_keyword_events` when the payload carries a keyword.
- **Cron infra**: Vercel crons exist (`/api/cron/content-pipeline` every 2h, others). Add new
  crons in `vercel.json` the same way.
- **AI plumbing**: Anthropic via AI SDK patterns exist in the content pipeline
  (`/api/content/mine`, Groq transcription, compute-once stores like `content_voc`). Copy the
  compute-once → store-as-data → query-the-store architecture. Alex locked it; random sampling
  and recompute-on-read are banned.
- **Slack**: the team workspace is clientconversion-io.slack.com. Delivery needs a bot token or
  incoming webhook — ask Alex for it as setup step 0 (env var `SLACK_BRIEF_WEBHOOK_URL` or bot
  token + channel/DM id).

## 4. Per-ad DM conversations: the data ALREADY EXISTS (read this carefully)

Full DM conversations are already captured live in CCOS. Do NOT build a capture pipe.

- **`dm_conversation_messages`** — one row per message: `client` (NOTE: values are
  `tyson_sonnek` / `antwan_rarcus`, NOT the `tyson`/`antwan` client_key used elsewhere; build a
  small mapping and use it everywhere), `subscriber_id`, `setter_name`, `conversation_id`,
  `direction`, `channel`, `message_type`, `body`, `sent_at`, `raw_payload`. Coverage as of
  2026-07-04: Tyson 38,471 messages / 2,886 subscribers since April 10; Antwan 6,010 / 469 since
  June 16; ~5,000 messages flowed in the last 48h. It is live and current.
- **`dm_conversation_stage_state`** — an existing per-conversation AI classification layer:
  `goal_clear`, `gap_clear`, `stakes_clear`, `qualified`, `booking_readiness_score`,
  `ai_confidence`, `stage_evidence`, `analysis_version`, `latest_message_at`. Find the code that
  maintains it (grep for the table name) and REUSE it for lead-quality reads in the digest
  instead of building a new classifier. Extend it only if a needed field is missing.

The per-ad join: `dm_conversation_messages.subscriber_id` → `ads_keyword_events.subscriber_id`
(first `dm_keyword` event per subscriber wins) → `keyword_normalized` = the ad. Subscribers with
messages but no keyword event are the organic/unattributed DM bucket; report their count
honestly, digest them under "no ad attributed" rather than dropping them.

Digest inputs per ad per day: that day's messages for the ad's subscribers (both directions),
the stage-state row per conversation, setter_name, and response-gap timings computed from
`sent_at` deltas between lead messages and the next setter message. Historical backfill is
possible from day one (April for Tyson, mid-June for Antwan), so the trend windows can include
DM-quality context immediately.

## 5. The nightly compute job (Phase 2)

New cron `/api/cron/daily-brief` at `45 13 * * *` UTC (9:45 AM EDT / 8:45 AM EST — either way the
brief is ready before 10:15 ET; note the DST drift in a comment and accept it).

Pipeline steps, each idempotent, each logged to a `brief_runs` table (id, run_date, step,
status, detail, duration_ms) so failures are diagnosable:

1. **Fresh-sync**: trigger the existing Meta insights sync and sales-tracker sync for both
   creators (reuse existing sync routes/functions). Wait/verify completion.
2. **Freshness gate** (rule 7). Record per-source status.
3. **Compute metrics** for each creator × each window (yesterday-ET, 3d, 7d, 14d) using the
   canonical attribution path (rule 1): spend, DMs (rule 2), cost/DM, booked calls, cost/booked,
   booking rate (booked ÷ DMs), calls taken, show rate (taken ÷ booked that were due in window),
   closes, collected cash (sales-tracker, ET day), attributed cash, ROAS-floor (attributed ÷
   spend, same window both sides), attribution coverage %. Store as one JSONB row per day in a
   new `daily_brief` table (`run_date date primary key, data jsonb, created_at`). Compute once,
   store, render from the store.
4. **Per-ad yesterday detail** (funded ads only, spend ≥ $20 yesterday OR ≥ $50 in 7d): spend,
   DMs, cost/DM, booked, plus the ad's on-image first line from `ad_creative_copy` so Alex knows
   WHICH ad without opening Ads Manager.
5. **DM digests per ad** (the centerpiece): for each keyword with ≥1 new DM yesterday, pull that
   day's conversations from `dm_conversation_messages` (Section 4 join), and write a digest with Claude (model: `claude-sonnet-5`,
   temperature low, prompt-cached system block): lead count and quality read (real prospects vs
   junk, with N of M counts — banned words: "largely", "mostly", "some" without a number),
   dominant themes in the leads' own words (1-3 short verbatim quotes, pick representative not
   vivid), objections that appeared (with counts), setter handling notes (response gaps > 4h
   flagged with counts, conversations that died after a money objection, etc.), and outcomes
   (booked / still talking / gone quiet). Cap each digest at ~120 words. Store in
   `dm_digests (run_date, client_key, keyword_normalized, digest_md, leads, quotes jsonb)`.
   Lead-quality classification: reuse `dm_conversation_stage_state` (qualified,
   booking_readiness_score) where a row exists; fall back to a `claude-haiku-4-5` per-conversation
   classification, cached, stored, never recomputed.
6. **Anomaly scan** (rules first, no AI needed; store hits in the daily_brief JSONB):
   - source stale / reconciliation drift (rules 7-8) → RED
   - per ad set: yesterday spend > 2x or < 0.4x its own trailing-7d daily average → AMBER
   - cost/DM yesterday > 2x trailing-7d average (min 5 DMs) → AMBER
   - funded ad ($30+ yesterday) with 0 DMs → AMBER
   - booking rate (3d) < half of the 14d rate, min 20 DMs → AMBER
   - keyword-capture leak: % of yesterday's tagged leads with no keyword, vs 14d baseline;
     > 2x baseline → AMBER (this is the ManyChat config leak detector)
   - unattributed cash yesterday > $500 → AMBER with the named sales
   - any ad/adset/campaign status changed vs yesterday's snapshot (paused, disapproved, budget
     changed) → listed factually under "Changes detected" (snapshot config daily into the
     daily_brief JSONB to diff)
   - each anomaly renders as one line: what, the numbers, and "what to check," never a directive.
7. **Deliver to Slack** (Phase 3 format below). If ANY pipeline step failed, deliver whatever is
   trustworthy plus a clear header listing what's missing and why. Silence is the only forbidden
   outcome: if the whole run dies, send "Brief failed at step X: <reason>" so Alex never wonders.

## 6. The brief format (Phase 3)

Slack message, in this exact order. Tables as monospace code blocks (Slack has no real tables);
keep each table ≤ 60 chars wide so mobile doesn't wrap. Long DM digest section goes on a linked
CCOS page (`/brief/[date]`, auth-gated, rendered from the stored JSONB — the Slack message
carries the 3 most important digests inline and links the rest).

1. **Header**: date, data-health line ("All 5 sources fresh · cash reconciled to the dollar ·
   coverage 94%") or the RED/AMBER banner.
2. **Yesterday, per creator** (two compact tables: Tyson, Antwan): Spend / DMs / $per DM /
   Booked / $per Booked / Taken / Closes / Cash / ROAS-floor.
3. **Per-ad yesterday** (funded ads only, one line each): `GYM  $118  61 DMs  $1.93  4 booked` +
   first line of the ad's on-image copy. Starved count noted underneath.
4. **Anomalies** (or "No anomalies. All ad sets inside their normal ranges.").
5. **DM conversations** (the centerpiece): top 3 digests inline (highest-spend keywords), link to
   the full per-ad digest page for the rest.
6. **Trend windows** (one compact table per creator, rows = 1d / 3d / 7d / 14d, columns = Spend,
   DMs, $/DM, Booked, $/Booked, Book%, Cash*, ROAS*): asterisk footnote "1d/3d cash is a floor;
   sales lag 1-14 days. Booked calls are the early signal."
7. **Open bets watch**: pull active decisions from `cmo_impact` (status decided/executed, window
   not yet graded) and show each one's live numbers vs its baseline (e.g., "GYM graduation day 2:
   $54 spent, 3 booked at $18/DM. Baseline to beat: $184/booked."). No grading, just the tape.
8. **Footer**: one line on how numbers are made + the timezone note + link to `/brief/[date]`.

Tone: plain, zero hype, zero advice. Numbers with nouns. It should read like a competent human
analyst wrote it before you woke up.

## 7. Build order and acceptance criteria

Phase 1 (DM digest engine on the existing tables) → Phase 2 (compute job) → Phase 3 (delivery +
page). Ship each phase only when its checks pass:

- **P1 accepted when**: for 3 recent real days, the per-ad digests are generated and a human
  spot-check of 5 conversations per creator confirms the digest faithfully reflects the actual
  message bodies (right quotes, right outcomes, counts match). The keyword join is validated:
  digested subscriber counts per keyword reconcile with `ads_keyword_events` dm_keyword counts
  for the same day, and the unattributed-DM bucket is reported, not dropped.
- **P2 accepted when**: run the job against the LAST 7 REAL DAYS (backfill mode) and reconcile
  each day's output against the Ads tab and the sales tracker by hand: collected cash to the
  dollar, DM counts match the Ads tab's `messages` for the same window, ROAS matches the Ads tab
  for the same window and creator. Any mismatch is a bug in THIS job, not in the Ads tab. Also:
  kill one source's sync intentionally and verify the RED banner renders instead of stale numbers.
- **P3 accepted when**: the brief arrives in Slack before 10:15 AM ET three days running, renders
  correctly on a phone, the /brief page renders the full digest set, and Alex says the DM section
  actually tells him what conversations were like (this is subjective and he is the judge; expect
  one round of his comments and fold them in).

Estimated effort honestly: P1 ~1 day; P2 ~2-3 days with the backfill reconciliation; P3 ~1 day.
Do not compress by skipping the backfill reconciliation or the digest spot-check — those steps
ARE the trust.

## 8. What NOT to do

- Don't build a new dashboard tab beyond the minimal `/brief/[date]` page. Alex killed a "Pulse"
  tab before: rendering numbers he already has in the Ads tab is clutter. The brief is a PUSH
  artifact.
- Don't add automated kill/scale actions or Meta rules. Decisions stay human + weekly.
- Don't touch the Google Sheets. Ever. Read-only via the existing sync.
- Don't re-derive or "fix" attribution in this job. Rule 1.
- Don't average calendar-30-day for run rates anywhere; daily pace = last-7-day pace.
- Don't let any AI-written digest assert a count it didn't compute ("most leads were X" needs
  N of M in the stored data).
- Don't schedule anything while a broken state is live; fix forward, then schedule.

## 9. Setup questions for Alex (ask these first, then build without further questions)

1. Slack destination: DM or a #daily-brief channel? (Recommend a private channel so Matt/Will can
   read it too.) Provide the webhook/bot token.
2. Confirm 10:15 AM ET delivery target.

— End of spec. Build it so the owner can trust it blind at 10:15 every morning.
