-- 2026-08-26 · Booking lane column (repo record of live migration adsv2_booking_lane)
--
-- WHY: sales bookings happen through two lanes. The DM lane books on the pinned
-- Strategy Session calendars; the phone-set lane books on closers' personal
-- calendars after an outbound dial. Ads V2 only ingested the DM lane, so the
-- whole phone-set lane was invisible to Booked (August audit: 9 announced
-- bookings with zero coverage). The facts builder now ingests both and stamps
-- which lane each row came through.
--
-- lane values:
--   dm_sales     booked on a pinned Strategy Session calendar
--   phone_set    booked on a closer's personal calendar (outbound-dialed lead)
--   off_calendar tracker-synthesized stand-in (no calendar booking exists)
--
-- Also patches adsv2_tracker_weld pass 2 so synthesized rows carry
-- lane = 'off_calendar' (they are deleted and re-created every sync, so a
-- one-time backfill alone would not stick).

alter table warehouse.adsv2_booking_facts add column if not exists lane text;

comment on column warehouse.adsv2_booking_facts.lane is
  'Booking lane: dm_sales (Strategy Session calendars), phone_set (closer personal calendars, outbound-dialed leads), off_calendar (tracker-synthesized stand-in). Null only on rows last rebuilt before 2026-08-26. onboarding_sales = closer-taken downsell sales calls on the onboarding calendar (added 2026-08-26).';

update warehouse.adsv2_booking_facts
set lane = 'dm_sales'
where lane is null
  and calendar_id in ('M4z9iTPUiT9rjk0QKOvD','IeKPrRYzD2RS9ne3fOqT','t0R21g47N9eVdr9nGR98','OYzFv9Iuqu1XYLbCy0cp');

update warehouse.adsv2_booking_facts
set lane = 'off_calendar'
where lane is null
  and calendar_name = 'Sales tracker (off-calendar)';

update warehouse.adsv2_booking_facts
set lane = 'phone_set'
where lane is null
  and calendar_id in (
    'ZIOktvjSN0aW8qHUhhZB','ACPOAA2nf2bc3TIlU3BA','Oh174I9DCc7vhfYajMeC',
    'Hr8mGnlTAj9w862dUHDl','JpCD5ZbajtyrabJGmuMJ',
    'wKA1JgAyDzvKl4DjZHzF','6dw9AY1CHPNALpaID0qJ'
  );

-- adsv2_tracker_weld pass 2 insert now sets lane = 'off_calendar'.
-- (Full CREATE OR REPLACE applied live; identical to the 2026-08-22 version
-- except the pass-2 insert column list gains `lane` and the select gains the
-- literal 'off_calendar'.)

-- POSTSCRIPT (2026-08-26, applied live as adsv2_booking_facts_view_lane):
-- public.adsv2_booking_facts is a VIEW over the warehouse table, and the app
-- writes through it. Adding the column to the base table alone made the first
-- post-deploy sync fail its insert and left the booking window empty until the
-- next rebuild. Fix: the view was recreated with `lane` appended and the
-- PostgREST schema cache reloaded (notify pgrst, 'reload schema'), then the
-- sync re-run rebuilt the window cleanly.
-- LESSON for every future adsv2 column: base table + public view + schema
-- reload, all three, BEFORE the code that writes the column deploys.
