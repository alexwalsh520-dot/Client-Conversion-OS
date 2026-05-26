-- Super Doc video automation
-- Stores the two name-clip templates and per-lead video jobs.

CREATE TABLE IF NOT EXISTS super_doc_video_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  segment text UNIQUE NOT NULL,
  name text NOT NULL,
  base_video_source text,
  reference_clip_1_source text,
  reference_clip_2_source text,
  total_duration_seconds numeric NOT NULL DEFAULT 291,
  clip_1_start_seconds numeric NOT NULL DEFAULT 0,
  clip_1_end_seconds numeric NOT NULL DEFAULT 6,
  clip_2_start_seconds numeric NOT NULL DEFAULT 6,
  clip_2_end_seconds numeric NOT NULL DEFAULT 10,
  higgsfield_model text NOT NULL DEFAULT 'seedance_2_0',
  clip_1_script_template text NOT NULL DEFAULT 'Use the exact same words and timing as reference clip 1, but replace only the spoken name with {{first_name}}.',
  clip_2_script_template text NOT NULL DEFAULT 'Use the exact same words and timing as reference clip 2, but replace only the spoken name with {{first_name}}.',
  clip_1_prompt_template text NOT NULL DEFAULT 'Recreate reference clip 1 exactly. Same person, same background, same camera, same lighting, same body movement, same pacing, same audio style. Change only the first name to {{first_name}}. The mouth must clearly say {{first_name}}. Duration must be exactly 6 seconds.',
  clip_2_prompt_template text NOT NULL DEFAULT 'Recreate reference clip 2 exactly. Same person, same background, same camera, same lighting, same body movement, same pacing, same audio style. Change only the first name to {{first_name}}. The mouth must clearly say {{first_name}}. Duration must be exactly 4 seconds.',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS super_doc_video_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id text,
  lead_slug text REFERENCES super_doc_leads(slug) ON DELETE SET NULL,
  segment text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  instagram_handle text,
  template_id uuid REFERENCES super_doc_video_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  higgsfield_clip_1_url text,
  higgsfield_clip_2_url text,
  final_video_url text,
  bunny_embed_url text,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_super_doc_video_jobs_status
  ON super_doc_video_jobs(status);

CREATE INDEX IF NOT EXISTS idx_super_doc_video_jobs_run_id
  ON super_doc_video_jobs(run_id);

CREATE INDEX IF NOT EXISTS idx_super_doc_video_jobs_lead_slug
  ON super_doc_video_jobs(lead_slug);

CREATE INDEX IF NOT EXISTS idx_super_doc_video_jobs_segment
  ON super_doc_video_jobs(segment);

CREATE INDEX IF NOT EXISTS idx_super_doc_video_jobs_created_at
  ON super_doc_video_jobs(created_at DESC);

ALTER TABLE super_doc_video_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_doc_video_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_full_super_doc_video_templates" ON super_doc_video_templates;
CREATE POLICY "service_full_super_doc_video_templates"
  ON super_doc_video_templates
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_full_super_doc_video_jobs" ON super_doc_video_jobs;
CREATE POLICY "service_full_super_doc_video_jobs"
  ON super_doc_video_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_read_super_doc_video_templates" ON super_doc_video_templates;
CREATE POLICY "anon_read_super_doc_video_templates"
  ON super_doc_video_templates
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "anon_read_super_doc_video_jobs" ON super_doc_video_jobs;
CREATE POLICY "anon_read_super_doc_video_jobs"
  ON super_doc_video_jobs
  FOR SELECT
  USING (true);

INSERT INTO super_doc_video_templates (
  segment,
  name,
  total_duration_seconds,
  clip_1_start_seconds,
  clip_1_end_seconds,
  clip_2_start_seconds,
  clip_2_end_seconds,
  notes
) VALUES
  (
    'creator',
    'Creator Outreach Base Video',
    291,
    0,
    6,
    6,
    10,
    'Full video is 4:51. Replace 0-6s and 6-10s with Higgsfield name clips, then append the original video from 10s onward.'
  ),
  (
    'agency_tm',
    'Agency/TM Outreach Base Video',
    291,
    0,
    6,
    6,
    10,
    'Full video is 4:51. Replace 0-6s and 6-10s with Higgsfield name clips, then append the original video from 10s onward.'
  )
ON CONFLICT (segment) DO UPDATE SET
  name = EXCLUDED.name,
  total_duration_seconds = EXCLUDED.total_duration_seconds,
  clip_1_start_seconds = EXCLUDED.clip_1_start_seconds,
  clip_1_end_seconds = EXCLUDED.clip_1_end_seconds,
  clip_2_start_seconds = EXCLUDED.clip_2_start_seconds,
  clip_2_end_seconds = EXCLUDED.clip_2_end_seconds,
  notes = EXCLUDED.notes,
  updated_at = now();
