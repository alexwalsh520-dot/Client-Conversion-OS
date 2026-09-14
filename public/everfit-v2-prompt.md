Create my Everfit V2 weekly report for coach [COACH NAME], review date [YYYY-MM-DD, normally Wednesday]. If I leave the coach blank, ask which coach to review first. Review only one coach per report.

Use my signed-in browser to inspect CCOS (https://client-conversion-os.vercel.app/coaching) and Everfit (https://app.everfit.io). Do the review yourself. Do not install an extension, build a sync, schedule work, send messages, or upload the report for me. Return a readable report here and one downloadable UTF-8 JSON file named everfit-v2-COACH-YYYY-MM-DD.json for my manual CCOS upload.

Window: the seven full calendar days before review_date, from review_date minus 7 days at 00:00 inclusive to review_date at 00:00 exclusive, Asia/Karachi. State this range explicitly. Use actual timestamps; do not silently substitute a rolling seven-day dashboard percentage with different boundaries.

1. Enumerate the coach's entire client roster across every page/filter. Cross-check CCOS and Everfit. Match stable IDs or verified email identities, never merge people based only on similar names. Include all assigned clients, including recently ended programs. Record the exact distinct roster count and discrepancies. Do not stop after a sample or the first page.
2. Use verified CCOS program dates and/or Everfit signed days remaining to determine each client's program end date. days_remaining = end date minus review_date in calendar days. If using today's signed days to infer an end date, first add those days to today's date, then compute relative to review_date. Resolve conflicting sources or mark unknown. Positive days = active; zero = ends today; -1 through -7 = ended within the past seven days; below -7 = officially ended. Retentions include every client with days_remaining from -7 through +14 inclusive.
3. Open each client's conversation AND recent activity panel in Everfit. Inspect enough history to cover the full reporting window, including pagination/scrolling. Count client-authored replies, not coach outreach. Count meaningful client activity (completed workouts, check-ins, logged nutrition, measurements, completed tasks, etc.), not coach edits or messages. A ghost is an ACTIVE client with zero client replies AND zero recorded activity in this window. Only record zero when the whole window was checked; inaccessible or incomplete evidence is null. Messaging silence alone is insufficient.
4. For each active client, count workouts assigned/scheduled within the window and how many of those were completed. Exclude unscheduled extra workouts from this fraction. Coach completion = total completed divided by total assigned, not an average of client percentages. Zero assigned means N/A. If only an exactly matching seven-day percentage is available, provide workout_pct and null counts; explicitly disclose that only mean client percentages, not the weighted coach total, can then be calculated. Never invent counts from rounded percentages.
5. Summarize what clients are saying at a high level: progress, obstacles, recurring concerns and follow-ups. Separate observed facts from interpretations. Keep sensitive details and quotations to the minimum needed. Record short evidence references with source URL/ID and relevant dates for each client, including which time range was checked.

Be efficient: enumerate once, collect messages/activity/workouts together per client, keep compact structured notes outside the conversation, and reuse them for both outputs. Use supported browser tools and follow their access rules. Do not repeatedly dump full page contents or re-check unchanged records. If interrupted, retain a compact checkpoint of verified IDs and remaining clients; never label a partial review complete.

Readable report: coach and date range; exact roster count and rows checked; active count; retention client names/end dates/days remaining; confirmed ghost names/count and percentage of active clients; workout completion with numerator/denominator and coverage; high-level weekly themes; unknowns and limitations. If roster or evidence is incomplete, label affected counts/percentages provisional. Retain unknowns as unknowns rather than treating them as zero. Do not claim the report is complete until the roster and required evidence are fully checked.

JSON must contain exactly this structure (replace the illustrative placeholders with observed data; never submit this example as real data):
```json
{
  "schema_version": 2,
  "coach_name": "COACH NAME",
  "review_date": "YYYY-MM-DD",
  "timezone": "Asia/Karachi",
  "retention_days": 14,
  "roster_count": 0,
  "roster_complete": false,
  "coverage_notes": ["State any missing clients, evidence, source conflicts or workout limitations."],
  "summary": "High-level weekly findings.",
  "clients": [
    {
      "id": "verified-stable-source-id",
      "name": "CLIENT NAME",
      "days_remaining": null,
      "replies_7d": null,
      "activity_7d": null,
      "workouts_completed": null,
      "workouts_assigned": null,
      "workout_pct": null,
      "summary": "Short weekly client summary.",
      "evidence": ["Source reference and checked dates for messages, activity, workouts and program end."]
    }
  ]
}
```
All fields are required. Unknown numeric values are null; verified counts are nonnegative integers; days_remaining is a signed integer. Workout counts are both present or both null, completed cannot exceed assigned. workout_pct is 0–100 or null; prefer counts and set workout_pct null when counts are known. Use unique client IDs. roster_count is the verified total, never smaller than the included rows; roster_complete may be true only when all roster clients are represented and totals match. If the total itself cannot be verified, stop and explain that blocker rather than inventing an exact total. Coverage notes must disclose incomplete evidence even when roster enumeration is complete. Empty coverage_notes is appropriate only when there are no limitations. Do not include Markdown fences in the JSON file.
