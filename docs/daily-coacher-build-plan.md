# Daily Coacher — Build Plan

Internal CCOS tool for coaches: AI-generated draft messages per client based on coach-fed context. Lives inside the existing `/coaching` section.

## Hard constraints (non-negotiable)

- No Everfit integration of any kind. Coach is the sole source of truth.
- No biometric/progress data stored (Progress Tracking topic generates response messages only).
- No specific macros in nutrition suggestions. General principles only. Nutrition PDF never parsed.
- Rolling 20-message context window per client (store all, query latest 20).
- Persistent summary always primary context for every topic generation.
- **Do not modify existing CCOS coaching UI.** Single approved change to existing surfaces: a star/icon button on each Client Roster row, immediately left of "Edit", linking to `/coaching/daily-coacher/[clientId]`. Everything else is net-new files.
- Do not modify sales code (`src/app/sales/`, `src/app/sales-hub/`). Shared libs in `src/lib/` may be added to (not modified).

## Architectural commitments (locked)

- **Entry point:** Star icon button on each Client Roster row, left of Edit → `/coaching/daily-coacher/[clientId]`. Roster's existing coach filter handles per-coach scoping.
- **Data reuse:** `clients` (extend with new columns), `client_notes` (read AND write — Daily Coacher coach-notes input writes here, single source of truth with the existing roster), `coach_meetings.notes` (read), nutrition intake via `nutrition_form_id` (read).
- **New tables:** `daily_coacher_live_messages`, `tips_library`.
- **Summary inputs:** nutrition intake + `coach_meetings.notes` + Fathom onboarding transcript + `client_notes` + recent 20 live convos.
- **Summary regen:** Lazy + manual. Compare `clients.daily_coacher_summary_updated_at` against `MAX(updated_at)` across input tables on view-open; regen if stale. "Refresh summary" button always available.
- **Fathom:** Read existing `onboarding_fathom_link` field on `clients` (already in the Edit Client modal). Extract meeting ID, fetch transcript via shared `src/lib/fathom.ts`, cache transcript text on the client row keyed by URL so we refetch on link change.
- **Coach identity:** Reuse the existing pattern (filter by `coach_name` string via the dropdown on Client Roster). No email mapping, no new RLS — same trust model as the rest of CCOS.
- **Topics:** All 14 ship at launch, rolled out one at a time. Each topic gated on user tip approval before going live in the UI.
- **Tips:** I draft ~15 per topic. User approves per topic. Editable via a light admin UI (no redeploys to tune output).
- **Prompt caching:** System prompt + persistent summary form the cached prefix. Topic + recent 20 messages + tips form the per-call delta.

## Phases (gated)

### Phase 1 — Schema foundation
- New columns on `clients`:
  - `daily_coacher_summary` (text)
  - `daily_coacher_summary_updated_at` (timestamptz)
  - `onboarding_transcript_cached` (text)
  - `onboarding_transcript_fetched_at` (timestamptz)
  - `onboarding_fathom_link_fetched_for` (text — stores which URL the cache was built from, for change detection)
- New table `daily_coacher_live_messages`: `id`, `client_id` (fk), `role` (`'coach' | 'client'`), `message` (text), `created_at` (timestamptz). Read with `ORDER BY created_at DESC LIMIT 20`. Store all, no FIFO delete.
- New table `tips_library`: `id`, `topic` (text), `tip_text` (text), `applies_to_tags` (jsonb), `weight` (int default 1), `approved` (bool default false), `created_at`, `updated_at`.
- RLS: match existing pattern (read-all anon, write via service role).
- Migration written as new SQL file in `supabase/`.
- Verify exact column name of the existing onboarding Fathom link field on `clients` before writing the migration (screenshot shows the field; need DB column name).
- **Done when:** SQL applied, types regenerated via `generate_typescript_types`, no breaking changes to existing tabs.

### Phase 2 — Fathom transcript fetcher
- Confirm/add `getMeetingTranscript(meetingId)` in `src/lib/fathom.ts` (sales-hub weekly-report already fetches transcripts at `https://api.fathom.ai/external/v1/meetings/{id}/transcript` — pull that into the shared lib if not already there).
- Helper: `getOnboardingTranscript(client)` — checks cache, refetches if `onboarding_fathom_link` differs from `onboarding_fathom_link_fetched_for` or cache is empty. Stores result, returns text. Returns null gracefully if link missing or API fails.
- URL parser: extract meeting ID from the Fathom share URL format coaches paste.
- **Done when:** Given a client row with an onboarding Fathom link, helper returns transcript text or null. No errors thrown on missing/bad links.

