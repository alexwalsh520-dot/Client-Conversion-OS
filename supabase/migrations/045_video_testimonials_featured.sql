-- 045_video_testimonials_featured.sql
-- Lets an admin "feature" a submitted client video testimonial so it appears in
-- the native video gallery on the public /testimonials page (shown ALONGSIDE the
-- existing Senja widget, not instead of it). Only featured + submitted rows are
-- ever served through the public playback route; everything else stays private
-- behind the admin-only stream proxy.

BEGIN;

ALTER TABLE public.video_testimonials
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS featured_by TEXT;

-- Public gallery query: featured, most-recently-featured first.
CREATE INDEX IF NOT EXISTS idx_video_testimonials_featured
  ON public.video_testimonials (featured, featured_at DESC)
  WHERE featured = TRUE;

COMMIT;
