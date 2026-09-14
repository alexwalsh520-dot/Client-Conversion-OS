# Everfit Inbox

Coaching → Inbox reads durable one-to-one conversation messages. This is separate from weekly Everfit summaries: saving messages does not call an AI model, and later reporting can read these rows. The CCOS client roster remains authoritative and unchanged.

## Storage and access

Migration `20260914092850_everfit_inbox.sql` (followed by `20260914094103_everfit_inbox_source_order.sql`) adds conversations, messages, sync runs and per-run items. It was applied to CCOS project `bostjayrguulwaltnbgt`. All tables have RLS and revoke PUBLIC/anon/authenticated access. NextAuth protects the `/api/coaching/inbox` route, which uses the existing server-only Supabase client. Administrators import; all authenticated users with Coaching access can read the shared team inbox, including unlinked clients. This is the explicit team-sharing policy requested for Inbox and does not change weekly report permissions. Client matches require a unique normalized exact email, never a name. Identity changes fail closed.

Messages are keyed by `(everfit_id,message_id)`. Repeated captures update the same observed message rather than append duplicates. Conversation metadata, message upserts and capture status are committed in one transaction. Missing messages are never treated as deletions. Captures from older than the last observation are rejected. Exact historical revisions and deletion detection are not implemented.

## On-demand Codex sync procedure

1. Verify CCOS database access, then open the user's signed-in Everfit browser and CCOS session. No credentials should be copied into capture files or source code.
2. Read `/api/coaching/inbox` with pagination (`nextOffset`) or query the conversation table through Supabase to obtain stored `checkpoint_id`, `synced_through` and `history_complete` per Everfit client. Inspect running/partial runs before starting another. A roster captured from only one coach must never be declared team-wide.
3. Enumerate the full Everfit inbox scope, including archived conversations when available, and verify coach ownership plus client identity. Use the existing collector's plan shape: each entry has `id`, `name`, `owner`, with optional training/task percentages and last-access display. These metrics are not used by Inbox.
4. Start a run through POST `{action:"start", rosterComplete:true, plan:[...]}`. Set `rosterComplete:false` for incomplete scopes. Save the run ID. Use the separate `/coaching/inbox-sync` page: fill **Sync payload**, click **Submit batch**, read the compact result. This uses the same-origin authenticated admin session. The normal Inbox has no import controls. Maximum request size is 3 MB.
5. For each DM, verify the client identity, load the newest messages, and scroll back until the previous stored checkpoint is actually encountered. For first capture, reach the genuine start of conversation; a weekly date boundary is not the start. Capture stable native message IDs, not content hashes or row positions. Preserve chronological source order, oldest to newest. Never use names alone to associate clients or fabricate dates, senders or messages.
6. Import `{action:"capture", runId, capture:{id,email,owner,capturedAt,messages,updates:[],notes:[],newestReached,historyStartReached}}`. Messages use `{id,date,time,sender,text,attachments}`; sender is `coach`, `client`, or `unknown`. `capturedAt` is ISO time within this run and the last day. `date` and `time` preserve the visible Everfit strings. Notes describe capture limitations. The old collector's `historyComplete` means a weekly boundary and is deliberately ignored by this inbox.
7. `newestReached` is true only after verifying the newest edge of the DM. `historyStartReached` is true only after actually reaching the start. The database advances the checkpoint only when newest is verified AND either full start or the old checkpoint is present. Empty DMs require explicit verification of both boundaries. For histories beyond the 4,000-message/3 MB request limit, persist batches as incomplete and retain coverage evidence; do not claim completion from a truncated batch. The current API requires a final capture containing the verified boundary evidence. A richer multi-batch collector remains future work.
8. GET `?runId=...` to identify missing/incomplete items. Failed captures stay pending; existing messages and last successful checkpoints remain. POST `{action:"finish",runId}` computes completion from the saved items and roster coverage. Partial runs can be reopened with `{action:"resume",runId}`. Do not equate a successful HTTP upload with complete coverage.
9. Re-open Inbox, inspect representative conversations, and report verified coverage as of the run's start time, the conversation count and any gaps. Never say the entire inbox is current if roster coverage or a conversation is incomplete. New messages may arrive while a run is underway.