### Phase 3 — Summary generator (core)
- New file: `src/lib/daily-coacher/summary-generator.ts`. Mirrors the [src/lib/nutrition/plan-generator.ts](../src/lib/nutrition/plan-generator.ts) pattern.
- System prompt (cached via `cache_control`) instructs Claude how to write a coaching-context summary: goal, journey type, days remaining, restrictions/lifestyle/history, last meeting takeaway, current sentiment.
- User prompt stitches: intake form structured fields → meeting notes (chronological) → Fathom transcript → client notes → recent live messages.
- Output: formatted text, stored on `clients.daily_coacher_summary`, timestamp on `daily_coacher_summary_updated_at`.
- API routes:
  - `POST /api/coaching/daily-coacher/[clientId]/summary` — regenerates on demand
  - `GET /api/coaching/daily-coacher/[clientId]/summary` — returns current summary + staleness flag (computed via timestamp comparison)
- **Done when:** Hitting the regen endpoint for any client returns a coherent summary that incorporates all available inputs.

### Phase 4 — Per-client view shell (no topic generation yet)
- New page: `src/app/coaching/daily-coacher/[clientId]/page.tsx`.
- Layout top-to-bottom:
  1. Persistent summary panel (with refresh button + "updating..." state)
  2. Topic selector (all 14 topics rendered; phase-elevated ones styled differently)
  3. Coach notes input (writes to existing `client_notes` API → reuse, single source of truth)
  4. Live convo input (writes to `daily_coacher_live_messages`)
  5. Placeholder for generated draft area (filled in Phase 6)
- Phase mapping codified in `src/lib/daily-coacher/phase-suggestions.ts` (TS config, not DB) — tunable without migrations.
- Wire lazy-regen check on page load (call `GET .../summary`, regen if stale).
- Match existing CCOS card/tab styling (Tailwind + custom CSS variables from `globals.css`).
- **Done when:** Can navigate to the page from the roster, see a generated summary, add notes/messages, summary regen indicator works.

### Phase 5 — Roster integration
- Add small icon button (lucide `Sparkles` or `MessageSquare`) to row in [src/components/coaching/ClientRosterTab.tsx](../src/components/coaching/ClientRosterTab.tsx) immediately left of "Edit". Tooltip: "Daily Coacher".
- Routes to `/coaching/daily-coacher/[clientId]`.
- Zero changes to Edit modal, search, filters, or any other roster behavior.
- **Done when:** Coaches can launch Daily Coacher from any client row. Roster otherwise identical.

### Phase 6 — Topic generator framework + topics one at a time
- New file: `src/lib/daily-coacher/topic-generator.ts`. Single function: `(clientId, topic) → draft message`.
- Per-topic prompts in `src/lib/daily-coacher/topics/<topic>.ts` files. Each exports system prompt + tip-filtering logic.
- Tip selector: pulls 1–3 from `tips_library` filtered by topic + client tags + weight.
- API route: `POST /api/coaching/daily-coacher/[clientId]/generate` — body `{ topic }`, returns draft.
- UI: clicking a topic + "Generate" populates the draft area with copy-to-clipboard button.
- **Per-topic gate:** For each of 14 topics: I draft ~15 tips → user reviews & approves → I wire that topic into the UI. First topic doubles as framework checkpoint.
- **Suggested topic order:** Onboarding Momentum → Nutrition → Training → Accountability → Meeting Follow-up → Recovery → Mindset → Motivation → Progress Tracking → Meeting Prep → Retention → Celebration → Recalibration → Lifestyle Integration.
- **Done when:** All 14 topics generate quality drafts the coach can copy into Everfit.

### Phase 7 — Tips library admin UI
- Minimal admin page: `/coaching/daily-coacher/tips`. List/edit/approve/disable tips per topic.
- Built alongside the first topic in Phase 6 so user has the workflow ready for tip review across all 14.

### Phase 8 — Polish
- Empty/error states (no Fathom link, no intake form linked, no notes yet, Fathom API failure → graceful degrade).
- Loading skeletons.
- Mobile responsiveness check.
- Verify RLS posture matches the rest of the app.

## Phase-suggestion mapping (starting proposal — confirm vs. CCOS programming reality during Phase 4)

| Phase | Window | Topics elevated |
|---|---|---|
| Onboarding | Days 0–14 | Onboarding Momentum, Motivation, Nutrition, Training |
| Early program | Days 15–30 | Accountability, Nutrition, Training, Lifestyle Integration |
| Mid-program | 30–70% through | Mindset, Recovery, Progress Tracking, Recalibration |
| Late mid | 70–85% through | Celebration, Mindset, Progress Tracking, Recalibration |
| End game | Last 14 days | Retention, Celebration, Progress Tracking |
| Meeting-adjacent | 24–48hr before/after scheduled meeting | Meeting Prep / Meeting Follow-up surfaced |

Suggestions are visual elevation only — coach can always pick any of the 14.

## Open items resolved at execution time

- Exact column name on `clients` for the onboarding Fathom link (verify before Phase 1 migration).
- Live message paste UX — single textarea with `Coach:`/`Client:` line prefixes vs. structured Add-message form. Prototype both during Phase 4, pick lower-friction option.

## Resumption checklist for next session

1. Re-read this doc.
2. Confirm Phase 1 schema before writing the migration.
3. Apply migration → regenerate types → start Phase 2.
