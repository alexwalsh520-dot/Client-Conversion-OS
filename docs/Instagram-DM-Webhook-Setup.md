# Instagram DM Webhook Setup

This powers direct Instagram DM metrics for the Outreach page.

## What it does

- Receives live Instagram DM webhook events from Meta
- Stores them in `dm_conversation_messages`
- Re-scores the thread in `dm_conversation_stage_state`
- Feeds the Outreach dashboard with real DM numbers

## Endpoint

- Verification + webhook URL:
  - `/api/webhooks/instagram`

## Required env vars

- `INSTAGRAM_DM_WEBHOOK_VERIFY_TOKEN`
- `OUTREACH_DM_CLIENT_FILTER`
- `OUTREACH_DM_SOURCE_NAME`

## Optional env vars

- `INSTAGRAM_DM_CLIENT_KEY`
  - defaults to `matthew_conder`
- `INSTAGRAM_DM_SETTER_NAME`
  - defaults to `Matthew Conder`
- `INSTAGRAM_DM_ACCOUNT_ID`
  - filters events to one Instagram account when set
- `INSTAGRAM_DM_ACCOUNT_USERNAME`
  - label only

## Existing env var reused

- `META_APP_SECRET`
  - used to validate `X-Hub-Signature-256`

## Meta app setup

1. Connect the Matthew Conder Instagram professional account to a Meta app.
2. Add the webhook callback URL:
   - `https://client-conversion-os.vercel.app/api/webhooks/instagram`
3. Set the verify token to match `INSTAGRAM_DM_WEBHOOK_VERIFY_TOKEN`.
4. Subscribe the app to Instagram messaging events.
5. Send a test DM and confirm rows land in `dm_conversation_messages`.

## Important note

This path is best for clean tracking going forward. If old DM history is needed, backfill will need an export or a separate sync path.
