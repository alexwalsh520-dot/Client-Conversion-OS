-- Video testimonials: capture the client's profession / sector.
--
-- MAS 2026-09-16: the recording page should ask the client to state their
-- profession or industry sector. That context makes the testimonials useful
-- for segmented marketing later. Also adds a small "may be used for
-- marketing" footer client-side (no schema change needed for the footer;
-- the notice is implicit consent captured with each submission).
--
-- Column is nullable so pre-existing submissions keep working. The recording
-- form requires it for new submissions; the /api/testimonials/video/complete
-- endpoint validates non-empty before flipping status to 'submitted'.

ALTER TABLE public.video_testimonials
  ADD COLUMN IF NOT EXISTS profession TEXT;

COMMENT ON COLUMN public.video_testimonials.profession IS
  'Client-self-stated profession or sector, captured on the recording page. Required for new submissions (MAS 2026-09-16). Nullable so pre-existing rows survive.';
