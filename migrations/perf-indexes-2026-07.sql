-- Performance indexes for the hot filter/order paths that currently seq-scan large tables. All are
-- ADDITIVE and `if not exists`, so re-running is a safe no-op and any that already exist are skipped.
-- Diagnosis: the foundation-sync cursor scans (every 15 min) order the 5 biggest event tables by a
-- cursor column that no existing index leads with; creator_content / fathom_calls / content_grades
-- have no index at all yet drive transcription, grading, VOC and the external context endpoint.
--
-- Paste into the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new

-- creator_content (~2k rows, unindexed): studio / grade / shift / calendar-build / external context.
create index if not exists creator_content_client_taken
  on creator_content (client_key, taken_at desc);
create index if not exists creator_content_client_media
  on creator_content (client_key, ig_media_id);

-- fathom_calls (~440 rows, unindexed): VOC, core, mine, external context; recorded_at is also a
-- foundation-sync cursor.
create index if not exists fathom_calls_client_recorded
  on fathom_calls (client_key, recorded_at desc);
create index if not exists fathom_calls_recorded_at
  on fathom_calls (recorded_at);

-- content_grades (~380 rows, unindexed): grade existence checks + calendar/context joins.
create index if not exists content_grades_client_media
  on content_grades (client_key, ig_media_id);
create index if not exists content_grades_client_icpver
  on content_grades (client_key, icp_version);

-- foundation-sync incremental cursor scans (every 15 min): each SOURCES table is ordered by its
-- cursor column with no leading-cursor index, so today each is a seq-scan + sort of a large table.
create index if not exists dm_conversation_messages_sent_at
  on dm_conversation_messages (sent_at);              -- 81k rows — the biggest single win
create index if not exists ads_keyword_events_event_at
  on ads_keyword_events (event_at);
create index if not exists sales_tracker_rows_created_at
  on sales_tracker_rows (created_at);
create index if not exists ghl_appointments_created_at
  on ghl_appointments (created_at);

-- ads_keyword_events per-buyer attribution lookup (existing index leads with `source`, which these
-- queries don't filter on).
create index if not exists ads_keyword_events_client_sub_event
  on ads_keyword_events (client_key, subscriber_id, event_at);
