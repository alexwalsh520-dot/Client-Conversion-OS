-- 052_client_and_team_registry.sql
-- DB-backed registries so clients (creators) and team members can be managed
-- from the CCOS UI instead of code edits:
--
--   * ccos_clients  — the creators we work with. Named ccos_clients because the
--     existing `clients` table is the coaching-customer roster (a different
--     concept). Seeded with Tyson active; Keith / Lucy / Antwan retired (we no
--     longer work with them — kept as rows so historical attribution stays
--     labelled). New rows are created automatically when a client-onboarding
--     submission completes (/partner-onboarding), or manually.
--
--   * team_members  — closers / setters / coaches shown across Sales Hub,
--     Setter Response Time, briefs, etc. Seeded from today's active roster.
--     `aliases` holds every lowercase spelling seen in sheets / ManyChat
--     (e.g. kelchi -> Kelechi) so attribution keeps working.
--
-- All app code falls back to the current hardcoded lists until this migration
-- is applied, so deploy order doesn't matter.
--
-- RLS posture mirrors public_share_links / factory_items: RLS ON, no anon
-- policies. All reads/writes go through service-role API routes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ccos_clients (
  -- Short internal key used across the pipeline (e.g. 'tyson').
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Long-form ManyChat / DM-pipeline key (e.g. 'tyson_sonnek').
  manychat_key TEXT,
  ig_handle TEXT,
  email TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  -- 'active' clients appear in every tab; 'retired' keeps history labelled
  -- but disappears from all pickers and live views.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  -- Link back to the onboarding record that created this client (if any).
  onboarding_partner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ccos_clients IS
  'Creator/client registry (NOT the coaching-customer roster — that is `clients`). Active rows drive every client picker; retired rows keep history labelled.';

ALTER TABLE public.ccos_clients ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ccos_clients (key, name, manychat_key, timezone, status)
VALUES
  ('tyson',  'Tyson',  'tyson_sonnek',  'America/Los_Angeles', 'active'),
  ('keith',  'Keith',  'keith_holland', 'America/New_York',    'retired'),
  ('lucy',   'Lucy',   'lucy_hubbard',  'America/New_York',    'retired'),
  ('antwan', 'Antwan', 'antwan_rarcus', 'America/New_York',    'retired')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- Every lowercase spelling seen in sheets / ManyChat / GHL for this person.
  aliases TEXT[] NOT NULL DEFAULT '{}',
  job_role TEXT NOT NULL CHECK (job_role IN ('closer', 'setter', 'coach')),
  email TEXT,
  -- Which client's team they're on (ccos_clients.key). Everyone is on Tyson today.
  client_key TEXT NOT NULL DEFAULT 'tyson',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_name_role
  ON public.team_members (LOWER(name), job_role);

COMMENT ON TABLE public.team_members IS
  'Team directory (closers/setters/coaches) behind Sales Hub, Setter Response Time, briefs, and the Settings “Add Team Member” flow. Aliases keep sheet/ManyChat attribution working.';

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

INSERT INTO public.team_members (name, aliases, job_role) VALUES
  ('Will',    ARRAY['will', 'rincan'],                          'closer'),
  ('Jacob',   ARRAY['jacob', 'broz'],                           'closer'),
  ('Austin',  ARRAY['austin'],                                  'closer'),
  ('Amara',   ARRAY['amara'],                                   'setter'),
  ('Kelechi', ARRAY['kelechi', 'kelchi', 'kelz'],               'setter'),
  ('Debbie',  ARRAY['debbie', 'debby', 'chidiebere', 'nwosu'],  'setter'),
  ('Gideon',  ARRAY['gideon'],                                  'setter'),
  ('Erin',    ARRAY['erin'],                                    'setter')
ON CONFLICT DO NOTHING;

COMMIT;
