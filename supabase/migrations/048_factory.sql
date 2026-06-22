-- 048_factory.sql
-- Factory — live creative-project tracker (Trello/kanban meets macOS Finder).
--
-- A long-term, reusable tool for organizing high-volume creative production. A
-- "project" (e.g. the Tyson 100-Ad Sprint) holds many "items" (individual ads),
-- each moving through a 4-stage pipeline:
--   copy_written -> image_generated -> revision -> completed
--
-- The board polls /api/factory live so the user watches production progress in
-- real time (images get generated, stages flip) without a redeploy. Generated
-- image files live in the SAME Cloudflare R2 bucket the Variations Factory +
-- Studio 2 use (image_url), and surface in the Finder-style "Files" view.
--
-- RLS posture mirrors ad_variations / ad_contest_entries: RLS on, no anon
-- policies. All reads/writes go through service-role API routes (service role
-- bypasses RLS — single-user internal app).

BEGIN;

CREATE TABLE IF NOT EXISTS public.factory_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.factory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.factory_projects(id) ON DELETE CASCADE,

  -- Display label for the ad, e.g. "B1", "C3".
  label TEXT NOT NULL,
  -- Which offer bucket the ad belongs to.
  bucket TEXT NOT NULL CHECK (bucket IN ('lead_magnet', 'direct_cta', 'keeper')),
  -- Delivery style (from the copy-doc section headers), e.g. "screenshot-proof",
  -- "netflix", "bullet-workhorse". Free text so new styles need no migration.
  style TEXT,
  -- The full ad copy.
  copy_text TEXT,
  -- The image note from the copy doc: "(img 464F4AB6)" or
  -- "generate from Tyson Raw Pics".
  image_direction TEXT,

  -- Pipeline stage.
  stage TEXT NOT NULL DEFAULT 'copy_written'
    CHECK (stage IN ('copy_written', 'image_generated', 'revision', 'completed')),

  -- Generated image (R2 object). NULL until an image is produced.
  image_url TEXT,
  -- What the user wants changed (set when they push an item to 'revision').
  revision_note TEXT,

  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_factory_items_project
  ON public.factory_items (project_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_factory_items_stage
  ON public.factory_items (project_id, stage);

COMMENT ON TABLE public.factory_projects IS
  'Factory creative-production projects (e.g. Tyson 100-Ad Sprint).';
COMMENT ON TABLE public.factory_items IS
  'Individual creative items moving through copy_written -> image_generated -> revision -> completed. Images live in R2 (image_url).';

ALTER TABLE public.factory_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_items ENABLE ROW LEVEL SECURITY;

COMMIT;
