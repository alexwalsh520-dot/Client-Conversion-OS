# AI Follow-Up System

Tag-triggered Instagram DM follow-up system. Setter applies `AI-FOLLOWUP` in ManyChat, the app sends 5 timed follow-ups, stops when the lead replies, removes the follow-up tag, and adds `AI-CLOSED` on day 7 if there is still no reply.

## Data flow

```
ManyChat (setter tags AI-FOLLOWUP)
  └─ External Request → POST /api/manychat-tag
      └─ scheduleFollowups() inserts 6 rows in followup_jobs
                             (slots 2–6 + close)

Supabase cron (every minute) or any minute scheduler
  └─ POST /api/cron/followup-drain
      └─ drainDueJobs()
          ├─ claim pending jobs where scheduled_at <= now()
          ├─ loadEligibleVariants (client, slot, subscriber) → pool
          ├─ pickVariantEpsilonGreedy(pool) → chosen
          ├─ sendVariantAsDM via ManyChat API
          ├─ insert into followup_sends (attribution row)
          └─ mark job sent

Meta Instagram webhook (lead replies)
  └─ POST /api/webhooks/instagram (existing route)
      └─ processInstagramWebhookPayload (existing)
          └─ for each inbound message:
              └─ cancelPendingAndAttributeReply(subscriber_id)
                  ├─ RPC followup_cancel_pending()  → cancels pending jobs
                  └─ RPC followup_attribute_reply() → credits last variant
```

## Cadence (from setter's first message)

| Slot | Gap | Cumulative |
|---|---|---|
| 1 (setter) | — | T+0 |
| 2 (AI) | +15m | T+15m |
| 3 (AI) | +24h | T+24h 15m |
| 4 (AI) | +23h 45m | T+48h |
| 5 (AI) | +48h | T+96h |
| 6 (AI) | +48h | T+144h |
| close | +24h | day 7 |

All inside Meta's 7-day messaging window.

## Variant library

Per `(client, slot)` we keep a variant pool in `followup_variants`. The scheduler:
- **Never shows a lead the same variant twice** (dedup via `followup_sends.subscriber_id`).
- **Picks via epsilon-greedy**: 80% pick current best-performer (by reply rate), 20% explore. Under 15 sends per variant, we bias toward cold variants to avoid locking in noise.
- **Auto-attributes replies**: any inbound message within 72h of a send credits that variant's reply-rate.

The simple workflow refresh is in `supabase/migrations/014_followup_simple_workflow.sql`.

## Files

- `supabase/migrations/011_followup_system.sql` — tables, views, RPCs
- `supabase/migrations/012_followup_variants_amara_seed.sql` — original Tyson variants
- `supabase/migrations/014_followup_simple_workflow.sql` — simple cadence + minimal slot coverage
- `src/lib/followup/cadence.ts` — default cadence constants
- `src/lib/followup/variants.ts` — epsilon-greedy picker
- `src/lib/followup/send.ts` — Graph API sender + DM logging
- `src/lib/followup/scheduler.ts` — schedule / drain / cancel
- `src/app/api/followup/tag-added/route.ts` — ManyChat webhook
- `src/app/api/cron/followup-drain/route.ts` — drain endpoint for minute scheduler
- `src/lib/instagram-dm.ts` — modified: calls `cancelPendingAndAttributeReply` on inbound
- `docs/followup-supabase-cron.sql` — SQL snippet for Supabase Cron

## Env vars required

Already present in `.env.local` / Vercel prod:
- `MANYCHAT_WEBHOOK_SECRET` ✓
- `CRON_SECRET` ✓
- `SUPABASE_SERVICE_ROLE_KEY` ✓ (via `getServiceSupabase`)

Also used by the Instagram reply webhook:
- `INSTAGRAM_DM_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`

## ManyChat setup

1. Create tag `AI-FOLLOWUP`.
2. Create tag `AI-CLOSED`.
3. Create a rule: **When `AI-FOLLOWUP` is applied** → **External Request**:
   - Method: `POST`
   - URL: `https://<your-vercel-domain>/api/manychat-tag`
   - Headers:
     - `Content-Type: application/json`
     - `x-manychat-secret: <MANYCHAT_WEBHOOK_SECRET value>`  
       or keep the old header name `x-forge-secret`
   - Body (JSON):
     ```json
     {
       "client": "tyson_sonnek",
       "subscriber_id": "{{contact.id}}",
       "ig_user_id": "{{contact.ig_id}}",
       "setter_name": "amara",
       "lead_name": "{{contact.first_name}}",
       "phone": "{{contact.phone}}",
       "first_msg_at": "{{system.current_datetime_iso}}"
     }
     ```
4. Meta webhook can stay on `/api/webhooks/instagram` or `/api/instagram-webhook`.

## Deploy steps

1. **Run SQL migrations** in Supabase SQL Editor (order matters):
   - `supabase/migrations/011_followup_system.sql`
   - `supabase/migrations/012_followup_variants_amara_seed.sql`
   - `supabase/migrations/014_followup_simple_workflow.sql`
2. **Verify env vars** in Vercel project settings:
   - `MANYCHAT_WEBHOOK_SECRET`
   - `CRON_SECRET`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MANYCHAT_API_KEY_TYSON`
   - `MANYCHAT_API_KEY_KEITH`
   - `INSTAGRAM_DM_WEBHOOK_VERIFY_TOKEN`
   - `META_APP_SECRET`
3. **Deploy** (`git push` or `vercel --prod`).
4. **Create the minute scheduler** in Supabase Cron using `docs/followup-supabase-cron.sql`.
5. **Wire up ManyChat** (above).
6. **Smoke test**:
   - Tag a test lead with `AI-FOLLOWUP`
   - Verify 6 rows appear in `followup_jobs` with future `scheduled_at`
   - Wait ≥16 min, confirm slot-2 fires (`followup_sends` row + actual DM received)
   - Reply from test account → confirm pending jobs go to `cancelled`, send gets `replied_at` set, and `AI-FOLLOWUP` is removed in ManyChat
