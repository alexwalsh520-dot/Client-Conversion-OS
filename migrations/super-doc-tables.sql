-- Super Doc tables for personalized landing pages
-- Paste this into the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Master template (singleton — holds the editable content structure)
CREATE TABLE super_doc_template (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

-- 2. Per-lead pages (one row = one generated landing page)
CREATE TABLE super_doc_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  lead_type text NOT NULL DEFAULT 'influencer',
  video_url text NOT NULL,
  content_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  opened_at timestamptz,
  view_count integer DEFAULT 0
);

CREATE INDEX idx_super_doc_leads_slug ON super_doc_leads(slug);

-- RLS: service role (API routes) gets full access, anon gets read-only
ALTER TABLE super_doc_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_doc_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_template" ON super_doc_template FOR SELECT USING (true);
CREATE POLICY "service_full_template" ON super_doc_template FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_leads" ON super_doc_leads FOR SELECT USING (true);
CREATE POLICY "service_full_leads" ON super_doc_leads FOR ALL USING (true) WITH CHECK (true);
