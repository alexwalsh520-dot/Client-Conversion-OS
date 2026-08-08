-- 082: Booked counts on the day the booking was MADE, not the day the call
-- is scheduled for.
--
-- Owner call (Alex, 2026-08-08): "Booked" answers "how many calls did my team
-- book in this window". Until now booked_et_day held the ET day of start_time
-- (the scheduled call), so a call booked Thursday night for a Friday slot
-- counted under Friday. The facts builder now writes booked_et_day as the ET
-- day of created_time (falling back to start_time only when created_time is
-- missing); this migration backfills the rows the 45-day sync window will
-- never rewrite, so history counts the same way as fresh data.
--
-- Nothing else changes shape: start_time still drives is_upcoming and the
-- popup's Call column, and every counter (window leaves, metrics day series,
-- hover cohorts) already reads booked_et_day, so they all flip together.

update adsv2_booking_facts
set booked_et_day = (created_time at time zone 'America/New_York')::date
where created_time is not null
  and booked_et_day is distinct from (created_time at time zone 'America/New_York')::date;
