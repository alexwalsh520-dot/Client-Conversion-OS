# Everfit coaching reviews

The Coaching Hub now has an Everfit tab for reviewed weekly client summaries. It supports coach views, report history, search, retention watch, activity metrics, client briefs, and client-specific questions. The report import accepts the reviewed pilot export; real client data must never be checked into this public repository.

## Deploy and import

1. Apply `supabase/migrations/20260912010825_everfit_weekly_reviews.sql` to the existing CCOS Supabase project. This creates service-only tables and two transactional functions. It does not modify existing client rows.
2. Use the existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, NextAuth settings, and optional `ANTHROPIC_API_KEY`. Do not paste credentials into source files. `EVERFIT_AI_MODEL` optionally overrides the existing CCOS default model for client questions.
3. Deploy the branch through the normal CCOS preview/review process. Sign in as an administrator and open Coaching → Everfit → Import a reviewed report.
4. Choose the internal CCOS coach name, select the local JSON export, review the preview, and save. The server rechecks emails against the current roster before storing the report. The preview intentionally shows no verified links until that server check runs.
5. Verify report history and the saved client matches. Existing recognized coach login emails can access their coach reports. Admin-only coach access settings support alternate active CCOS login emails with Coaching permission.

## Data and authorization

- `everfit_reports`: immutable report documents, source-normalized content hash, importer, capture/review metadata.
- `everfit_client_links`: foreign keys from each report's verified Everfit identities to `clients.id`.
- `everfit_coach_access`: explicit alternate coach login mappings.
- `everfit_questions`: persisted questions/answers with report identity, model, status, and actor. A transactional reservation limits each actor to five questions per minute across server instances.

All four tables enable RLS and revoke browser roles. Server routes authenticate through NextAuth and use the existing server Supabase client. Coaches can read only assigned coach views; clients transferred to another coach or owned by a different Everfit coach are excluded from the former coach's detail response. Administrators retain visibility to investigate assignment mismatches. This initial release is for staff, not an end-client portal.

Imports are atomic: a failed foreign-key insert rolls back the report. Re-importing normalized identical source data returns the existing report. Revised input creates a new snapshot. Supplied match flags, foreign keys, source URLs, and live snapshots are not trusted. Unique email matches are verified server-side; contradictory candidates and duplicate emails stay unlinked. Name candidates remain provisional. No import updates the existing client roster.

The dashboard distinguishes historical end dates from current dates on verified client records. Native Everfit percentages use Everfit's reporting window. Activity counts from the pilot are lower bounds, and missing values are not treated as zero. Report precision and media limitations remain visible.

## Import shape

The existing pilot JSON shape is accepted: `timezone`, `review_date`, `window.precision`, `coverage.notes`, and `clients`. Coach name is selected separately, not inferred from a client name. Client records contain `everfit_id`, `name`, `everfit_owner`, optional `ccos_candidate_id`, `matched_email` or `everfit_email`, summary, next step, issue, priority, action owner/due, end date, native metric percentages, last app access display, and four `activity_observed_minimum` counts.

Imports are bounded to 2 MB and 1–600 clients; duplicate Everfit IDs reject the whole import. Canonical reports may specify timezone-qualified `window_start` and `window_end` exactly seven days apart. Absent timestamps force a preliminary report. An explicitly verified report may set `preliminary: false`. The parser strips unrecognized fields, including raw chat transcripts.

## Cadence and current limitations

Saturday at 18:00 Asia/Karachi is the requested initial cadence. The tested window helper returns the last completed Saturday boundary, including the instant at 18:00, independent of host timezone. No recurring job has been enabled: the user requested pilot validation before final scheduling. This change consumes reviewed captures; it does not implement an unattended Everfit browser scraper or transcribe voice/image attachments.

The contextual question endpoint uses the selected brief plus the current verified client row. It does not yet retrieve all meetings, financial transactions, or entire conversations. It cannot send messages or modify clients. Answers are generated and saved when asked; a failed generation does not claim success. End-to-end AI generation needs the existing CCOS AI key and connected database.

The report list currently returns the latest 200 accessible reports. Pagination and a client-facing portal can be added separately when the pilot is validated.

## Validation

- `node --import tsx --test src/lib/everfit/everfit.test.ts`
- `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`
- `npx eslint src/lib/everfit src/app/api/coaching/everfit src/components/coaching/EverfitTab.tsx src/components/coaching/everfit`

The migration was executed in a temporary local PGlite Postgres instance. Checks covered the full migration, service-role insert, retry deduplication, atomic rollback on a missing client FK, question throttling, denied anonymous/authenticated reads and function execution, and enabled RLS on all four tables. The live Supabase project was not available for verification. All five GET/POST endpoint combinations returned HTTP 401 without a session in a localhost production-server smoke test.

A selective production build compiled `/coaching` and all three new API routes. Next 16.1.6's CLI selective-build parser ignores `src/app` paths; validation passed explicit resolved route paths to Next's build function rather than treating an empty selective build as success. The repository-wide TypeScript check passed. The React dashboard was rendered with local pilot data and checked for search, client details, and retention filtering.
