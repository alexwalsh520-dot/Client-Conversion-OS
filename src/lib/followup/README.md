# AI Follow-Up System

Tag-triggered Instagram DM follow-up system. Setter taps `AI-FOLLOWUP` in ManyChat, system auto-sends 4 follow-ups inside the 7-day Meta window with epsilon-greedy variant rotation, cancels on reply, closes conversation after no-reply.

## Data flow

```
ManyChat (setter tags AI-FOLLOWUP)
  └─ External Request → POST /api/followup/tag-added
      └─ scheduleFollowups()  inserts 5 rows in followup_jobs
                              (slots 2–5 + close)

Vercel cron (every minute)
  └─ GET /api/cron/followup-drain
      └─ drainDueJobs()
          ├─ claim pending jobs where scheduled_at <= now()
          ├─ loadEligibleVariants (client, slot, subscriber) → pool
          ├─ pickVariantEpsilonGreedy(pool) → chosen
          ├─ sendVariantAsDM via Graph API (graph.instagram.com)
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
| 4 (AI) | +48h | T+72h 15m |
| 5 (AI) | +48h | T+120h 15m |
| close | +24h no reply | T+144h 15m |

All inside Meta's 7-day messaging window.

## Variant library

Per (client, slot) we keep 5+ message variants in `followup_variants`. The scheduler:
- **Never shows a lead the same variant twice** (dedup via `followup_sends.subscriber_id`).
- **Picks via epsilon-greedy**: 80% pick current best-performer (by reply rate), 20% explore. Under 15 sends per variant, we bias toward cold variants to avoid locking in noise.
- **Auto-attributes replies**: any inbound message within 72h of a send credits that variant's reply-rate.

Seed variants for Amara (client `tyson_sonnek`) are in `supabase/migrations/012_followup_variants_amara_seed.sql`. Voice is lifted from her actual DMs: casual, "yo", "g", "aight", name pings, `^` bumps.

## Files

- `supabase/migrations/011_followup_system.sql` — tables, views, RPCs
- `supabase/migrations/012_followup_variants_amara_seed.sql` — starter variants
- `src/lib/followup/cadence.ts` — default cadence constants
- `src/lib/followup/variants.ts` — epsilon-greedy picker
- `src/lib/followup/send.ts` — Graph API sender + DM logging
- `src/lib/followup/scheduler.ts` — schedule / drain / cancel
- `src/app/api/followup/tag-added/route.ts` — ManyChat webhook
- `src/app/api/cron/followup-drain/route.ts` — per-minute cron
- `src/lib/instagram-dm.ts` — modified: calls `cancelPendingAndAttributeReply` on inbound
- `vercel.json` — added `* * * * *` cron entry

## Env vars required

Already present in `.env.local` / Vercel prod:
- `MANYCHAT_WEBHOOK_SECRET` ✓
- `CRON_SECRET` ✓
- `SUPABASE_SERVICE_ROLE_KEY` ✓ (via `getServiceSupabase`)

Must be set for production (already used by `instagram-dm-send.ts`):
- `INSTAGRAM_DM_ACCESS_TOKEN` — long-lived Page Access Token for The Forge's IG
- `INSTAGRAM_DM_ACCOUNT_ID` — the Instagram Business Account ID
- `INSTAGRAM_DM_API_VERSION` (optional, defaults to `v24.0`)
- `META_APP_SECRET` ✓

## ManyChat setup

1. Create tag `AI-FOLLOWUP` (and `AI-CLOSED` for the close-tag flow).
2. Create a rule: **When `AI-FOLLOWUP` is applied** → **External Request**:
   - Method: `POST`
   - URL: `https://<your-vercel-domain>/api/followup/tag-added`
   - Headers:
     - `Content-Type: application/json`
     - `x-manychat-secret: <MANYCHAT_WEBHOOK_SECRET value>`
   - Body (JSON):
     ```json
     {
       "client": "tyson_sonnek",
       "subscriber_id": "{{contact.ig_id}}",
       "setter_name": "amara",
       "lead_name": "{{contact.first_name}}",
       "phone": "{{contact.phone}}",
       "first_msg_at": "{{system.current_datetime_iso}}"
     }
     ```

## Deploy steps

1. **Run SQL migrations** in Supabase SQL Editor (order matters):
   - `supabase/migrations/011_followup_system.sql`
   - `supabase/migrations/012_followup_variants_amara_seed.sql`
2. **Verify env vars** in Vercel project settings — especially `INSTAGRAM_DM_ACCESS_TOKEN` and `INSTAGRAM_DM_ACCOUNT_ID`.
3. **Deploy** (`git push` or `vercel --prod`).
4. **Wire up ManyChat** (above).
5. **Smoke test**:
   - Tag a test lead with `AI-FOLLOWUP`
   - Verify 5 rows appear in `followup_jobs` with future `scheduled_at`
   - Wait ≥16 min, confirm slot-2 fires (`followup_sends` row + actual DM received)
   - Reply from test account → confirm pending jobs go to `cancelled`, send gets `replied_at` set.
