-- Repo records for migrations applied live on 2026-08-22 (attribution rebuild).

-- registry_calendars: warehouse.registry_calendars, 39 rows. Every GHL
-- booking calendar + booking-link slug, tagged by lane (dm_sales /
-- phone_set / reschedule / onboarding / coaching), client_key, owner,
-- roster_status. Slug-to-id pairings marked mapping_verified=false until
-- read back via the GHL calendars API (scope not yet granted).

-- coverage_human_attributed_non_ad_is_misc_chat: door_coverage_block's
-- bucket CASE gained one branch: blank_reason 'human_confirmed_non_ad'
-- files as misc_chat. Alex's ruling: three folders only (ad / organic /
-- misc chat); WHO attributed is a stamp on the sale, never a folder.
-- Certified after: 94.7% wins / 96.8% cash (window 8/8-8/21).

-- ripdrip_events_signature_header + ripdrip_events_request_headers:
-- columns on public.ripdrip_events recording each event's signature
-- header and full (non-sensitive) request headers, because RipDrip's
-- test event arrived unsigned despite their docs.
