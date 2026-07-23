# Incident 2026-07-23 — Vercel timeout storm + Postgres client exhaustion

## What happened
Over about 3 hours, ~4,409 Vercel timeout (504) errors across many routes
(/api/ads-tracker, /api/ads-v2, /api/webhooks/instagram, /api/buyer-dna/trends/run,
/api/cron/foundation-sync, /api/cron/time-to-eat-tick, /api/content/transcribe,
/api/cron/video-ideas-pipeline and others). pg_stat_activity showed mostly IDLE
backends: the signature of connection-pool client exhaustion and/or instance
resource throttling, not slow queries.

Already remediated live during the incident (by the operator):
- pg_cron job "followup-drain-every-minute" (jobid 1) that made an HTTP call to a
  Vercel endpoint every 60 seconds was unscheduled mid doom-loop.
- 9 zombie "idle in transaction" connections were terminated.

## P0.1 load-shed (this commit)
Heavy non-critical crons disabled or reduced to stop new load immediately.
Re-enabled one at a time per P0.6, each rebuilt with bounded concurrency, small
batches, statement timeouts, and staggered schedules.

Disabled (removed from vercel.json crons; JSON has no comment syntax, so the
record lives here):
- /api/cron/transcribe-blitz (was 8,23,38,53 * * * *) — heavy Whisper work.
- /api/cron/time-to-eat-tick (was */2 * * * *) — fired every 2 minutes.
- /api/cron/video-ideas-pipeline (was 30 * * * *).
- /api/cron/buyer-dna-weekly (was 0 13 * * 1). The buyer-dna trends run
  (/api/buyer-dna/trends/run) is not a cron; it is triggered on demand and is
  covered by the connection-discipline fixes in P0.3/P0.5.

Reduced:
- /api/cron/foundation-sync 3,18,33,48 * * * * (every 15 min) -> 3 * * * * (hourly).

Left as-is (not in the load-shed list, watched): content-pipeline (12 */2),
content-pipeline-heavy (30 */2), creative-copy backfill-all (20 */2),
sales-quick-sync (*/10).

## Re-enable status (P0.6)
Re-enabled after the systemic fixes were live (service_role statement_timeout,
singleton client, no request-path compute, no pg_cron HTTP), staggered so no two
land on the same minute as the hot jobs (foundation :03, ads-tracker :05,
ads-v2-sync :25):
- /api/cron/transcribe-blitz  -> 17,47 * * * *  (was 8,23,38,53; halved + moved off the hot minutes).
- /api/cron/video-ideas-pipeline -> 50 * * * *  (was 30; moved off content-pipeline-heavy :30).
- /api/cron/time-to-eat-tick   -> */5 * * * *   (was */2; lighter cadence).
- /api/cron/buyer-dna-weekly   -> 0 13 * * 1    (unchanged weekly slot).
- /api/cron/foundation-sync stays hourly (3 * * * *), not restored to every 15 min.

Every query these jobs make is now bounded by the role-level statement_timeout,
so none can run unbounded the way they did during the incident. The doom-loop
class (pg_cron making HTTP calls) is now caught by the nightly self-check
(adsv2_audit_cron_jobs) and cannot be re-added silently.

See docs/ads-v2-piece1-report.md for the fresh accuracy gates and the
before/after interactive-route timings.