## Current limits

The initial UI supports coach filtering, client/coach search and paginated messages. Messages are ordered by native message ID using the C collation. Everfit’s rendered inbox was checked against its visible chronology; mixed-case keys must not use locale collation. Displayed relative dates are stored as observed, not parsed into invented absolute times. Attachment presence is retained but attachment files, reactions, read receipts, sender display names and transcripts are not copied yet. This is a text inbox foundation, not full Everfit visual parity. The existing browser extension still targets weekly summaries; it does not automatically route its captures to Inbox. Codex can import reviewed captures using the separate authenticated sync page. The Inbox Sync button uses the version 0.2.0 Chrome reader. It enumerates the entire team roster and imports conversations plus activity in batches. The reader needs one-time installation; no cloud scraper is enabled.

## Checks

- `node --import tsx --test src/lib/inbox/validation.test.ts`
- `node node_modules/eslint/bin/eslint.js src/lib/inbox src/app/api/coaching/inbox src/components/coaching/InboxTab.tsx`
- `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`

An isolated Postgres/PGlite check exercised the schema, atomic imports, idempotent retries, gap handling, completion calculation and denied browser-role reads/calls. Live table/RLS/grant introspection passed. The Supabase connector's direct SQL endpoint is read-only, so DML verification through it is unavailable; deployed authenticated API verification is separate.

Focused production build passed for both routes. Unauthenticated GET and POST returned 401. Local browser verification passed for conversation opening and coach filtering.

## Efficient bulk ingestion

Use POST `{action:"batch",runId,captures:[...]}` for 1–50 conversations and at most 3 MB per request. The API reads the client roster once and sends one database RPC for the batch. A rejected conversation rolls back only its own changes; other captures are saved. Results contain counts, IDs needing more history and failed IDs; message bodies are never echoed. Retrying the batch is idempotent because native message IDs are unique. Import this payload using the separate sync page. The batch function requires migration `20260914094852_everfit_inbox_bulk_capture.sql`.

The connected SQL tool uses `supabase_read_only_user`; even direct INSERT is rejected. This is independent of CCOS's existing service-role write connection. Bulk ingestion uses the authenticated CCOS backend, so it does not require broader SQL connector access.

For token-efficient browser work, keep captures in the browser-tool session and transfer the serialized batch directly into `/coaching/inbox-sync` → **Sync payload** → **Submit batch**. Return only counts/checkpoints while collecting. Read rendered Everfit DOM through supported browser APIs; never extract cookies or call private Everfit APIs. The reusable `ccos-inbox-sync` skill documents this workflow.

The Inbox UI uses a compact coach filter and search within its conversation sidebar, date-separated chat bubbles, and a mobile back navigation. Relative source dates are displayed against the message observation date so they do not remain “Today” forever.

## Team sync and activity

Migration `20260914103348_inbox_activity_snapshot.sql` adds a per-client recent-activity snapshot. `activityCaptured:true` replaces that snapshot with `updates` and timestamps it; absent activity never clears existing data. The read API returns it with the conversation.

`Sync all coaches` talks to the Chrome reader through the existing origin-scoped bridge. The new inbox job is separate from weekly reports. Download `/downloads/ccos-everfit-sync.zip`, unzip, and load the extracted directory using Chrome's Load unpacked control. No cookie or additional host permissions were added. The reader requires an administrator CCOS session and an Everfit session with access to each coach. Missing client/inbox access is recorded as a failure, not as an empty inbox. Team members can read all conversations; import is admin-only.

The initial run also registers the complete discovered roster in the UI; clients awaiting capture are explicitly marked Not synced yet. Full-history reads stop at a stored checkpoint or repeated stable top-of-history checks. Large histories beyond the capture limit remain partial. Activity is a snapshot with relative source labels and an as-of time, not an inferred complete event history.
