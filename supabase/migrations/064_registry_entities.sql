-- 064_registry_entities.sql
-- TRUTH LAYER, Brick 1 (1 of 4): the ENTITY registry.
--
-- One row per entity the business does business AS or THROUGH: creators,
-- closers, setters. The point of the table is the `aliases` column - every
-- spelling every system uses for that person, in one place - so that entity
-- resolution stops being a guess.
--
-- The concrete failure this kills: an AI reported "Jake has zero DMs" because
-- the message store keys him `jake_divljak` while the warehouse keys him
-- `jake`. After this table, entity resolution outside the registry is
-- uncertified by definition.
--
-- This migration ONLY creates structure. Seed data lives in 067 so the seed
-- can be re-run without re-running DDL.
--
-- Idempotent: safe to run twice.
--
-- RLS posture mirrors the other internal tables (factory_items,
-- public_share_links): RLS ON, no anon policies. Reads go through
-- service-role paths only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.registry_entities (
  -- The ONE key everything else joins on (e.g. 'tyson', 'closer_broz').
  canonical_key TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('creator', 'closer', 'setter')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'former')),
  status_since  DATE,

  -- THE CORE OF THIS TABLE. Array of {system, value} objects, e.g.
  --   [{"system": "dm_capture", "value": "jake_divljak"},
  --    {"system": "warehouse",  "value": "jake"}]
  -- Every alias is EVIDENCE-BACKED: values are read out of the live data or
  -- the code that writes it, never guessed. An entity with no findable key
  -- gets an empty array and a note - empty beats invented.
  aliases JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- {"ad_account": "AUD", "revenue": "USD"} - Jake's ad account bills AUD
  -- while all revenue reports USD, so the two are tracked separately.
  currency JSONB,

  -- Creators only. Cents. {"3mo": 120000, "6mo_standard": 240000, ...}
  price_book JSONB,

  -- Creators only. Commission/override percentages and the derived floors.
  economics JSONB,

  -- Per-client capability fields. Today every client is
  -- none / native_messaging_event / warehouse_only. They exist now so that a
  -- future pixel needs zero restructure: certified questions that depend on
  -- pixel events carry a conditional path that only fires when
  -- pixel_status = 'active'.
  pixel_status       TEXT NOT NULL DEFAULT 'none'
    CHECK (pixel_status IN ('none', 'active')),
  conversion_source  TEXT NOT NULL DEFAULT 'native_messaging_event'
    CHECK (conversion_source IN ('native_messaging_event', 'pixel')),
  attribution_source TEXT NOT NULL DEFAULT 'warehouse_only'
    CHECK (attribution_source IN ('warehouse_only', 'pixel_assisted')),

  notes     TEXT,
  signed_by TEXT,
  signed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.registry_entities IS
  'TRUTH LAYER Brick 1. Canonical entity registry: one row per creator/closer/setter with every system alias. Entity resolution outside this table is uncertified by definition.';
COMMENT ON COLUMN public.registry_entities.aliases IS
  'Array of {system, value}. Every spelling every system uses. Evidence-backed only - never invent a value that cannot be found in the data.';
COMMENT ON COLUMN public.registry_entities.pixel_status IS
  'none | active. Today all clients are none: conversions come from Meta native messaging events, not pixel fires.';

ALTER TABLE public.registry_entities ENABLE ROW LEVEL SECURITY;

-- Reads are single lookups: no request-path compute anywhere.
CREATE INDEX IF NOT EXISTS registry_entities_kind_status_idx
  ON public.registry_entities (kind, status);

-- GIN over the alias array so alias lookups stay index-backed as the table grows.
CREATE INDEX IF NOT EXISTS registry_entities_aliases_gin_idx
  ON public.registry_entities USING GIN (aliases jsonb_path_ops);

-- Lowercased alias values, flattened, for the case-insensitive resolver.
CREATE OR REPLACE VIEW public.registry_entity_alias_index AS
  SELECT e.canonical_key,
         LOWER(a.value ->> 'value') AS alias_value,
         a.value ->> 'system'       AS alias_system
    FROM public.registry_entities e
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(e.aliases) AS a(value)
   WHERE NULLIF(TRIM(a.value ->> 'value'), '') IS NOT NULL;

COMMENT ON VIEW public.registry_entity_alias_index IS
  'Flattened lowercase alias lookup used by registry_resolve_entity().';

-- ── The resolver ────────────────────────────────────────────────────────
-- Case-insensitive lookup across canonical_key, display_name, and every
-- aliases value. Returns the canonical_key, or NULL when the input names no
-- entity.
--
-- NON-PERSON LABELS: the sales tracker's setter column contains two labels
-- that are NOT people - 'Other' and 'Phone Setter 1'. They resolve to NULL,
-- never to a person. This is the difference between "we don't know who set
-- this call" and silently crediting someone.
CREATE OR REPLACE FUNCTION public.registry_resolve_entity(p_alias TEXT)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH needle AS (
    SELECT LOWER(TRIM(p_alias)) AS v
  )
  SELECT r.canonical_key
    FROM (
      -- Priority 1: exact canonical key.
      SELECT e.canonical_key, 1 AS rank
        FROM public.registry_entities e, needle n
       WHERE LOWER(e.canonical_key) = n.v
      UNION ALL
      -- Priority 2: a declared alias.
      SELECT i.canonical_key, 2
        FROM public.registry_entity_alias_index i, needle n
       WHERE i.alias_value = n.v
      UNION ALL
      -- Priority 3: the display name.
      SELECT e.canonical_key, 3
        FROM public.registry_entities e, needle n
       WHERE LOWER(e.display_name) = n.v
    ) r, needle n
   WHERE n.v IS NOT NULL
     AND n.v <> ''
     -- Non-person tracker labels never resolve to a person.
     AND n.v NOT IN ('other', 'phone setter 1', 'unknown', 'n/a', 'none')
   ORDER BY r.rank
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.registry_resolve_entity(TEXT) IS
  'Case-insensitive entity resolution across canonical_key, display_name and every alias. Returns NULL for unknown input and for the non-person tracker labels (Other, Phone Setter 1).';

REVOKE ALL ON FUNCTION public.registry_resolve_entity(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registry_resolve_entity(TEXT) TO service_role, authenticated;

COMMIT;
