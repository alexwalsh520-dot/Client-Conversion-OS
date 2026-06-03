-- 042_ad_variations_factory.sql
-- Variations Factory: an automated engine that takes a WINNING image ad and
-- generates a batch ("job") of ~10 variation images, so they're sitting ready
-- when the owner opens the dashboard each morning.
--
-- This migration creates ONE new table (`ad_variations`) and seeds ONE
-- `app_settings` row (`variations_factory`) holding the engine config the
-- frontend edits live. The public Storage bucket `ad-variations` is created
-- lazily in code (ensureBucket) the same way `ad-creatives` is, so it is NOT
-- created here.
--
-- Safe to re-run: all statements are IF NOT EXISTS / ON CONFLICT guarded.

BEGIN;

-- ---------------------------------------------------------------------------
-- One row per generated variation image. ~10 rows share a `job_id` (one batch).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_variations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ad we varied FROM. Matches ad_creative_image.ad_id / ads_meta_insights_daily.ad_id.
  source_ad_id      text NOT NULL,
  -- One id per batch of ~10 variations produced together.
  job_id            text NOT NULL,
  -- Which kind of variation this image is.
  kind              text NOT NULL CHECK (kind IN ('background', 'highlightWord', 'copyTweak')),
  -- The exact prompt sent to the image model (for debugging / regeneration).
  prompt            text NOT NULL,
  -- Public URL of the generated image in the `ad-variations` Storage bucket.
  -- Null while a row is reserved before its image finished uploading.
  image_url         text,
  -- Full settings object in effect when this job ran (audit + reproducibility).
  settings_snapshot jsonb,
  -- Image-gen provider used, e.g. 'openai'.
  provider          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_variations_source_ad_idx
  ON public.ad_variations (source_ad_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ad_variations_job_idx
  ON public.ad_variations (job_id);

-- RLS: read open to anon (dashboard reads), all writes go through the service
-- role (which bypasses RLS). Mirrors the ads_tracker tables' policy shape.
ALTER TABLE public.ad_variations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ad_variations'
      AND policyname = 'Allow anon read ad variations'
  ) THEN
    CREATE POLICY "Allow anon read ad variations"
      ON public.ad_variations FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ad_variations'
      AND policyname = 'Allow service role manage ad variations'
  ) THEN
    CREATE POLICY "Allow service role manage ad variations"
      ON public.ad_variations USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.ad_variations IS
  'Variations Factory output. One row per generated variation image; ~10 rows per job_id (one batch generated from a single winning source ad).';

-- ---------------------------------------------------------------------------
-- Engine config the frontend edits live, stored as JSON in app_settings.
-- mix.{background,highlightWord,copyTweak} must sum to variationsPerJob.
-- ---------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES (
  'variations_factory',
  '{"variationsPerJob":10,"mix":{"background":6,"highlightWord":2,"copyTweak":2},"provider":"openai","enabled":true}'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
