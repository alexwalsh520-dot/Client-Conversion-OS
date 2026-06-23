-- 050_factory_item_versions.sql
-- Per-ad version history for the Factory tab. ADDITIVE ONLY — never modifies
-- factory_items. Each regeneration appends a row here; the card's "vN" pill opens
-- a read-only modal of all past images + the revision note that produced each.
-- (Applied live to the DB before this file landed; included for repo record.)

BEGIN;

CREATE TABLE IF NOT EXISTS public.factory_item_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.factory_items(id) ON DELETE CASCADE,
  version INT NOT NULL,
  image_url TEXT NOT NULL,
  revision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, version)
);

CREATE INDEX IF NOT EXISTS idx_factory_item_versions_item
  ON public.factory_item_versions (item_id, version DESC);

COMMENT ON TABLE public.factory_item_versions IS
  'Version history of generated images per factory_items ad (v1 = original). Additive; never overwrites.';

ALTER TABLE public.factory_item_versions ENABLE ROW LEVEL SECURITY;

-- Backfill v1 from the current image of each existing item (additive only).
INSERT INTO public.factory_item_versions (item_id, version, image_url, revision_note, created_at)
SELECT id, 1, image_url, NULL, COALESCE(updated_at, NOW())
FROM public.factory_items
WHERE image_url IS NOT NULL
ON CONFLICT (item_id, version) DO NOTHING;

COMMIT;
