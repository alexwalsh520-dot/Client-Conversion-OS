-- 043_video_testimonials.sql
-- Client video testimonial collection.
--
-- Clients record on a public, tokenized page (/testimonials/record/<token>).
-- The recorded video is stored in the SAME Cloudflare R2 bucket Studio 2 uses,
-- but under a dedicated `testimonials/` key prefix. These rows are completely
-- separate from studio2_media / studio2_folders: testimonial videos must never
-- enter the Studio 2 database or land in any existing media-library folder.

BEGIN;

CREATE TABLE IF NOT EXISTS public.video_testimonials (
  id BIGSERIAL PRIMARY KEY,
  -- Unguessable token that forms the client-facing link. One row per request.
  token TEXT NOT NULL UNIQUE,
  client_id BIGINT REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Denormalized so display + Slack still work if the client row later changes.
  client_name TEXT NOT NULL,
  coach_name TEXT,
  -- Lifecycle: requested -> submitted. Re-issuing a link adds a new requested row.
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'submitted')),
  -- R2 object key under the testimonials/ prefix. NULL until the client submits.
  r2_key TEXT,
  content_type TEXT,
  file_size BIGINT,
  -- Coach/admin who generated the link.
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_video_testimonials_client
  ON public.video_testimonials (client_id);

CREATE INDEX IF NOT EXISTS idx_video_testimonials_status_submitted
  ON public.video_testimonials (status, submitted_at DESC);

COMMENT ON TABLE public.video_testimonials IS
  'Client video testimonial requests + submissions. Videos live in R2 under the testimonials/ prefix; intentionally separate from studio2_media/studio2_folders so they never enter the Studio 2 database or its folders.';

-- Row Level Security: no anon policies. The public recording flow goes through
-- service-role API routes that validate the token; admin views go through
-- service-role routes that enforce admin auth. Service role bypasses RLS.
ALTER TABLE public.video_testimonials ENABLE ROW LEVEL SECURITY;

COMMIT;
