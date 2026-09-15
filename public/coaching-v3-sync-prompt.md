Create my Coaching V3 Everfit sync JSON for TODAY (`captured_at = <ISO 8601 timestamp, Asia/Karachi>`). One file for the WHOLE roster, all coaches, one row per Everfit client. No per-coach files. Return only the downloadable UTF-8 JSON file named `coaching-v3-sync-YYYY-MM-DD.json`. Do not narrate a report in chat — this run is the JSON only.

Use my signed-in browser to inspect Everfit (https://app.everfit.io) directly. Do the review yourself. Do not install an extension, build a sync, schedule work, send messages, or upload the file for me.

Window: the seven full calendar days before `captured_at`, from `captured_at − 7 days` at 00:00 inclusive to `captured_at` at 00:00 exclusive, Asia/Karachi.

For every client on every coach's roster, produce ONE row with:

- `everfit_id` — the client's stable Everfit id (from the URL or the roster ID column). Never reuse. Never invent.
- `name` — the client's name exactly as Everfit shows it.
- `coach` — the coach's internal name (Everfit "assigned coach" / roster owner). Use the same spelling every time (e.g. "Farrukh", "Stef", "Waleed").
- `workouts_completed_7d` — count of workouts marked complete inside the window. Coach-completed count only (weighted total, not an average of client percentages). Unscheduled extras excluded.
- `workouts_assigned_7d` — count of workouts scheduled inside the window. Unscheduled extras excluded.
- `client_replies_7d` — count of CLIENT-authored inbox replies inside the window. Coach messages do not count.
- `activity_7d` — count of meaningful client activity events inside the window: completed workouts, check-ins, logged nutrition, measurements, completed tasks. Coach edits do not count. May duplicate `workouts_completed_7d` in whole or in part — that is expected.
- `last_client_message_at` — ISO 8601 UTC of the client's most recent inbox message across all history. Null if the client has never sent a message.
- `last_coach_message_at` — ISO 8601 UTC of the coach's most recent inbox message across all history. Null if never.
- `summary` — ONE short sentence (max 200 characters) describing what happened with this client in the last 7 days: their tone, progress, any concern. Not a fact dump, not a message quote, just what a coach would tell MAS in one line. Null if you truly have nothing to say.

**Do NOT** include: message text, evidence arrays, day-by-day breakdowns, coverage notes, client-side program dates, days remaining, workout percentages, retention flags, roster totals. CCOS derives those from its own tables. This file is only the freshness overlay for what CCOS cannot see without opening Everfit.

Be fast: enumerate the roster once, count in place. Do not open message threads to read text — only to see the newest timestamp per side. Skip clients whose Everfit archive is inaccessible; report their `everfit_id` and `name` with all numeric fields as null (this is more honest than guessing).

Numeric fields are non-negative integers or null. `workouts_completed_7d` cannot exceed `workouts_assigned_7d`. Timestamps must parse (`Date.parse` in JS accepts them). Everfit ids are unique within a file.

JSON must contain exactly this structure. Do not include Markdown fences in the JSON file.

```json
{
  "schema_version": 3,
  "captured_at": "2026-09-15T18:00:00+05:00",
  "clients": [
    {
      "everfit_id": "abc123",
      "name": "Anthony Vega",
      "coach": "Farrukh",
      "workouts_completed_7d": 3,
      "workouts_assigned_7d": 5,
      "client_replies_7d": 2,
      "activity_7d": 3,
      "last_client_message_at": "2026-09-13T14:22:00+05:00",
      "last_coach_message_at": "2026-09-14T09:10:00+05:00",
      "summary": "Traveling this week, keeping strength sessions but skipping cardio; asked about macro adjustment."
    }
  ]
}
```
