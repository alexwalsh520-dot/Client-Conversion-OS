-- 030_sop_tables.sql
-- Schema foundation for the SOP (Standard Operating Procedures) library.
-- New top-level CCOS tab at /sop. Architecture is designed to scale as
-- the team adds documents over time.
--
-- Four tables:
--   1. sop_departments — top-level taxonomy (Coaching, Sales, Marketing,
--      seeded). Editable via the admin UI; new departments can be added
--      without code changes.
--   2. sop_roles — per-department roles (Coach, Setter, Closer, etc.).
--      Optional and editable. Many-to-many with sops via the join table.
--   3. sops — the actual documents. Title, description, file metadata,
--      uploaded-by/at, share slug for public-within-CCOS deep links.
--   4. sop_role_assignments — junction table. A SOP can apply to multiple
--      roles within its department.
--
-- File contents live in the Supabase Storage bucket 'sops' (private).
-- All download access goes through signed URLs minted by server routes.
--
-- RLS: matches existing CCOS pattern (anon read, service role writes).
-- Upload permissions are enforced in the API route via session.user.role.

BEGIN;

-- ============================================================
-- sop_departments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sop_departments (
  id BIGSERIAL PRIMARY KEY,
  -- url-safe identifier used in slugs and storage paths
  key TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_-]+$'),
  label TEXT NOT NULL,
  description TEXT,
  -- lower = appears earlier in filter dropdowns and dept lists
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sop_departments_sort ON public.sop_departments (sort_order, label);

COMMENT ON TABLE public.sop_departments IS
  'SOP library: top-level departments. Seeded with coaching/sales/marketing; admins can add more via the admin UI.';

-- Seed the three default departments. ON CONFLICT keeps the migration idempotent.
INSERT INTO public.sop_departments (key, label, description, sort_order) VALUES
  ('coaching',  'Coaching',  'Client-facing coaching processes, communication standards, retention, and check-ins.', 10),
  ('sales',     'Sales',     'Lead handling, calls, closing, follow-ups, pipeline management.',                    20),
  ('marketing', 'Marketing', 'Content, ads, brand voice, creative review, and campaign processes.',                30)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- sop_roles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sop_roles (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT NOT NULL REFERENCES public.sop_departments(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9_-]+$'),
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, key)
);

CREATE INDEX IF NOT EXISTS idx_sop_roles_dept ON public.sop_roles (department_id, sort_order);

COMMENT ON TABLE public.sop_roles IS
  'SOP library: roles within a department. A SOP can apply to multiple roles via sop_role_assignments. No seed rows; admins add roles as needed.';

-- ============================================================
-- sops — the documents themselves
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sops (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  department_id BIGINT NOT NULL REFERENCES public.sop_departments(id) ON DELETE RESTRICT,
  -- Url-safe identifier used in /sop/[slug] deep links. Auto-generated
  -- from title (slugified) at upload time; collision suffix appended if
  -- needed. Globally unique across all SOPs.
  share_slug TEXT NOT NULL UNIQUE CHECK (share_slug ~ '^[a-z0-9-]+$'),
  -- Storage object path inside the 'sops' bucket. Path scheme:
  -- {department_key}/{share_slug}.{ext}
  file_path TEXT NOT NULL,
  -- The original filename the user uploaded. Used for the download
  -- filename so they don't get the storage path back.
  file_name TEXT NOT NULL,
  -- MIME type from the upload. Used to decide preview vs. download-only.
  file_type TEXT,
  file_size_bytes BIGINT,
  -- Free-text tags shown as chips in the library and searchable.
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Logged-in user's name/email at upload time. Audit only.
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sops_department ON public.sops (department_id);
CREATE INDEX IF NOT EXISTS idx_sops_uploaded_at ON public.sops (uploaded_at DESC);
-- Tag GIN index — fast filtering when SOP count grows
CREATE INDEX IF NOT EXISTS idx_sops_tags ON public.sops USING GIN (tags);

COMMENT ON TABLE public.sops IS
  'SOP library: one row per document. File contents live in the sops storage bucket; all downloads via signed URLs minted server-side.';

COMMENT ON COLUMN public.sops.share_slug IS
  'Stable identifier used in /sop/[slug] deep links. Generated from title at upload, kept stable across edits so links never break.';

-- ============================================================
-- sop_role_assignments — many-to-many SOP <-> role
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sop_role_assignments (
  sop_id BIGINT NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES public.sop_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (sop_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_sop_role_assignments_role ON public.sop_role_assignments (role_id);

COMMENT ON TABLE public.sop_role_assignments IS
  'SOP library: a SOP can apply to multiple roles within its department. No row = SOP applies to the whole department (no role filter).';

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.sop_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sops_updated_at ON public.sops;
CREATE TRIGGER trg_sops_updated_at BEFORE UPDATE ON public.sops
  FOR EACH ROW EXECUTE FUNCTION public.sop_set_updated_at();

DROP TRIGGER IF EXISTS trg_sop_departments_updated_at ON public.sop_departments;
CREATE TRIGGER trg_sop_departments_updated_at BEFORE UPDATE ON public.sop_departments
  FOR EACH ROW EXECUTE FUNCTION public.sop_set_updated_at();

DROP TRIGGER IF EXISTS trg_sop_roles_updated_at ON public.sop_roles;
CREATE TRIGGER trg_sop_roles_updated_at BEFORE UPDATE ON public.sop_roles
  FOR EACH ROW EXECUTE FUNCTION public.sop_set_updated_at();

-- ============================================================
-- Row Level Security (anon read, service role writes)
-- ============================================================
ALTER TABLE public.sop_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_role_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.sop_departments FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON public.sop_roles FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON public.sops FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON public.sop_role_assignments FOR SELECT USING (true);

COMMIT;
