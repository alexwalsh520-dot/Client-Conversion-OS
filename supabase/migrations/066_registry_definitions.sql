-- 066_registry_definitions.sql
-- TRUTH LAYER, Brick 1 (3 of 4): the DEFINITION registry.
--
-- Owner-signed definitions of every term the business computes forever. The
-- plain-English `statement` is what a human signed; `details` carries the same
-- decision as machine-readable data so a certified answer can apply the rule
-- without re-parsing prose.
--
-- Versioned, never overwritten: superseding a definition means inserting a new
-- version and marking the old one 'superseded'. The history of what we
-- believed, and when, is part of the record.
--
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.registry_definitions (
  name    TEXT NOT NULL,
  version INT  NOT NULL,

  -- The signed sentence, verbatim from the signoff sheet.
  statement TEXT NOT NULL,

  -- The same rule as data: thresholds, formulas, rosters, dates.
  details JSONB NOT NULL DEFAULT '{}'::JSONB,

  signed_by TEXT,
  signed_at DATE,

  -- signed     = locked, safe to compute against
  -- superseded = replaced by a later version
  -- open       = still needs the owner; answers must say so
  status TEXT NOT NULL CHECK (status IN ('signed', 'superseded', 'open')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (name, version)
);

COMMENT ON TABLE public.registry_definitions IS
  'TRUTH LAYER Brick 1. Owner-signed definitions. statement = the signed prose; details = the same rule as machine-readable data. Versioned and append-only.';
COMMENT ON COLUMN public.registry_definitions.status IS
  'signed = locked; superseded = replaced by a later version; open = still needs the owner (answers must disclose this).';

ALTER TABLE public.registry_definitions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS registry_definitions_status_idx
  ON public.registry_definitions (status);

-- The current version of each definition - what a certified answer reads.
CREATE OR REPLACE VIEW public.registry_definitions_current AS
  SELECT DISTINCT ON (name)
         name, version, statement, details, signed_by, signed_at, status, updated_at
    FROM public.registry_definitions
   WHERE status <> 'superseded'
   ORDER BY name, version DESC;

COMMENT ON VIEW public.registry_definitions_current IS
  'Latest non-superseded version of every definition. The read path for certified answers.';

COMMIT;
